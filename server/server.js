// ═══════════════════════════════════════════════════════════════════════════
// server.js — MAX REST API
// Start with: node launcher.mjs --mode api [--port 3100]
// ═══════════════════════════════════════════════════════════════════════════

import express    from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { promises as fsp } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative, resolve, sep } from 'path';
import { randomBytes }   from 'crypto';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import { applyProposal, isSomaHealthy } from '../core/SomaController.js';
import { VirtualShell } from '../core/VirtualShell.js';
import { getRunningProcesses, getProcessLog, setProcessLogBroadcast, setErrorExplainHandler, shutdownShellTool } from '../tools/ShellTool.js';
import { createClusterRoutes } from './clusterRoutes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(process.cwd());
const WORKSPACE_ROOT_KEY = process.platform === 'win32' ? WORKSPACE_ROOT.toLowerCase() : WORKSPACE_ROOT;
const MAX_GHOST_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_GHOST_BUFFERS = 50;

function resolveWorkspacePath(inputPath = '.') {
    const abs = resolve(WORKSPACE_ROOT, inputPath || '.');
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (key !== WORKSPACE_ROOT_KEY && !key.startsWith(WORKSPACE_ROOT_KEY + sep)) return null;
    return abs;
}

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
    const tlsCertPath = process.env.MAX_TLS_CERT;
    const tlsKeyPath = process.env.MAX_TLS_KEY;
    const httpServer = tlsCertPath && tlsKeyPath
        ? createHttpsServer({ cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath) }, app)
        : createHttpServer(app);
    const wss = new WebSocketServer({ server: httpServer });

    // Maxwell streams unsaved editor buffers; the default 100kb JSON limit is too small.
    app.use(express.json({ limit: '8mb' }));
    app.use('/assets', express.static(join(__dirname, 'assets')));

    // CORS must run before auth so browser OPTIONS preflights are not rejected.
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        const allowOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '')
            ? origin
            : `http://localhost:${port}`;
        res.setHeader('Access-Control-Allow-Origin', allowOrigin);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key, X-Max-Cluster-Secret, X-Max-Node-Id, Idempotency-Key');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
    });

    // Cluster routes use a separate shared secret so two machines do not need
    // to copy their dashboard API keys. Mount before the general API guard.
    app.use('/api/swarm', createClusterRoutes(max, {
        clusterSecret: process.env.MAX_CLUSTER_SECRET,
        apiKey: API_KEY
    }));

    // ── Auth middleware — protect all API routes ───────────────────────────
    // Dashboard HTML + /health are public. Everything else requires the key.
    const PUBLIC_PATHS = new Set(['/', '/health', '/favicon.ico', '/maxwell', '/ide', '/preview']);
    app.use((req, res, next) => {
        // Static dashboard and health are always public
        if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/assets') || req.path.startsWith('/preview/')) return next();

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
    max._ideClients = wsClients;

    function broadcast(obj) {
        const payload = JSON.stringify(obj);
        // SSE
        const sseData = `data: ${payload}\n\n`;
        sseClients.forEach(res => {
            try { res.write(sseData); }
            catch { sseClients.delete(res); }
        });
        // WS
        wsClients.forEach(ws => {
            try { ws.send(payload); }
            catch { wsClients.delete(ws); }
        });
    }

    let activeAgentActivity = null;
    const makeActivityId = (prefix = 'act') => `${prefix}_${Date.now()}_${randomBytes(3).toString('hex')}`;
    function emitActivity(event) {
        broadcast({
            type: 'agent_activity',
            ts: Date.now(),
            ...event
        });
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

        const shellSessionId = randomBytes(8).toString('hex');
        let sessionShell = null;
        let shellAbortController = null;

        const sendWs = (obj) => {
            if (ws.readyState !== 1) return;
            try { ws.send(JSON.stringify(obj)); } catch {}
        };
        const normalizeShellChunk = (chunk) => {
            return String(chunk)
                .split(/\r?\n/)
                .filter(line => {
                    const t = line.trim().toLowerCase();
                    if (!t) return true;
                    if (t.startsWith('echo __exit_code_') || t.startsWith('echo __max_shell_done_')) return false;
                    if (t.startsWith('__exit_code_') || t.startsWith('__max_shell_done_')) return false;
                    if (/^[a-z]:[\\\/].*>/.test(t)) return false;
                    return true;
                })
                .join('\n');
        };
        const onShellData = (data) => {
            const text = normalizeShellChunk(data);
            if (text) sendWs({ type: 'shell_output', text });
        };
        const onShellErr = (data) => {
            const text = normalizeShellChunk(data);
            if (text) sendWs({ type: 'shell_output', text, isError: true });
        };
        const getSessionShell = () => {
            if (sessionShell) return sessionShell;
            sessionShell = new VirtualShell();
            sessionShell.on('data', onShellData);
            sessionShell.on('data_err', onShellErr);
            sessionShell.start();
            return sessionShell;
        };

        wsClients.add(ws);
        sendWs({ type: 'connected', version: '1.0.0-ws' });
        sendWs({ type: 'shell_session', sessionId: shellSessionId, isolated: true });
        sendWs({ type: 'status', ...(max.getQuickStatus?.() || max.getStatus()) });

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
                    const command = String(msg.command || '').trim();
                    if (!command) return;
                    shellAbortController = new AbortController();
                    
                    // If the command is "gemini" or looks interactive, we don't block the UI
                    const isInteractive = command === 'gemini' || command.startsWith('node') && !command.includes(' ');
                    
                    const runPromise = getSessionShell().run(command, msg.timeoutMs || 120_000, shellAbortController.signal, isInteractive);
                    
                    if (isInteractive) {
                        sendWs({ type: 'shell_interactive', sessionId: shellSessionId });
                    }

                    runPromise.then(result => {
                            sendWs({
                                type: 'shell_done',
                                sessionId: shellSessionId,
                                success: result.success,
                                code: result.code,
                                error: result.error || result.stderr || null
                            });
                        })
                        .catch(err => {
                            sendWs({ type: 'shell_done', sessionId: shellSessionId, success: false, code: -1, error: err.message });
                        })
                        .finally(() => { shellAbortController = null; });
                }

                if (msg.type === 'shell_write') {
                    // Send raw input to the shell (for interactive apps)
                    if (sessionShell && sessionShell.proc) {
                        sessionShell.proc.stdin.write(msg.text || '');
                    }
                }

                if (msg.type === 'shell_cancel') {
                    shellAbortController?.abort();
                }

                if (msg.type === 'cancel_request') {
                    console.log('[Server] 🛑 Cancel requested via WebSocket');
                    max.abortChat();
                    shellAbortController?.abort();
                    const agentInterrupted = max.abortAgent?.() || false;
                    sendWs({ type: 'cancelled', message: agentInterrupted ? 'Chat and agent task aborted by user' : 'Chat aborted by user' });
                }

                if (msg.type === 'buffer_update') {
                    // Maxwell IDE sending unsaved content for "Ghost Context"
                    if (!max._ghostBuffers) max._ghostBuffers = new Map();
                    if (!msg.filePath || typeof msg.content !== 'string') return;
                    let content = msg.content;
                    if (Buffer.byteLength(content, 'utf8') > MAX_GHOST_BUFFER_BYTES) {
                        content = content.slice(0, MAX_GHOST_BUFFER_BYTES) +
                            '\n\n/* [Maxwell] Ghost buffer truncated at 2MB. */';
                    }
                    max._ghostBuffers.delete(msg.filePath);
                    max._ghostBuffers.set(msg.filePath, { content, updatedAt: Date.now() });
                    
                    // Omega: Trigger LSP diagnostics on buffer update
                    if (max.lsp) {
                        const absPath = resolve(WORKSPACE_ROOT, msg.filePath || '.');
                        const fileUri = 'file:///' + absPath.replace(/\\/g, '/');
                        const ext = (msg.filePath || '').split('.').pop().toLowerCase();
                        const langId = { ts:'typescript', tsx:'typescript', js:'javascript', mjs:'javascript',
                            cjs:'javascript', jsx:'javascript', py:'python', go:'go', rs:'rust' }[ext] || 'javascript';
                        max.lsp.updateDocument(fileUri, content, langId).then(diagnostics => {
                            // AI-fallback diagnostics: send with relative path so IDE lookup matches
                            if (diagnostics?.length) {
                                sendWs({ type: 'lsp_diagnostic', payload: { uri: msg.filePath, diagnostics } });
                            }
                        });
                    }

                    while (max._ghostBuffers.size > MAX_GHOST_BUFFERS) {
                        max._ghostBuffers.delete(max._ghostBuffers.keys().next().value);
                    }
                }

                if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));

            } catch (err) {
                console.error('[WS] Error processing message:', err.message);
            }
        });

        ws.on('close', () => {
            wsClients.delete(ws);
            shellAbortController?.abort();
            sessionShell?.removeListener('data', onShellData);
            sessionShell?.removeListener('data_err', onShellErr);
            sessionShell?.stop();
        });
    });

    // ── Omega Telemetry Hooks ─────────────────────────────────────────────
    // Forward all real-time events to connected clients
    max.contextPager?.on('paging_update', (data) => broadcast({ type: 'paging_update', payload: data }));
    max.grounding?.on('grounding_update', (data) => broadcast({ type: 'grounding_update', payload: data }));
    max.skillMutator?.on('evolution_update', (data) => broadcast({ type: 'evolution_update', payload: data }));
    // Real LSP push-diagnostics (textDocument/publishDiagnostics from language servers)
    max.lsp?.on('diagnostic', ({ uri, diagnostics }) => {
        // Convert file:/// URI → relative workspace path so IDE key-lookup matches
        let relUri = uri;
        if (uri && uri.startsWith('file:///')) {
            try {
                const abs = decodeURIComponent(uri.slice(8)).replace(/\//g, sep);
                relUri = relative(WORKSPACE_ROOT, abs).replace(/\\/g, '/');
            } catch {}
        }
        broadcast({ type: 'lsp_diagnostic', payload: { uri: relUri, diagnostics } });
    });
    max.security?.on('issues', (data) => broadcast({ type: 'security_update', payload: data }));
    max.persona?.on('persona_changed', (data) => broadcast({ type: 'persona_changed', ...data }));
    max.muse?.on('muse_state',   (state)   => broadcast({ type: 'muse_state',   ...state }));
    max.muse?.on('activated',    (state)   => broadcast({ type: 'muse_state',   ...state }));
    max.muse?.on('deactivated',  ()        => broadcast({ type: 'muse_deactivated' }));
    max.muse?.on('muse_insight', (insight) => broadcast({ type: 'muse_insight',  ...insight }));
    max.swarm?.on('job:update', (job) => broadcast({ type: 'swarm_update', payload: job }));

    // ── SOMA bridge events → IDE ──────────────────────────────────────────
    // Forward all SOMA signal bridge messages to connected IDE clients
    max.soma?.subscribe('*', (data, topic) => {
        broadcast({ type: 'soma_signal', topic, ...data });
    });
    // Broadcast SOMA connection status every 30s + immediately after boot
    const broadcastSomaStatus = () => broadcast({
        type:            'soma_status',
        connected:       max.soma?.available        ?? false,
        signalConnected: max.soma?._signalConnected ?? false,
        url:             max.soma?.baseUrl          ?? null,
    });
    const somaStatusTimeout = setTimeout(broadcastSomaStatus, 3000);
    const somaStatusInterval = setInterval(broadcastSomaStatus, 30_000);
    max.workspaceEdits?.on('editProposed', (proposal) => broadcast({ type: 'edit_proposed', proposal }));
    max.workspaceEdits?.on('editApplied', (event) => broadcast({ type: 'edit_applied', ...event }));
    max.workspaceEdits?.on('editRejected', (event) => broadcast({ type: 'edit_rejected', ...event }));

    // AgentLoop approval gate — broadcast to IDE so users aren't stuck in REPL-only mode
    max.agentLoop?.on('approvalNeeded', (data) => broadcast({ type: 'approval_needed', ...data }));
    max.agentLoop?.on('approvalGranted', (data) => broadcast({ type: 'approval_granted', ...data }));
    max.agentLoop?.on('approvalDenied',  (data) => broadcast({ type: 'approval_denied',  ...data }));

    // Clarification gate — broadcast questions to IDE, receive answers back
    max.agentLoop?.on('clarificationNeeded', (data) => broadcast({ type: 'clarification_needed', ...data }));

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
        activeAgentActivity = goal.id || makeActivityId('goal');
        emitActivity({
            phase: 'goal_start',
            activityId: activeAgentActivity,
            task: goal.title,
            goalId: goal.id,
            status: 'running',
            summary: goal.description || ''
        });
        broadcast({ type: 'agent_busy', task: goal.title, goalId: goal.id });
    });
    max.agentLoop?.on('goalDone', ({ goal, success }) => {
        emitActivity({
            phase: 'goal_done',
            activityId: activeAgentActivity || goal.id || makeActivityId('goal'),
            task: goal.title,
            goalId: goal.id,
            status: success ? 'done' : 'failed',
            success,
            summary: success ? 'Completed.' : 'Stopped or blocked.'
        });
        activeAgentActivity = null;
        broadcast({ type: 'agent_free', task: goal.title, goalId: goal.id, success });
    });
    // Step-level progress events for the task tracker
    max.agentLoop?.on('stepStart', data => {
        emitActivity({
            phase: 'step_start',
            activityId: activeAgentActivity || makeActivityId('goal'),
            stepId: data.step,
            status: 'running',
            ...data
        });
        broadcast({ type: 'agent_step_start', ...data });
    });
    max.agentLoop?.on('stepDone', data => {
        emitActivity({
            phase: 'step_done',
            activityId: activeAgentActivity || makeActivityId('goal'),
            stepId: data.step,
            status: data.success ? 'done' : 'failed',
            ...data
        });
        broadcast({ type: 'agent_step_done', ...data });
    });

    // ── Tool activity mirror — IDE reacts to every file op MAX performs ──────
    // Intercept max.tools.execute so ALL tool calls (AgentLoop + inline chat)
    // are broadcast to the IDE. This is what makes the editor "watch MAX work."
    if (max.tools?.execute) {
        const _origExec = max.tools.execute.bind(max.tools);
        max.tools.execute = async (toolName, action, params) => {
            const suppressActivity = params?.__source === 'ui' || params?.__silent === true;
            const standaloneActivityId = !activeAgentActivity && !suppressActivity ? makeActivityId('tool') : null;
            const activityPayload = {
                activityId: activeAgentActivity || standaloneActivityId,
                task: activeAgentActivity ? null : `Running ${toolName}:${action}`,
                tool: toolName,
                toolAction: action,
                action: params?.command || params?.filePath || params?.path || params?.query || `${toolName}:${action}`,
                file: params?.filePath || params?.path || null,
                params: params ? {
                    command: params.command,
                    filePath: params.filePath || params.path,
                    query: params.query
                } : {}
            };
            if (standaloneActivityId) {
                emitActivity({ phase: 'tool_start', status: 'running', ...activityPayload });
            }

            const result = await _origExec(toolName, action, params);
            try {
                if (standaloneActivityId) {
                    emitActivity({
                        phase: 'tool_done',
                        status: result?.success === false ? 'failed' : 'done',
                        success: result?.success !== false,
                        summary: result?.error || result?.stderr || result?.stdout || result?.output || '',
                        ...activityPayload
                    });
                }
                if (toolName === 'file') {
                    const fp = params?.filePath || params?.path;
                    if (fp && ['read', 'readFile'].includes(action)) {
                        broadcast({ type: 'agent_file_read', filePath: fp });
                    }
                    if (fp && ['write', 'replace', 'edit', 'patch'].includes(action)) {
                        broadcast({ type: 'agent_file_write', filePath: fp, action, content: params?.content ?? null });
                    }
                }
                if (toolName === 'shell' && action === 'run' && result?.output) {
                    const cmd = params?.command || '';
                    const out = `$ ${cmd}\n${result.output}${result.output.endsWith('\n') ? '' : '\n'}`;
                    broadcast({ type: 'shell_output', text: out, source: 'agent' });
                }
            } catch {}
            return result;
        };
    }

    // Sentinel file-watch — notify IDE when files change externally so open editors reload
    max.sentinel?.on('change', ({ file, type }) => {
        if (type !== 'deleted') {
            broadcast({ type: 'file_changed', file, changeType: type });
        }
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

    // Terminal error explanation — Warp-style inline AI explain on failed commands
    setErrorExplainHandler(async ({ command, code, stdout, stderr }) => {
        if (!max.brain?._ready) return;
        const context = [stderr, stdout].filter(Boolean).join('\n').trim().slice(0, 800);
        if (!context) return;
        const result = await max.brain.think(
            `A shell command failed. Explain the error briefly (2-3 sentences max) and suggest the most likely fix.\n\nCommand: ${command}\nExit code: ${code}\nOutput:\n${context}`,
            { tier: 'fast', temperature: 0.2, maxTokens: 150 }
        );
        broadcast({ type: 'error_explain', command, explanation: result.text.trim() });
    });

    // Periodic status push every 12s
    const _statusInterval = setInterval(() => {
        if (!sseClients.size) return;
        try { broadcast({ type: 'status', ...(max.getQuickStatus?.() || max.getStatus()) }); } catch {}
    }, 12000);
    _statusInterval.unref();

    // Periodic SOMA status broadcast every 15s when SOMA is active
    const _somaInterval = setInterval(async () => {
        if (!sseClients.size || !max.soma?.available) return;
        try {
            const somaStatus = await max.soma.getSomaStatus();
            if (somaStatus) broadcast({ type: 'soma_status', ...somaStatus });
        } catch {}
    }, 15000);
    _somaInterval.unref();

    // ── Web UI (legacy dashboard) ─────────────────────────────────────────
    app.get('/dashboard', (req, res) => {
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
window.MAX_URL = window.__MAX_BASE_URL;
try { localStorage.setItem('maxwell_api_key', ${JSON.stringify(API_KEY)}); } catch(e) {}
</script>`;
            if (html.includes('</head>')) {
                html = html.replace('</head>', `${injection}\n</head>`);
            } else {
                html = injection + '\n' + html;
            }
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        } catch {
            res.status(404).send('Maxwell IDE not found — run from MAX root');
        }
    }
    app.get('/',        serveMaxwell);
    app.get('/maxwell', serveMaxwell);
    app.get('/ide',     serveMaxwell);

    // ── File tree ─────────────────────────────────────────────────────────
    // Returns a structured tree for Maxwell's file explorer
    app.get('/api/files/tree', async (req, res) => {
        const rootDir = resolveWorkspacePath(req.query.dir || '.');
        if (!rootDir) return res.status(403).json({ error: 'forbidden' });
        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage']);
        async function buildTree(dir, depth = 0) {
            if (depth > 4) return [];
            const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
            const result = [];
            for (const e of entries) {
                if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
                const full = join(dir, e.name);
                const rel  = relative(WORKSPACE_ROOT, full).replace(/\\/g, '/');
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
        const abs = resolveWorkspacePath(filePath);
        if (!abs) return res.status(403).send('forbidden');
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

    // ── @mention resolver — reads file content for @file mentions in chat ──
    app.post('/api/mention/resolve', async (req, res) => {
        const { mentions = [] } = req.body; // [{ type: 'file', value: 'core/Brain.js' }, ...]
        const results = [];
        for (const m of mentions.slice(0, 5)) {
            if (m.type === 'file') {
                const abs = resolveWorkspacePath(m.value);
                if (!abs) { results.push({ ...m, error: 'forbidden' }); continue; }
                try {
                    const content = await fsp.readFile(abs, 'utf8');
                    results.push({ ...m, content: content.slice(0, 4000) });
                } catch { results.push({ ...m, error: 'not found' }); }
            }
        }
        res.json({ results });
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
        res.on('error', () => sseClients.delete(res));
        // Send initial connected + status
        try {
            res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: 'status', ...(max.getQuickStatus?.() || max.getStatus()) })}\n\n`);
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

    // ── Shared approve/deny actions (used by the HTTP routes AND MAX's auto-review) ──
    async function approveProposal(proposal, source = 'user') {
        console.log(`\n[MAX] ✅ ${source} approved proposal ${proposal.taskId.slice(0, 8)} — beginning apply pipeline...\n`);
        pendingProposals.delete(proposal.taskId);
        pendingProposals.delete(proposal.taskId.slice(0, 8));

        const result = await applyProposal(proposal, msg => console.log(msg));

        const SOMA_URL = process.env.SOMA_URL || 'http://127.0.0.1:3001';
        fetch(`${SOMA_URL}/api/soma/modification-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: proposal.taskId, approvedBy: source, ...result })
        }).catch(() => {});
        broadcast({ type: 'soma_proposal_result', taskId: proposal.taskId, approvedBy: source, ...result });
        return result;
    }

    function denyProposal(proposal, source = 'user', reason = '') {
        pendingProposals.delete(proposal.taskId);
        pendingProposals.delete(proposal.taskId.slice(0, 8));
        console.log(`\n[MAX] 🚫 ${source} denied proposal ${proposal.taskId.slice(0, 8)} for ${proposal.file}${reason ? ` — ${reason}` : ''}\n`);

        const SOMA_URL = process.env.SOMA_URL || 'http://127.0.0.1:3001';
        fetch(`${SOMA_URL}/api/soma/modification-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: proposal.taskId, applied: false, deniedBy: source, reason })
        }).catch(() => {});
        broadcast({ type: 'soma_proposal_denied', taskId: proposal.taskId, deniedBy: source, reason });
    }

    // ── MAX autonomous review — Barry delegated approval authority (Jul 2026) ──
    // MAX reviews each SOMA proposal with his own brain and decides. Hard rails:
    // high-risk / low-score / protected-file proposals are never auto-approved —
    // they stay pending for Barry with a Discord ping. Everything MAX decides is
    // reported to Discord so there is a human-visible audit trail.
    const AUTO_REVIEW_PROTECTED = /launcher|SomaBootstrap|ASIKernel|SomaAgenticExecutor|SelfModificationArbiter|SelfModificationPipeline|GoalPlannerArbiter|AutonomousHeartbeat|RiskGateway|PromotionLadder|package(-lock)?\.json/i;

    async function autoReviewProposal(proposal) {
        const shortId = proposal.taskId.slice(0, 8);
        const escalate = async (why) => {
            console.log(`[MAX] 🧑‍⚖️ Proposal ${shortId} escalated to Barry: ${why}`);
            await max.notifier?.notify(
                `🧑‍⚖️ **SOMA self-mod proposal needs YOUR call** (\`${shortId}\`)\nFile: \`${proposal.file}\`\nWhy escalated: ${why}\nRationale: ${proposal.rationale || 'n/a'}\nApprove: \`POST /api/soma/proposals/${shortId}/approve\``,
                { force: true }
            ).catch(() => {});
        };

        // Hard rails — never auto-approve these
        if (AUTO_REVIEW_PROTECTED.test(proposal.file || '')) return escalate('protected core file');
        if ((proposal.riskLevel || 'high') === 'high') return escalate(`risk level ${proposal.riskLevel || 'unknown'}`);
        if ((proposal.overallScore || 0) < 0.75) return escalate(`verification score ${((proposal.overallScore || 0) * 100).toFixed(0)}% < 75%`);
        if (!max.brain?._ready) return escalate('MAX brain not ready to review');

        try {
            const codePreview = String(proposal.newCode || '').split('\n').slice(0, 120).join('\n');
            const verificationSummary = proposal.verification
                ? Object.entries(proposal.verification).map(([k, v]) => `${k}: ${v?.pass ? 'pass' : 'FAIL'} (${((v?.confidence || 0) * 100).toFixed(0)}%)`).join(', ')
                : 'none provided';
            const result = await max.think(
                `You are MAX, the engineering reviewer with final approval authority over SOMA's self-modifications (delegated by Barry). Review this proposal and decide.

File: ${proposal.file}
Risk: ${proposal.riskLevel} | Verification score: ${((proposal.overallScore || 0) * 100).toFixed(0)}%
Automated gates: ${verificationSummary}
Rationale: ${proposal.rationale || 'n/a'}

PROPOSED CODE (first 120 lines):
\`\`\`
${codePreview}
\`\`\`

Judge: does the code actually do what the rationale claims, is it syntactically plausible, does it avoid obvious security/stability hazards (unbounded loops, deleted safety checks, secrets, network calls to unknown hosts), and is the blast radius contained to the stated file?
Reply ONLY with JSON: {"verdict":"approve"|"deny"|"escalate","confidence":0.0-1.0,"reason":"one sentence"}`,
                { tier: 'smart' }
            );
            const text = (result?.response || result?.text || '').toString();
            const parsed = JSON.parse(text.match(/\{[\s\S]*?\}/)?.[0] || '{}');

            if (parsed.verdict === 'approve' && (parsed.confidence || 0) >= 0.7) {
                await max.notifier?.notify(`🧬 **MAX approved** SOMA self-mod \`${shortId}\` for \`${proposal.file}\` (confidence ${((parsed.confidence || 0) * 100).toFixed(0)}%): ${parsed.reason || ''}`).catch(() => {});
                const applied = await approveProposal(proposal, 'MAX_auto_review');
                await max.notifier?.notify(applied?.applied !== false
                    ? `✅ Self-mod \`${shortId}\` applied and verified.`
                    : `⚠️ Self-mod \`${shortId}\` approved but apply pipeline reported failure — check MAX logs.`
                ).catch(() => {});
            } else if (parsed.verdict === 'deny') {
                denyProposal(proposal, 'MAX_auto_review', parsed.reason || 'failed MAX review');
                await max.notifier?.notify(`🚫 **MAX denied** SOMA self-mod \`${shortId}\` for \`${proposal.file}\`: ${parsed.reason || 'failed review'}`).catch(() => {});
            } else {
                await escalate(parsed.reason || `MAX verdict "${parsed.verdict || 'unparseable'}" (confidence ${parsed.confidence ?? '?'})`);
            }
        } catch (err) {
            await escalate(`review error: ${err.message}`);
        }
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
        // MAX reviews and decides autonomously (Barry delegated approval authority).
        // Deferred a few seconds so the HTTP response and console output land first.
        setTimeout(() => autoReviewProposal(proposal).catch(err =>
            console.warn(`[MAX] Auto-review failed for ${proposal.taskId.slice(0, 8)}: ${err.message}`)
        ), 5000);
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

        // Run apply in background — don't block the HTTP response
        res.json({ accepted: true, taskId: proposal.taskId });
        await approveProposal(proposal, 'user');
    });

    // Deny
    app.delete('/api/soma/proposals/:id', (req, res) => {
        const proposal = pendingProposals.get(req.params.id);
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        denyProposal(proposal, 'user');
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

    app.post('/api/goals/:id/clarify', (req, res) => {
        const answered = max.agentLoop?.answerClarification(req.params.id, req.body.answers);
        res.json({ success: !!answered });
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
                        <div style="color: #888; font-size: 0.8em;">${a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '—'} | ${a.type.toUpperCase()}</div>
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

            const result = await max.tools.execute(tool, action_name, { ...params, __source: 'ui' });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/status', (req, res) => {
        const status = req.query.full === '1'
            ? max.getStatus()
            : (max.getQuickStatus?.() || max.getStatus());
        res.json({ ...status, cwd: process.cwd().replace(/\\/g, '/') });
    });

    // ── Game preview — serve generated HTML game files ────────────────────
    app.get('/preview/:slug', async (req, res) => {
        const slug = req.params.slug.replace(/[^a-z0-9_-]/gi, '');
        const gamePath = join(process.cwd(), '.max', 'game-code', `${slug}.html`);
        try {
            const html = await fsp.readFile(gamePath, 'utf8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch {
            res.status(404).send(`<h2>Game not found: ${slug}</h2><p>Generate it with game_code.scaffold first.</p>`);
        }
    });

    // ── Health — detailed system status, always public ────────────────────
    app.get('/health', (req, res) => {
        const brain    = max.brain?.getStatus()          || {};
        const budget   = max.economics?.getBudgetStatus() || {};
        const goals    = max.goals?.getStatus()          || {};
        const mcp      = max.mcp?.getStatus()            || {};
        const security = max.security?.getStatus()       || { enabled: false };
        const mem      = process.memoryUsage();

        const healthy = max._ready && (brain.fast?.ready || brain.smart?.ready);

        res.status(healthy ? 200 : 503).json({
            status:   healthy ? 'healthy' : 'degraded',
            ready:    max._ready,
            version:  '1.0.0',
            systems: {
                brain:    { fast: brain.fast?.ready, smart: brain.smart?.ready, code: brain.code?.ready,
                            backends: { smart: brain.smart?.backend, code: brain.code?.backend } },
                budget:   { used: `$${budget.used?.toFixed(4) || '0'}`, cap: `$${budget.cap || 10}`, overBudget: budget.overBudget },
                goals:    { active: goals.active || 0, queued: max.goals?.listPending?.()?.length ?? 0 },
                memory:   { heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                            heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
                            contextDepth: max._context?.length ?? 0,
                            chatQueueDepth: max._chatQueue?.size ?? 0 },
                mcp:      { servers: mcp.count || 0 },
                security: { enabled: security.enabled }
            },
            lastError: max._lastError ?? null,
            uptime:    process.uptime()
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

    // ── SOMA-compatible chat endpoint (for other MAX/SOMA instances on the LAN) ──
    // Accepts the same JSON shape SomaBridge.think() sends; returns a plain JSON response.
    app.post('/api/soma/chat', async (req, res) => {
        const { message, systemPrompt, temperature, maxTokens } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });
        try {
            const t0 = Date.now();
            const result = await max.think(message, { temperature, maxTokens: maxTokens || 2048, systemPrompt });
            const text = result.response || result.text || '';
            res.json({
                success:  true,
                message:  text,
                response: text,
                metadata: { confidence: 0.85, brain: 'MAX', latency: { totalMs: Date.now() - t0 } }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
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
            // Rebuild if it's been more than 5 minutes or never run
            if (!max.graph.lastRebuild || Date.now() - max.graph.lastRebuild > 300000) {
                await max.graph.rebuild();
            }
            res.json(max.graph.getVisualizationData());
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
            const result = await max.tools.execute(tool, action, { ...req.body, __source: 'ui' });
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

    // ── Workspace edit approval ───────────────────────────────────────────
    app.post('/api/workspace-edits/:id/accept', async (req, res) => {
        const result = await max.workspaceEdits?.accept?.(req.params.id);
        if (!result) return res.status(404).json({ success: false, error: 'Workspace edit arbiter unavailable' });
        res.status(result.success === false ? 400 : 200).json(result);
    });

    app.post('/api/workspace-edits/:id/reject', (req, res) => {
        const result = max.workspaceEdits?.reject?.(req.params.id);
        if (!result) return res.status(404).json({ success: false, error: 'Workspace edit arbiter unavailable' });
        res.status(result.success === false ? 400 : 200).json(result);
    });

    // ── LSP endpoints (completions, hover, go-to-def, AI ghost text) ─────
    app.post('/api/lsp/complete', async (req, res) => {
        const { uri, position, languageId, content } = req.body || {};
        if (!uri || !position) return res.status(400).json({ items: [] });
        try {
            const result = await max.lsp?.getCompletions(uri, position, languageId, content);
            res.json(result ?? { items: [] });
        } catch (err) {
            res.json({ items: [] });
        }
    });

    app.post('/api/lsp/hover', async (req, res) => {
        const { uri, position, languageId } = req.body || {};
        if (!uri || !position) return res.status(400).json(null);
        try {
            const result = await max.lsp?.getHover(uri, position, languageId);
            res.json(result ?? null);
        } catch {
            res.json(null);
        }
    });

    app.post('/api/lsp/definition', async (req, res) => {
        const { uri, position, languageId } = req.body || {};
        if (!uri || !position) return res.status(400).json(null);
        try {
            const result = await max.lsp?.getDefinition(uri, position, languageId);
            res.json(result ?? null);
        } catch {
            res.json(null);
        }
    });

    // LRU cache for AI completions — avoids redundant LLM calls for identical prefixes
    const _completionCache = new Map(); // key → { completion, ts }
    const COMPLETION_CACHE_MAX = 200;
    const COMPLETION_CACHE_TTL = 5 * 60 * 1000; // 5 min

    app.post('/api/lsp/ai-complete', async (req, res) => {
        const { text, languageId = 'javascript', fileName = '' } = req.body || {};
        if (!text) return res.json({ completion: '' });

        // Cache key: last 300 chars of text (the relevant cursor context)
        const cacheKey = `${languageId}:${text.slice(-300)}`;
        const cached   = _completionCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < COMPLETION_CACHE_TTL) {
            return res.json({ completion: cached.completion, cached: true });
        }

        try {
            const completion = await max.lsp?.getAICompletion(text, languageId, fileName) ?? '';
            if (completion) {
                // Evict oldest if over limit
                if (_completionCache.size >= COMPLETION_CACHE_MAX) {
                    _completionCache.delete(_completionCache.keys().next().value);
                }
                _completionCache.set(cacheKey, { completion, ts: Date.now() });
            }
            res.json({ completion });
        } catch {
            res.json({ completion: '' });
        }
    });

    // ── Agent cancellation ────────────────────────────────────────────────
    app.post('/api/agent/interrupt', (req, res) => {
        const interrupted = max.abortAgent?.() || false;
        res.json({ interrupted });
    });

    // AgentLoop approval gate — IDE calls these instead of typing /approve or /deny in REPL
    app.post('/api/agent/approve', (req, res) => {
        if (!max.agentLoop?.approve) return res.status(404).json({ error: 'No pending approval' });
        max.agentLoop.approve();
        res.json({ approved: true });
    });

    app.post('/api/agent/deny', (req, res) => {
        if (!max.agentLoop?.deny) return res.status(404).json({ error: 'No pending approval' });
        max.agentLoop.deny();
        res.json({ denied: true });
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

    const host = process.env.MAX_HOST || '0.0.0.0';
    await new Promise((resolve, reject) => {
        const server = httpServer.listen(port, host, () => {
            console.log(`[MAX] 🌐 API  →  http://${host}:${port}`);
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
            reject(err);
        });
    });

    return {
        app,
        close: () => {
            clearInterval(_statusInterval);
            clearInterval(_somaInterval);
            clearTimeout(somaStatusTimeout);
            clearInterval(somaStatusInterval);
            wss.close();
            shutdownShellTool();
            return new Promise((resolve, reject) =>
                httpServer.close(err => err ? reject(err) : resolve())
            );
        }
    };
}
