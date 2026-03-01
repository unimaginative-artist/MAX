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
