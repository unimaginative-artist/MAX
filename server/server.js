// ═══════════════════════════════════════════════════════════════════════════
// server.js — MAX REST API
// Start with: node launcher.mjs --mode api [--port 3100]
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { applyProposal, isSomaHealthy } from '../core/SomaController.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createServer(max, port = 3100) {
    const app = express();
    app.use(express.json());

    // ── SSE client registry ───────────────────────────────────────────────
    const sseClients = new Set();

    function broadcast(obj) {
        const payload = `data: ${JSON.stringify(obj)}\n\n`;
        sseClients.forEach(res => { try { res.write(payload); } catch {} });
    }

    // Forward MAX insights to all SSE clients
    max.heartbeat?.on('insight', insight => {
        broadcast({ type: 'insight', ...insight });
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
    <title>MAX | System Dashboard</title>
    <style>
        body { background: #0a0a0a; color: #00ff41; font-family: 'Courier New', Courier, monospace; margin: 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { border: 1px solid #00ff41; padding: 15px; background: #111; }
        .card h2 { margin-top: 0; border-bottom: 1px solid #00ff41; padding-bottom: 10px; font-size: 1.2em; }
        .stat { display: flex; justify-content: space-between; margin: 5px 0; }
        .val { color: #fff; font-weight: bold; }
        .meter-bg { background: #222; height: 10px; width: 100%; margin-top: 10px; }
        .meter-fill { background: #00ff41; height: 100%; }
        .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 30px; }
        .pulse { animation: blink 1s infinite; }
        @keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
    </style>
    <meta http-equiv="refresh" content="5">
</head>
<body>
    <div class="header">
        <h1>MAX <span class="pulse">●</span> SYSTEM DASHBOARD</h1>
        <div>UPTIME: ${process.uptime().toFixed(0)}s</div>
    </div>

    <div class="grid">
        <div class="card">
            <h2>🧠 BRAIN & PERSONA</h2>
            <div class="stat"><span>PERSONA</span> <span class="val">${stats.persona.name}</span></div>
            <div class="stat"><span>BACKEND</span> <span class="val">${max.brain.getStatus().backend}</span></div>
            <div class="stat"><span>MODEL</span> <span class="val">${max.brain.getStatus().smart.model}</span></div>
        </div>

        <div class="card">
            <h2>⚙️  DRIVE SYSTEM</h2>
            <div class="stat"><span>TENSION</span> <span class="val">${(stats.drive.tension * 100).toFixed(1)}%</span></div>
            <div class="stat"><span>SATISFACTION</span> <span class="val">${(stats.drive.satisfaction * 100).toFixed(1)}%</span></div>
            <div class="meter-bg"><div class="meter-fill" style="width: ${stats.drive.tension * 100}%"></div></div>
        </div>

        <div class="card">
            <h2>💾 MEMORY TIERS</h2>
            <div class="stat"><span>TOTAL MEMORIES</span> <span class="val">${stats.memory.totalMemories}</span></div>
            <div class="stat"><span>VECTOR COUNT</span> <span class="val">${stats.memory.vectorCount}</span></div>
            <div class="stat"><span>HOT CACHE</span> <span class="val">${stats.memory.hotSize} items</span></div>
        </div>

        <div class="card">
            <h2>🛡️  SENTINEL & OMNISCIENCE</h2>
            <div class="stat"><span>INDEXED FILES</span> <span class="val">${stats.kb.sources}</span></div>
            <div class="stat"><span>SEMANTIC CHUNKS</span> <span class="val">${stats.kb.chunks}</span></div>
            <div class="stat"><span>WATCHER</span> <span class="val">ACTIVE</span></div>
        </div>

        <div class="card">
            <h2>🚀 PERFORMANCE (APM)</h2>
            <div class="stat"><span>TOTAL TOKENS</span> <span class="val">${stats.outcomes.totalTokens.toLocaleString()}</span></div>
            <div class="stat"><span>AVG LATENCY</span> <span class="val">${stats.outcomes.avgLatency.toFixed(0)}ms</span></div>
            <div class="stat"><span>SUCCESS RATE</span> <span class="val">${(stats.outcomes.success / (stats.outcomes.total || 1) * 100).toFixed(1)}%</span></div>
        </div>
    </div>

    <div class="grid" style="margin-top: 20px; grid-template-columns: 1fr;">
        <div class="card">
            <h2>📦 ARTIFACTS & HIDDEN CODE</h2>
            <div style="max-height: 400px; overflow-y: auto;">
                ${max.artifacts.list().map(a => `
                    <div style="border-bottom: 1px solid #222; padding: 10px 0;">
                        <div style="display: flex; justify-content: space-between; color: #888; font-size: 0.8em;">
                            <span>ID: ${a.id} | TYPE: ${a.type} | ${a.lineCount} lines</span>
                            <span>${new Date(a.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div style="color: #fff; margin: 5px 0;">${a.name}</div>
                        <pre style="background: #000; padding: 10px; font-size: 0.85em; color: #00ff41; overflow-x: auto;">${
                            a.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 1000)
                        }${a.content.length > 1000 ? '\n... (truncated in view)' : ''}</pre>
                    </div>
                `).join('') || '<div style="color: #444; padding: 20px;">No artifacts generated in this session yet.</div>'}
            </div>
        </div>
    </div>
</body>
</html>
        `;
        res.send(html);
    });

    // ── Status ────────────────────────────────────────────────────────────
    app.get('/api/status', (req, res) => {
        res.json(max.getStatus());
    });

    // ── Chat ──────────────────────────────────────────────────────────────
    app.post('/api/chat', async (req, res) => {
        const { message, persona, temperature, maxTokens } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });

        try {
            const result = await max.think(message, { persona, temperature, maxTokens });
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
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
        const { title, description, stakes } = req.body;
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
        const server = app.listen(port, () => {
            console.log(`[MAX] 🌐 Web UI  →  http://localhost:${port}`);
            console.log(`[MAX]   POST /api/chat      — chat`);
            console.log(`[MAX]   GET  /api/events    — SSE live feed`);
            console.log(`[MAX]   GET  /api/goals     — list goals`);
            console.log(`[MAX]   POST /api/goals     — add goal`);
            console.log(`[MAX]   GET  /api/status    — system status`);
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
