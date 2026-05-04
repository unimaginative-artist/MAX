// ═══════════════════════════════════════════════════════════════════════════
// server.js — MAX REST API
// Start with: node launcher.mjs --mode api [--port 3100]
// ═══════════════════════════════════════════════════════════════════════════

import express    from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { promises as fsp } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { randomBytes }   from 'crypto';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import { applyProposal, isSomaHealthy } from '../core/SomaController.js';
import { VirtualShell } from '../core/VirtualShell.js';
import { getRunningProcesses, getProcessLog, setProcessLogBroadcast } from '../tools/ShellTool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Persistent Shell Instance for Maxwell IDE ─────────────────────────────
const ideShell = new VirtualShell();
ideShell.start();

// ── API Key management — load or generate on first boot ──────────────────
function loadOrCreateApiKey() {
    // Env var takes precedence (Docker / cloud deployments)
    if (process.env.MAX_API_KEY) return process.env.MAX_API_KEY;
    const keyFile = join(process.cwd(), '.max', 'api-key.txt');
    if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
    const key = 'max_' + randomBytes(24).toString('hex');
    mkdirSync(join(process.cwd(), '.max'), { recursive: true });
    writeFileSync(keyFile, key);
    console.log(`\n[Server] 🔑 API key generated and saved to .max/api-key.txt`);
    console.log(`[Server]    Set MAX_API_KEY=${key} to pin it\n`);
    return key;
}

// ── Per-session usage tracking (Cloud Burst billing foundation) ───────────
const _sessions = new Map();  // sessionId → { requests, tokens, startedAt }
function trackRequest(sessionId, tokensUsed = 0) {
    if (!sessionId) return;
    const s = _sessions.get(sessionId) || { requests: 0, tokens: 0, startedAt: Date.now() };
    s.requests++;
    s.tokens += tokensUsed;
    _sessions.set(sessionId, s);
}

