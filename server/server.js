// ═══════════════════════════════════════════════════════════════════════════
// server.js — MAX REST API
// Start with: node launcher.mjs --mode api [--port 3100]
// ═══════════════════════════════════════════════════════════════════════════

import express from 'express';

export async function createServer(max, port = 3100) {
    const app = express();
    app.use(express.json());

    // CORS for local frontends
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
        next();
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

    app.listen(port, () => {
        console.log(`[MAX] 🌐 API server running at http://localhost:${port}`);
        console.log(`[MAX]   POST /api/chat     — talk to MAX`);
        console.log(`[MAX]   POST /api/swarm    — run swarm job`);
        console.log(`[MAX]   POST /api/debate   — adversarial debate`);
        console.log(`[MAX]   GET  /api/status   — system status`);
    });

    return app;
}