export async function createServer(max, port = 3100) {
    const API_KEY = loadOrCreateApiKey();
    const app = express();
    const httpServer = createHttpServer(app);
    const wss = new WebSocketServer({ server: httpServer });

    app.use(express.json());
    app.use('/assets', express.static(join(__dirname, 'assets')));

    // ── Auth middleware — protect all API routes ───────────────────────────
    // Dashboard HTML + /health are public. Everything else requires the key.
    const PUBLIC_PATHS = new Set(['/', '/health', '/favicon.ico', '/maxwell', '/ide']);
    app.use((req, res, next) => {
        // Static dashboard and health are always public
        if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/assets')) return next();

        const authHeader = req.headers['authorization'] || '';
        const keyHeader  = req.headers['x-api-key']      || '';
        const queryKey   = req.query.apiKey               || '';
        const provided   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (keyHeader || queryKey);

        if (provided === API_KEY) return next();

        // No key — return 401 with clear instructions
        res.status(401).json({
            error:       'Unauthorized',
            message:     'Include your API key: Authorization: Bearer <key>  or  X-Api-Key: <key>',
            keyLocation: '.max/api-key.txt'
        });
    });

    // ── WebSocket & SSE client registry ──────────────────────────────────
    const sseClients = new Set();
    const wsClients = new Set();

    function broadcast(obj) {
        const payload = JSON.stringify(obj);
        // SSE
        const sseData = `data: ${payload}\n\n`;
        sseClients.forEach(res => { try { res.write(sseData); } catch {} });
        // WS
        wsClients.forEach(ws => { try { ws.send(payload); } catch {} });
    }

    wss.on('connection', (ws, req) => {
        // Simple auth check for WS (via query or header)
        const url = new URL(req.url, `http://${req.headers.host}`);
        const provided = url.searchParams.get('apiKey') || req.headers['x-api-key'];
        
        if (provided !== API_KEY) {
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            ws.close();
            return;
        }

        wsClients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', version: '1.0.0-ws' }));
        ws.send(JSON.stringify({ type: 'status', ...max.getStatus() }));

        // Real-time shell stream
        const onShellData = (data) => ws.send(JSON.stringify({ type: 'shell_output', text: data }));
        const onShellErr  = (data) => ws.send(JSON.stringify({ type: 'shell_output', text: data, isError: true }));
        ideShell.on('data', onShellData);
        ideShell.on('data_err', onShellErr);

        ws.on('message', async (data) => {
            try {
                const msg = JSON.parse(data);
                
                if (msg.type === 'chat_request') {
                    const { message, tier, sessionId } = msg;
                    if (!message) return;

                    const sendToken = (token) => {
                        try { ws.send(JSON.stringify({ type: 'token', text: token, requestId: msg.requestId })); } catch {}
                    };

                    // ── Instant fast-tier ack (Ollama, <1s) ──────────────────────────
                    // Fires directly on the brain, bypassing the chat queue.
                    // Gives the user immediate visual feedback before DeepSeek responds.
                    if (max.brain?._fast?.ready && tier !== 'fast') {
                        const ACK_PROMPT = [
                            'On it.', 'Got it.', 'Looking into that.', 'Let me check.',
                            'On it, one sec.', 'Working on it.', 'Sure thing.'
                        ];
                        const pick = ACK_PROMPT[Math.floor(Math.random() * ACK_PROMPT.length)];
                        // Send ack immediately as pre-seeded tokens, no LLM call needed
                        sendToken(pick + '\n\n');
                    }

                    // ── Full smart-tier response ──────────────────────────────────────
                    max.think(message, {
                        tier,
                        onToken: sendToken
                    }).then(result => {
                        ws.send(JSON.stringify({ type: 'done', requestId: msg.requestId, ...result }));
                        trackRequest(sessionId, result.telemetry?.tokens);
                    }).catch(err => {
                        ws.send(JSON.stringify({ type: 'error', message: err.message, requestId: msg.requestId }));
                    });
                }

                if (msg.type === 'shell_input') {
                    // Direct pipe to persistent shell
                    if (ideShell.proc) {
                        // Ensure command has a newline
                        const cmd = msg.command.endsWith('\n') ? msg.command : msg.command + '\n';
                        ideShell.proc.stdin.write(cmd);
                    }
                }

                if (msg.type === 'cancel_request') {
                    console.log('[Server] 🛑 Cancel requested via WebSocket');
                    max.abortChat();
                    ws.send(JSON.stringify({ type: 'cancelled', message: 'Task aborted by user' }));
                }

                if (msg.type === 'buffer_update') {
                    // Maxwell IDE sending unsaved content for "Ghost Context"
                    // We store this in a temporary map so Brain can read it if needed
                    if (!max._ghostBuffers) max._ghostBuffers = new Map();
                    max._ghostBuffers.set(msg.filePath, msg.content);
                }

                if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));

            } catch (err) {
                console.error('[WS] Error processing message:', err.message);
            }
        });

        ws.on('close', () => {
            wsClients.delete(ws);
            ideShell.removeListener('data', onShellData);
            ideShell.removeListener('data_err', onShellErr);
        });
    });

    // Forward MAX insights to all SSE/WS clients
    max.heartbeat?.on('insight', insight => {
        broadcast({ type: 'insight', ...insight });
    });
    max.agentLoop?.on('insight', insight => {
        broadcast({ type: 'insight', ...insight });
    });
    // ... (rest of listeners stay the same)

    // max.say() → chat message in Maxwell IDE
    max.heartbeat?.on('message', msg => {
        broadcast({ type: 'agent_say', text: msg.text, details: msg.details, ts: msg.timestamp });
    });

    // Agent lane status — UI shows what MAX is working on in the background
    max.agentLoop?.on('goalStart', ({ goal }) => {
        broadcast({ type: 'agent_busy', task: goal.title, goalId: goal.id });
    });
    max.agentLoop?.on('goalDone', ({ goal, success }) => {
        broadcast({ type: 'agent_free', task: goal.title, goalId: goal.id, success });
    });
    // Step-level progress events for the task tracker
    max.agentLoop?.on('stepStart', data => {
        broadcast({ type: 'agent_step_start', ...data });
    });
    max.agentLoop?.on('stepDone', data => {
        broadcast({ type: 'agent_step_done', ...data });
    });

    // Self-improvement proposals — broadcast to dashboard for one-click approve/deny
    max.selfImprovement?.on('proposal', (proposal) => {
        broadcast({ type: 'self_proposal', ...proposal });
    });
    max.selfImprovement?.on('approved', (data) => {
        broadcast({ type: 'self_proposal_approved', ...data });
    });
    max.selfImprovement?.on('denied', (data) => {
        broadcast({ type: 'self_proposal_denied', ...data });
    });

    // Forward background process logs to all SSE clients
    setProcessLogBroadcast((entry) => {
        broadcast({ type: 'process_log', ...entry });
    });

    // Periodic status push every 12s
    setInterval(() => {
        if (!sseClients.size) return;
        try { broadcast({ type: 'status', ...max.getStatus() }); } catch {}
    }, 12000);

    // Periodic SOMA status broadcast every 15s when SOMA is active
    setInterval(async () => {
        if (!sseClients.size || !max.soma?.available) return;
        try {
            const somaStatus = await max.soma.getSomaStatus();
            if (somaStatus) broadcast({ type: 'soma_status', ...somaStatus });
        } catch {}
    }, 15000);

    // CORS for local frontends
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
    });

    // ── Web UI ────────────────────────────────────────────────────────────
    app.get('/', (req, res) => {
        try {
            res.setHeader('Content-Type', 'text/html');
            res.send(readFileSync(join(__dirname, 'ui.html'), 'utf8'));
        } catch {
            res.status(404).send('UI not found — run from MAX root');
        }
    });

    // ── Maxwell IDE ───────────────────────────────────────────────────────
    // Serves the Maxwell Warp-style IDE, injecting the API key + base URL
    // so the frontend can authenticate without requiring manual key entry.
    function serveMaxwell(req, res) {
        try {
            let html = readFileSync(join(__dirname, 'maxwell.html'), 'utf8');
            const injection = `<script>
window.__MAX_API_KEY = ${JSON.stringify(API_KEY)};
window.__MAX_BASE_URL = 'http://localhost:${port}';
try { localStorage.setItem('maxwell_api_key', ${JSON.stringify(API_KEY)}); } catch(e) {}
</script>`;
            html = html.replace('<script>\n// Save React/Babel\'s require', injection + '\n<script>\n// Save React/Babel\'s require');
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        } catch {
            res.status(404).send('Maxwell IDE not found — run from MAX root');
        }
    }
    app.get('/maxwell', serveMaxwell);
    app.get('/ide',     serveMaxwell);

    // ── File tree ─────────────────────────────────────────────────────────
    // Returns a structured tree for Maxwell's file explorer
    app.get('/api/files/tree', async (req, res) => {
        const rootDir = req.query.dir || '.';
        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage']);
        async function buildTree(dir, depth = 0) {
            if (depth > 4) return [];
            const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
            const result = [];
            for (const e of entries) {
                if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
                const full = join(dir, e.name);
                const rel  = relative(process.cwd(), full).replace(/\\/g, '/');
                if (e.isDirectory()) {
                    result.push({ name: e.name, type: 'directory', path: rel, children: await buildTree(full, depth + 1) });
                } else {
                    result.push({ name: e.name, type: 'file', path: rel });
                }
            }
            return result.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        }
        const files = await buildTree(rootDir);
        res.json({ files });
    });

    // ── Raw file serve (images, binaries) ────────────────────────────────
    app.get('/api/files/raw', async (req, res) => {
        const filePath = req.query.path;
        if (!filePath) return res.status(400).send('path required');
        // Prevent path traversal
        const abs = join(process.cwd(), filePath);
        if (!abs.startsWith(process.cwd())) return res.status(403).send('forbidden');
        try {
            const data = await fsp.readFile(abs);
            const ext = filePath.split('.').pop().toLowerCase();
            const mime = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',
              webp:'image/webp',ico:'image/x-icon',bmp:'image/bmp',tiff:'image/tiff',avif:'image/avif',
              svg:'image/svg+xml' }[ext] || 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            res.send(data);
        } catch {
            res.status(404).send('not found');
        }
    });

    // ── Config — persist API keys to config/api-keys.env ─────────────────
    app.post('/api/config', async (req, res) => {
        const { deepseek, openai, anthropic } = req.body;
        const envPath = join(process.cwd(), 'config', 'api-keys.env');
        try {
            let content = await fsp.readFile(envPath, 'utf8').catch(() => '');
            const upsert = (src, key, val) => {
                if (!val) return src;
                const re = new RegExp(`^${key}=.*`, 'm');
                return re.test(src) ? src.replace(re, `${key}=${val}`) : src + `\n${key}=${val}`;
            };
            content = upsert(content, 'DEEPSEEK_API_KEY', deepseek);
            content = upsert(content, 'OPENAI_API_KEY', openai);
            content = upsert(content, 'ANTHROPIC_API_KEY', anthropic);
            await fsp.mkdir(join(process.cwd(), 'config'), { recursive: true });
            await fsp.writeFile(envPath, content.trim() + '\n', 'utf8');
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── SSE event stream ──────────────────────────────────────────────────
    app.get('/api/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        sseClients.add(res);
        // Send initial connected + status
        try {
            res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'status', ...max.getStatus() })}\n\n`);
        } catch {}
        req.on('close', () => sseClients.delete(res));
    });

    // ── SOMA Self-Modification Proposal Queue ─────────────────────────────
    const pendingProposals = new Map(); // taskId → proposal

    function printProposal(p) {
        const border = '═'.repeat(70);
        const div    = '─'.repeat(70);
        console.log(`\n╔${border}╗`);
        console.log(`║  🧬 SOMA SELF-MODIFICATION PROPOSAL`);
        console.log(`║  Task: ${p.taskId.slice(0, 8)}  |  Risk: ${(p.riskLevel || 'unknown').toUpperCase()}  |  Score: ${p.overallScore ? (p.overallScore * 100).toFixed(0) + '%' : '?'}`);
        console.log(`╟${div}╢`);
        console.log(`║  File: ${p.file}`);
        console.log(`║  Rationale: ${p.rationale}`);
        console.log(`╟${div}╢`);
        if (p.verification) {
            for (const [pass, result] of Object.entries(p.verification)) {
                const icon = result.pass ? '✅' : '❌';
                console.log(`║  ${icon} ${pass.toUpperCase().padEnd(10)} (${((result.confidence || 0) * 100).toFixed(0)}%)  ${result.notes || ''}`);
            }
            console.log(`╟${div}╢`);
        }
        console.log(`║  NEW CODE PREVIEW:`);
        (p.newCode || '').split('\n').slice(0, 20).forEach(line => console.log(`║    ${line}`));
        if ((p.newCode || '').split('\n').length > 20) console.log(`║    ... (${(p.newCode || '').split('\n').length} lines total)`);
        console.log(`╚${border}╝`);
        console.log(`  → /approve ${p.taskId.slice(0, 8)}   or   /deny ${p.taskId.slice(0, 8)}\n`);
    }

    // Receive proposal from SOMA
    app.post('/api/soma/propose', (req, res) => {
        const proposal = req.body;
        if (!proposal?.taskId || !proposal?.file || !proposal?.newCode) {
            return res.status(400).json({ error: 'taskId, file, newCode required' });
        }
        pendingProposals.set(proposal.taskId, proposal);
        // Also index by short ID for convenience
        pendingProposals.set(proposal.taskId.slice(0, 8), proposal);
        printProposal(proposal);
        broadcast({ type: 'soma_proposal', proposal });
        res.json({ received: true, taskId: proposal.taskId });
    });

    // List pending proposals (full, for UI buttons)
    app.get('/api/soma/proposals', (req, res) => {
        // De-duplicate (we store both full and short-id keys)
        const seen = new Set();
        const list = [];
        for (const p of pendingProposals.values()) {
            if (!seen.has(p.taskId)) { seen.add(p.taskId); list.push(p); }
        }
        res.json(list);
    });

    // Approve — runs the full mechanical apply pipeline
    app.post('/api/soma/proposals/:id/approve', async (req, res) => {
        const proposal = pendingProposals.get(req.params.id);
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        console.log(`\n[MAX] ✅ User approved proposal ${req.params.id} — beginning apply pipeline...\n`);
        pendingProposals.delete(proposal.taskId);
        pendingProposals.delete(proposal.taskId.slice(0, 8));

        // Run apply in background — don't block the HTTP response
        res.json({ accepted: true, taskId: proposal.taskId });

        const result = await applyProposal(proposal, msg => console.log(msg));

        // Notify SOMA of the result
        const SOMA_URL = process.env.SOMA_URL || 'http://127.0.0.1:3001';
        fetch(`${SOMA_URL}/api/soma/modification-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: proposal.taskId, ...result })
        }).catch(() => {});

        broadcast({ type: 'soma_proposal_result', taskId: proposal.taskId, ...result });
    });

    // Deny
    app.delete('/api/soma/proposals/:id', (req, res) => {
        const proposal = pendingProposals.get(req.params.id);
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        pendingProposals.delete(proposal.taskId);
        pendingProposals.delete(proposal.taskId.slice(0, 8));
        console.log(`\n[MAX] 🚫 User denied proposal ${req.params.id} for ${proposal.file}\n`);

        const SOMA_URL = process.env.SOMA_URL || 'http://127.0.0.1:3001';
        fetch(`${SOMA_URL}/api/soma/modification-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: proposal.taskId, applied: false })
        }).catch(() => {});

        res.json({ denied: true });
    });

    // Expose pendingProposals for launcher commands
    app._somaProposals = pendingProposals;

    // ── SOMA bridge toggle ────────────────────────────────────────────────
    // Check if SOMA is reachable right now
    app.get('/api/soma/check', async (req, res) => {
        try {
            const { default: fetch } = await import('node-fetch');
            // Use 127.0.0.1 (not localhost) — Windows can resolve localhost to IPv6
            // Try /health first — it bypasses checkReady so works even during SOMA boot
            const r = await Promise.race([
                fetch('http://127.0.0.1:3001/health'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
            ]);
            const data = await r.json().catch(() => ({}));
            // available = port is up; ready = fully booted
            res.json({ available: r.ok, ready: data.status === 'healthy', active: max.soma?.available ?? false });
        } catch {
            res.json({ available: false, ready: false, active: false });
        }
    });

    // ── SOMA event stream proxy ───────────────────────────────────────────
    // Tails SOMA's live event/log stream and pipes it to the caller.
    // Connect from the browser or curl: GET /api/soma/events
    app.get('/api/soma/events', async (req, res) => {
        if (!max.soma?.available) {
            return res.status(503).json({ error: 'SOMA not connected' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        try {
            const { default: fetch } = await import('node-fetch');
            const upstream = await fetch(`${max.soma.baseUrl}/api/events`);
            if (!upstream.ok) {
                res.write(`data: ${JSON.stringify({ type: 'error', message: `SOMA returned ${upstream.status}` })}\n\n`);
                return res.end();
            }

            upstream.body.on('data',  chunk => { try { res.write(chunk); } catch {} });
            upstream.body.on('end',   ()    => res.end());
            upstream.body.on('error', ()    => res.end());
            req.on('close', ()               => upstream.body.destroy());
        } catch (err) {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
            res.end();
        }
    });

    // Enable or disable SOMA bridge at runtime
    app.post('/api/soma/toggle', async (req, res) => {
        const { enable } = req.body;
        if (!max.soma) return res.status(500).json({ error: 'SomaBridge not initialized' });

        if (enable) {
            max.soma.baseUrl = 'http://127.0.0.1:3001';
            const ok = await max.soma._probe();
            res.json({ active: ok, available: ok });
        } else {
            max.soma._available = false;
            max.soma._ready = false;
            res.json({ active: false, available: false });
        }
    });

    // ── Goals ─────────────────────────────────────────────────────────────
    app.get('/api/goals', (req, res) => {
        const goals = max.goals?.listActive() || [];
        res.json(goals);
    });

    app.post('/api/goals', (req, res) => {
        const { title, description, priority } = req.body;
        if (!title) return res.status(400).json({ error: 'title required' });
        const id = max.goals?.addGoal({ title, description: description || title, priority });
        if (!id) return res.status(500).json({ error: 'GoalEngine not ready' });
        broadcast({ type: 'goal', action: 'added', id, title });
        res.json({ id, title });
    });

    app.delete('/api/goals/:id', (req, res) => {
        const ok = max.goals?.complete?.(req.params.id) ?? max.goals?.remove?.(req.params.id);
        broadcast({ type: 'goal', action: 'removed', id: req.params.id });
        res.json({ ok: !!ok });
    });

    // ── Health ────────────────────────────────────────────────────────────
    app.get('/health', (req, res) => {
        res.json({ ok: true, agent: 'MAX', ready: max._ready });
    });

    // ── Dashboard (Visual APM) ────────────────────────────────────────────
    app.get('/dashboard', (req, res) => {
        const stats = max.getStatus();
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>MAX | Level 4 Dashboard</title>
    <style>
        body { background: #0a0a0a; color: #00ff41; font-family: 'Courier New', Courier, monospace; margin: 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { border: 1px solid #00ff41; padding: 15px; background: #111; position: relative; overflow: hidden; }
        .card.gold { border-color: #ffd700; color: #ffd700; }
        .card.gold .val { color: #fff; }
        .card.blue { border-color: #00d2ff; color: #00d2ff; }
        .card.blue .val { color: #fff; }
        .card h2 { margin-top: 0; border-bottom: 1px solid currentColor; padding-bottom: 10px; font-size: 1.1em; }
        .stat { display: flex; justify-content: space-between; margin: 5px 0; font-size: 0.9em; }
        .val { color: #fff; font-weight: bold; }
        .meter-bg { background: #222; height: 8px; width: 100%; margin-top: 10px; }
        .meter-fill { background: currentColor; height: 100%; transition: width 0.5s; }
        .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 30px; border-bottom: 2px solid #00ff41; padding-bottom: 10px; }
        .pulse { animation: blink 1.5s infinite; color: #ff003c; }
        .profit { color: #00ff41; }
        .debt { color: #ff003c; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.2; } 100% { opacity: 1; } }
        pre { background: #000; padding: 10px; font-size: 0.8em; color: #00ff41; overflow-x: auto; border: 1px solid #222; }
    </style>
    <meta http-equiv="refresh" content="8">
</head>
<body>
    <div class="header">
        <h1>MAX <span class="pulse">●</span> <span style="font-size: 0.6em; vertical-align: middle; border: 1px solid #ff003c; padding: 2px 5px; margin-left: 10px;">LEVEL 4 ALPHA</span></h1>
        <div style="text-align: right;">
            <div>UPTIME: ${process.uptime().toFixed(0)}s</div>
            <div style="font-size: 0.8em; color: #888;">${new Date().toLocaleTimeString()}</div>
        </div>
    </div>

    <div class="grid">
        <div class="card gold">
            <h2>💰 GOAL ECONOMY</h2>
            <div class="stat"><span>NET PROFIT</span> <span class="val ${stats.economics?.netProfit?.startsWith('$-') ? 'debt' : 'profit'}">${stats.economics?.netProfit || '$0.00'}</span></div>
            <div class="stat"><span>TOTAL EARNINGS</span> <span class="val">${stats.economics?.earnings || '$0.00'}</span></div>
            <div class="stat"><span>TOTAL COST</span> <span class="val">${stats.economics?.totalCost || '$0.00'}</span></div>
            <div class="meter-bg"><div class="meter-fill" style="width: ${Math.min(100, (parseFloat((stats.economics?.earnings || '0').replace('$','')) / 1) * 100)}%"></div></div>
        </div>

        <div class="card blue">
            <h2>👁️  EDGE PERCEPTION</h2>
            <div class="stat"><span>SOMA BRIDGE</span> <span class="val">${stats.soma?.available ? 'CONNECTED' : 'OFFLINE'}</span></div>
            <div class="stat"><span>PERCEPTION</span> <span class="val">${stats.edge?.active ? 'ACTIVE' : 'SIMULATED'}</span></div>
            <div class="stat"><span>SWARM JOBS</span> <span class="val">${max.swarm?.getStatus?.().activeJobs || 0}</span></div>
        </div>

        <div class="card">
            <h2>⚙️  DRIVE SYSTEM</h2>
            <div class="stat"><span>TENSION</span> <span class="val">${(stats.drive.tension * 100).toFixed(1)}%</span></div>
            <div class="stat"><span>SATISFACTION</span> <span class="val">${(stats.drive.satisfaction * 100).toFixed(1)}%</span></div>
            <div class="meter-bg"><div class="meter-fill" style="width: ${stats.drive.tension * 100}%"></div></div>
        </div>

        <div class="card">
            <h2>🧠 BRAIN & AGENT0</h2>
            <div class="stat"><span>PERSONA</span> <span class="val">${stats.persona.name}</span></div>
            <div class="stat"><span>BACKEND</span> <span class="val">${max.brain.getStatus().backend}</span></div>
            <div class="stat"><span>CHILD AGENTS</span> <span class="val">1 (Agent0)</span></div>
        </div>

        <div class="card">
            <h2>🛡️  SENTINEL & LAZARUS</h2>
            <div class="stat"><span>INDEXED</span> <span class="val">${stats.kb.sources} files</span></div>
            <div class="stat"><span>TOOL HEALING</span> <span class="val">${max.agentLoop?._toolFailures?.size || 0} tracks</span></div>
            <div class="stat"><span>LAST REPLAN</span> <span class="val">${stats.replans || 0}</span></div>
        </div>

        <div class="card">
            <h2>🚀 PERFORMANCE</h2>
            <div class="stat"><span>TOKENS</span> <span class="val">${stats.outcomes.totalTokens.toLocaleString()}</span></div>
            <div class="stat"><span>LATENCY</span> <span class="val">${stats.outcomes.avgLatency.toFixed(0)}ms</span></div>
            <div class="stat"><span>SUCCESS</span> <span class="val">${(stats.outcomes.success / (stats.outcomes.total || 1) * 100).toFixed(1)}%</span></div>
        </div>
    </div>

    <div class="grid" style="margin-top: 20px; grid-template-columns: 1fr;">
        <div class="card">
            <h2>📝 ACTIVE FRONTIER LOG</h2>
            <div style="max-height: 300px; overflow-y: auto; font-size: 0.85em;">
                ${max.artifacts.list().slice(0, 5).map(a => `
                    <div style="margin-bottom: 15px; border-left: 2px solid #00ff41; padding-left: 10px;">
                        <div style="color: #888; font-size: 0.8em;">${new Date(a.timestamp).toLocaleTimeString()} | ${a.type.toUpperCase()}</div>
                        <div style="color: #fff; margin: 2px 0; font-weight: bold;">${a.name}</div>
                        <div style="color: #00ff41; font-family: monospace;">${a.content.slice(0, 200).replace(/</g, '&lt;')}${a.content.length > 200 ? '...' : ''}</div>
                    </div>
                `).join('') || '<div style="color: #444;">Monitoring active frontier...</div>'}
            </div>
        </div>
    </div>
</body>
</html>
        `;
        res.send(html);
    });

    app.post('/api/command', async (req, res) => {
        try {
            const { tool, action_name, params = {} } = req.body;
            if (!tool || !action_name) return res.status(400).json({ error: 'tool and action_name required' });

            const result = await max.tools.execute(tool, action_name, params);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/status', (req, res) => {
        res.json({ ...max.getStatus(), cwd: process.cwd().replace(/\\/g, '/') });
    });

    // ── Health — detailed system status, always public ────────────────────
    app.get('/health', (req, res) => {
        const brain    = max.brain?.getStatus()   || {};
        const budget   = max.economics?.getBudgetStatus() || {};
        const goals    = max.goals?.getStatus()   || {};
        const mcp      = max.mcp?.getStatus()     || {};
        const security = max.security?.getStatus() || { enabled: false };

        const healthy = max._ready && (brain.fast?.ready || brain.smart?.ready);

        res.status(healthy ? 200 : 503).json({
            status:   healthy ? 'healthy' : 'degraded',
            ready:    max._ready,
            version:  '1.0.0',
            systems: {
                brain:   { fast: brain.fast?.ready, smart: brain.smart?.ready, code: brain.code?.ready },
                budget:  { used: `$${budget.used?.toFixed(4) || '0'}`, cap: `$${budget.cap || 10}`, overBudget: budget.overBudget },
                goals:   { active: goals.active || 0 },
                mcp:     { servers: mcp.count || 0 },
                security: { enabled: security.enabled }
            },
            uptime: process.uptime()
        });
    });

    // ── Usage — per-session metering (Cloud Burst billing foundation) ──────
    app.get('/api/usage', (req, res) => {
        const econ = max.economics?.getStatus() || {};
        const budget = max.economics?.getBudgetStatus() || {};
        res.json({
            today:    econ,
            budget,
            sessions: [..._sessions.entries()].map(([id, s]) => ({
                id, requests: s.requests, tokens: s.tokens,
                durationMs: Date.now() - s.startedAt
            }))
        });
    });

    // ── Chat — streaming SSE response ─────────────────────────────────────
    // Streams tokens back as text/event-stream on the same connection.
    // Also broadcasts tokens to all connected SSE clients (for dashboards).
    //
    // POST /api/chat  { "message": "...", "temperature": 0.7, "maxTokens": 1024 }
    // → text/event-stream:
    //   data: {"type":"token","text":"Hello"}
    //   data: {"type":"done","response":"...","persona":"...","drive":{...}}
    app.post('/api/chat', async (req, res) => {
        const { message, temperature, maxTokens, sessionId, tier } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });

        // Budget check before queuing
        if (max.economics?.isOverBudget()) {
            const b = max.economics.getBudgetStatus();
            return res.status(402).json({ error: `Daily budget cap reached ($${b.used.toFixed(2)}/$${b.cap}). Increase MAX_DAILY_BUDGET in config/api-keys.env.` });
        }
        // Chat turns queue automatically — no 429, just wait

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (obj) => {
            try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
        };

        // Broadcast to dashboard SSE clients too
        const sendAll = (obj) => { send(obj); broadcast(obj); };

        try {
            const result = await max.think(message, {
                temperature,
                maxTokens,
                tier: tier || undefined,
                onToken: (token) => sendAll({ type: 'token', text: token })
            });

            sendAll({ type: 'done', response: result.response, persona: result.persona, drive: result.drive, telemetry: result.telemetry });
            trackRequest(sessionId, result.telemetry?.tokens);
            send({ type: 'end' });
        } catch (err) {
            send({ type: 'error', message: err.message });
        }

        res.end();
    });

    // ── Self-improvement proposals ────────────────────────────────────────
    app.get('/api/self/proposals', (req, res) => {
        res.json(max.selfImprovement?.list() || []);
    });

    app.post('/api/self/proposals/:id/approve', async (req, res) => {
        try {
            const result = await max.selfImprovement.approve(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/self/proposals/:id', async (req, res) => {
        try {
            const result = await max.selfImprovement.deny(req.params.id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Queue depth — UI can poll this to show "2 messages waiting"
    app.get('/api/chat/queue', (req, res) => {
        res.json({ queued: max._chatQueue?.size ?? 0, busy: max._chatBusy });
    });

    // ── Process management ────────────────────────────────────────────────

    // List all running background processes with recent logs
    app.get('/api/processes', (req, res) => {
        res.json(getRunningProcesses());
    });

    // Start a named background process
    // POST /api/processes/start  { "command": "node server.js", "name": "my-server", "cwd": "." }
    app.post('/api/processes/start', async (req, res) => {
        const { command, name, cwd } = req.body;
        if (!command) return res.status(400).json({ error: 'command required' });
        try {
            const result = await max.tools.execute('shell', 'start', { command, name, cwd });
            broadcast({ type: 'process_started', name: result.name, pid: result.pid, command });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Stop a named background process
    app.delete('/api/processes/:name', async (req, res) => {
        try {
            const result = await max.tools.execute('shell', 'stop', { name: req.params.name });
            broadcast({ type: 'process_stopped', name: req.params.name });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get full log for a named process
    app.get('/api/processes/:name/logs', (req, res) => {
        const log = getProcessLog(req.params.name);
        if (!log) return res.status(404).json({ error: 'Process not found' });
        const limit = parseInt(req.query.limit) || 200;
        res.json({ name: req.params.name, lines: log.slice(-limit) });
    });

    // Health check a process — ping its URL or run a command
    // POST /api/processes/:name/health  { "url": "http://localhost:3000/health" }
    // Returns { healthy: true/false, status: 200, latencyMs: 42 }
    app.post('/api/processes/:name/health', async (req, res) => {
        const { url, command } = req.body;
        const start = Date.now();

        if (url) {
            try {
                const { default: fetch } = await import('node-fetch');
                const r = await Promise.race([
                    fetch(url),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
                ]);
                const latencyMs = Date.now() - start;
                res.json({ healthy: r.ok, status: r.status, latencyMs, url });
            } catch (err) {
                res.json({ healthy: false, error: err.message, latencyMs: Date.now() - start, url });
            }
        } else if (command) {
            try {
                const result = await max.tools.execute('shell', 'run', { command, timeoutMs: 5000 });
                res.json({ healthy: result.success, exitCode: result.code, latencyMs: Date.now() - start });
            } catch (err) {
                res.json({ healthy: false, error: err.message, latencyMs: Date.now() - start });
            }
        } else {
            res.status(400).json({ error: 'url or command required' });
        }
    });

    // Monitor a process — start periodic health checks, auto-alert on failure
    // POST /api/processes/:name/monitor  { "url": "http://localhost:3000/health", "intervalMs": 10000 }
    const _monitors = new Map(); // name → intervalId

    app.post('/api/processes/:name/monitor', async (req, res) => {
        const { name } = req.params;
        const { url, command, intervalMs = 10000, autoRestart = false } = req.body;
        if (!url && !command) return res.status(400).json({ error: 'url or command required' });

        // Clear existing monitor if any
        if (_monitors.has(name)) clearInterval(_monitors.get(name));

        const check = async () => {
            const start = Date.now();
            let healthy = false;
            let details = {};

            if (url) {
                try {
                    const { default: fetch } = await import('node-fetch');
                    const r = await Promise.race([
                        fetch(url),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
                    ]);
                    healthy = r.ok;
                    details = { status: r.status, latencyMs: Date.now() - start };
                } catch (err) {
                    details = { error: err.message, latencyMs: Date.now() - start };
                }
            } else {
                try {
                    const r = await max.tools.execute('shell', 'run', { command, timeoutMs: 5000 });
                    healthy = r.success;
                    details = { exitCode: r.code, latencyMs: Date.now() - start };
                } catch (err) {
                    details = { error: err.message, latencyMs: Date.now() - start };
                }
            }

            broadcast({ type: 'process_health', name, healthy, ...details, ts: Date.now() });

            if (!healthy && autoRestart) {
                const procs = getRunningProcesses();
                const proc  = procs.find(p => p.name === name);
                if (proc) {
                    console.log(`[Monitor] 🔄 ${name} is unhealthy — restarting...`);
                    try {
                        await max.tools.execute('shell', 'stop',  { name });
                        await new Promise(r => setTimeout(r, 1000));
                        await max.tools.execute('shell', 'start', { command: proc.command, name, cwd: proc.cwd });
                        broadcast({ type: 'process_restarted', name, ts: Date.now() });
                    } catch (err) {
                        broadcast({ type: 'process_restart_failed', name, error: err.message, ts: Date.now() });
                    }
                }
            }
        };

        const id = setInterval(check, intervalMs);
        _monitors.set(name, id);
        check(); // run immediately

        res.json({ monitoring: name, intervalMs, autoRestart, url: url || null });
    });

    // Stop monitoring a process
    app.delete('/api/processes/:name/monitor', (req, res) => {
        const id = _monitors.get(req.params.name);
        if (!id) return res.status(404).json({ error: 'No monitor running for this process' });
        clearInterval(id);
        _monitors.delete(req.params.name);
        res.json({ stopped: req.params.name });
    });

    // ── Swarm ─────────────────────────────────────────────────────────────
    app.post('/api/swarm', async (req, res) => {
        const { task, workers } = req.body;
        if (!task) return res.status(400).json({ error: 'task required' });

        try {
            const result = await max.swarmThink(task, { workers });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Debate ────────────────────────────────────────────────────────────
    app.post('/api/debate', async (req, res) => {
        const { description, stakes } = req.body;
        const title = req.body.title || req.body.topic;
        if (!title) return res.status(400).json({ error: 'title required' });

        try {
            const result = await max.debateDecision({ title, description, stakes });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Persona ───────────────────────────────────────────────────────────
    app.post('/api/persona', (req, res) => {
        const { persona } = req.body;
        try {
            const p = max.persona.switchTo(persona);
            res.json({ persona: p.id, name: p.name });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // ── Memory ────────────────────────────────────────────────────────────
    app.get('/api/memory', (req, res) => {
        const { type = 'curiosity', limit = 20 } = req.query;
        res.json(max.memory.recall(type, parseInt(limit)));
    });

    app.get('/api/memory/search', (req, res) => {
        const { q, limit = 10 } = req.query;
        if (!q) return res.status(400).json({ error: 'q required' });
        res.json(max.memory.search(q, parseInt(limit)));
    });

    app.get('/api/memory/conversation', (req, res) => {
        const { limit = 20 } = req.query;
        res.json(max.memory.getConversationHistory(parseInt(limit)));
    });

    // ── Dependency graph ──────────────────────────────────────────────────
    app.get('/api/graph', async (req, res) => {
        try {
            const root = process.cwd();
            const jsFiles = [];

            async function scan(dir, depth = 0) {
                if (depth > 4) return;
                const skip = new Set(['node_modules', '.git', '.max', 'dist', 'build', 'coverage']);
                let entries;
                try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (skip.has(e.name)) continue;
                    const full = join(dir, e.name);
                    if (e.isDirectory()) { await scan(full, depth + 1); }
                    else if (/\.(js|mjs|ts|tsx|jsx)$/.test(e.name)) jsFiles.push(full);
                }
            }
            await scan(root);

            const nodes = [];
            const edgeSet = new Set();
            const edges = [];
            const { resolve, dirname: dn, basename } = await import('path');

            for (const file of jsFiles) {
                const rel = relative(root, file).replace(/\\/g, '/');
                nodes.push({ id: rel, label: basename(file) });

                let src;
                try { src = await fsp.readFile(file, 'utf8'); } catch { continue; }

                const importRe = /(?:import|require)\s*[\('"]*([^'"\)\n]+)['"]/g;
                let m;
                while ((m = importRe.exec(src)) !== null) {
                    const dep = m[1].trim();
                    if (!dep.startsWith('.')) continue;
                    const resolved = resolve(dn(file), dep);
                    const candidates = [resolved, resolved + '.js', resolved + '.mjs', resolved + '/index.js'];
                    for (const c of candidates) {
                        const depRel = relative(root, c).replace(/\\/g, '/');
                        if (jsFiles.some(f => relative(root, f).replace(/\\/g, '/') === depRel)) {
                            const key = `${rel}→${depRel}`;
                            if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source: rel, target: depRel }); }
                            break;
                        }
                    }
                }
            }

            res.json({ nodes, edges });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ── Auth check — returns 200 if key is valid ──────────────────────────
    app.get('/api/me', (req, res) => {
        res.json({ ok: true, keyHint: API_KEY.slice(0, 8) + '…' });
    });

    // ── Tools ─────────────────────────────────────────────────────────────
    app.get('/api/tools', (req, res) => {
        res.json(max.tools.list());
    });

    app.post('/api/tools/:tool/:action', async (req, res) => {
        const { tool, action } = req.params;
        try {
            const result = await max.tools.execute(tool, action, req.body);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // ── Clear context ─────────────────────────────────────────────────────
    app.post('/api/clear', (req, res) => {
        max.clearContext();
        res.json({ ok: true });
    });

    // ── Heartbeat control ─────────────────────────────────────────────────
    app.post('/api/heartbeat/start', (req, res) => {
        max.heartbeat?.start();
        res.json({ running: true });
    });

    app.post('/api/heartbeat/stop', (req, res) => {
        max.heartbeat?.stop();
        res.json({ running: false });
    });

    await new Promise((resolve) => {
        const server = httpServer.listen(port, () => {
            console.log(`[MAX] 🌐 API  →  http://localhost:${port}`);
            console.log(`[MAX]   POST /api/chat                    — streaming chat (SSE)`);
            console.log(`[MAX]   WS   /api/events                  — bidirectional (WebSockets)`);
            console.log(`[MAX]   GET  /api/events                  — SSE live feed`);
            console.log(`[MAX]   GET  /api/processes               — list running processes`);
            console.log(`[MAX]   POST /api/processes/start         — start a process`);
            console.log(`[MAX]   DEL  /api/processes/:name         — stop a process`);
            console.log(`[MAX]   GET  /api/processes/:name/logs    — get process logs`);
            console.log(`[MAX]   POST /api/processes/:name/health  — one-shot health check`);
            console.log(`[MAX]   POST /api/processes/:name/monitor — start health monitoring`);
            console.log(`[MAX]   GET  /api/goals                   — list goals`);
            console.log(`[MAX]   GET  /api/status                  — system status`);
            console.log(`[MAX] 🎨 IDE  →  http://localhost:${port}/maxwell`);
            resolve();
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`[MAX] ⚠️  Port ${port} in use — web UI unavailable (kill old MAX process or change MAX_PORT)`);
            } else {
                console.error('[MAX] Server error:', err.message);
            }
            resolve(); // don't block startup
        });
    });

    return app;
}
