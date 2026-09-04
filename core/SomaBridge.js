// ═══════════════════════════════════════════════════════════════════════════
// SomaBridge.js — Connects MAX to SOMA's QuadBrain + MnemonicArbiter
// When SOMA is running (localhost OR a LAN IP), MAX uses it as priority-0 brain.
// Falls back to MAX's own Brain.js automatically if SOMA is unreachable.
//
// Cross-machine setup: set SOMA_URL=http://192.168.x.x:3001 in config/api-keys.env
// The HTTP bridge AND WebSocket signal bridge will both reach SOMA over LAN.
// ═══════════════════════════════════════════════════════════════════════════

import { applyProposal } from './SomaController.js';
import { BridgeTaskLedger } from './BridgeTaskLedger.js';
import { createHash } from 'crypto';

export class SomaBridge {
    constructor(config = {}) {
        this.baseUrl     = config.url || process.env.SOMA_URL || 'http://localhost:3001';
        this._ready      = false;
        this._available  = false;
        this._lastCheck  = 0;
        this._checkEvery = 60_000;  // re-probe every 60s if it was down
        this.stats       = { calls: 0, hits: 0, errors: 0, avgLatencyMs: 0 };
        this.tasks       = new BridgeTaskLedger(config.taskLedger);
        this._offlineLogged = false;
        this._lastStartAttempt = 0;

        // ── Signal bridge (WebSocket — works cross-machine over LAN) ─────
        this._signalWs            = null;
        this._signalConnected     = false;
        this._signalHandlers      = new Map(); // topic → Set<Function>
        this._signalStopped       = false;
        this._signalReconnectTimer = null;
        this._wsUrl               = this.baseUrl.replace(/^http/, 'ws') + '/ws';
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    async initialize() {
        await this._probe();
        if (this._available) this._connectSignal();
        return this;
    }

    async _probe({ autoStart = true } = {}) {
        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/health`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
            ]);
            this._available = r.ok;
        } catch {
            this._available = false;
        }

        if (!this._available) {
            const isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
            if (isLocal && autoStart) {
                const now = Date.now();
                if (now - this._lastStartAttempt > 60000) {
                    this._lastStartAttempt = now;
                    console.log('[SomaBridge] 🛰️ SOMA offline. Attempting to auto-start SOMA...');
                    import('./SomaController.js').then(({ startSoma }) => {
                        startSoma().catch(err => console.error('[SomaBridge] Auto-start SOMA failed:', err.message));
                    }).catch(() => {});
                }
            }
        }

        const wasAvailable = this._ready;
        this._ready     = this._available;
        this._lastCheck = Date.now();

        const cameOnline = this._available && !wasAvailable;

        if (this._available) {
            console.log('[SomaBridge] ✅ SOMA online — QuadBrain active');
            this._offlineLogged = false;
        } else {
            this._offlineLogged = true;
        }

        if (cameOnline && !this._signalConnected && !this._signalStopped) {
            this._connectSignal();
        }

        return this._available;
    }

    async checkHealth({ startIfOffline = false } = {}) {
        const available = await this._probe({ autoStart: startIfOffline });
        return {
            available,
            action: !available && startIfOffline ? 'start_requested' : 'none',
            baseUrl: this.baseUrl,
            checkedAt: Date.now()
        };
    }

    get available() {
        // Auto re-probe if we haven't checked recently
        if (!this._available && Date.now() - this._lastCheck > this._checkEvery) {
            this._probe().catch(() => {});
        }
        return this._available;
    }

    // ── WebSocket Signal Bridge (works over LAN) ──────────────────────────

    /** Subscribe to a SOMA broadcast topic. Returns unsubscribe fn. */
    subscribe(topic, handler) {
        if (!this._signalHandlers.has(topic)) this._signalHandlers.set(topic, new Set());
        this._signalHandlers.get(topic).add(handler);
        return () => this._signalHandlers.get(topic)?.delete(handler);
    }

    /** Push a signal to SOMA. SOMA routes it to its own subscribers. */
    publish(topic, data = {}) {
        if (!this._signalConnected || !this._signalWs) return false;
        try {
            this._signalWs.send(JSON.stringify({ topic, data, source: 'MAX', ts: Date.now() }));
            return true;
        } catch { return false; }
    }

    _connectSignal() {
        if (this._signalStopped) return;
        if (this._signalWs) { try { this._signalWs.terminate(); } catch {} }

        import('ws').then(({ WebSocket }) => {
            const ws = new WebSocket(this._wsUrl);
            this._signalWs = ws;

            ws.on('open', () => {
                this._signalConnected = true;
                clearTimeout(this._signalReconnectTimer);
                console.log('[SomaBridge] 🔌 Signal bridge connected →', this._wsUrl);
                ws.send(JSON.stringify({ type: 'register', name: 'MAX', version: '1.0' }));
            });

            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }
                const topic = msg.topic || msg.type || 'unknown';
                for (const [t, handlers] of this._signalHandlers) {
                    if (t === '*' || t === topic) {
                        for (const h of handlers) { try { h(msg.data ?? msg, topic); } catch {} }
                    }
                }
            });

            ws.on('close', () => {
                this._signalConnected = false;
                if (!this._signalStopped) this._scheduleSignalReconnect();
            });

            ws.on('error', () => { this._signalConnected = false; });
        }).catch(() => {}); // ws module not available — signal bridge disabled
    }

    _scheduleSignalReconnect() {
        clearTimeout(this._signalReconnectTimer);
        this._signalReconnectTimer = setTimeout(() => {
            if (!this._signalStopped && this._available) this._connectSignal();
        }, 5_000);
    }

    disconnectSignal() {
        this._signalStopped = true;
        clearTimeout(this._signalReconnectTimer);
        if (this._signalWs) { try { this._signalWs.terminate(); } catch {} this._signalWs = null; }
        this._signalConnected = false;
    }

    // ── Brain bridge ──────────────────────────────────────────────────────

    /**
     * Sends a prompt to SOMA's QuadBrain.
     * Returns { text, confidence, brain } matching MAX Brain.think() shape.
     */
    async think(prompt, options = {}) {
        if (!this._available) throw new Error('SOMA not available');

        const t0 = Date.now();
        this.stats.calls++;

        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/soma/chat`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        message:      prompt,
                        systemPrompt: options.systemPrompt,   // pass MAX's tool manifest + state
                        temperature:  options.temperature,
                        maxTokens:    options.maxTokens,
                        persona:      options.persona,
                        deepThinking: options.deepThinking || false,
                    })
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('SOMA timeout')), options.timeout || 12_000))
            ]);

            if (!r.ok) throw new Error(`SOMA ${r.status}`);
            const data = await r.json();

            const text = data.message || data.response || data.text || '';
            const latency = Date.now() - t0;
            this.stats.hits++;
            this.stats.avgLatencyMs = Math.round(
                (this.stats.avgLatencyMs * (this.stats.hits - 1) + latency) / this.stats.hits
            );

            return {
                text,
                confidence: data.metadata?.confidence ?? 0.85,
                backend:    'SOMA',
                model:      data.metadata?.brain || 'QuadBrain',
                latency,
            };
        } catch (err) {
            this.stats.errors++;
            // Mark unavailable so MAX falls back to local brain immediately
            if (err.message.includes('SOMA') || err.message.includes('ECONNREFUSED')) {
                this._available = false;
                this._lastCheck = Date.now();
            }
            throw err;
        }
    }

    // ── Memory bridge ─────────────────────────────────────────────────────

    /** Store a memory in SOMA's MnemonicArbiter (fire-and-forget) */
    async remember(text, metadata = {}) {
        if (!this._available) return;
        try {
            const { default: fetch } = await import('node-fetch');
            await fetch(`${this.baseUrl}/api/soma/memory/promote`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ content: text, metadata })
            });
        } catch {}  // memory errors never block
    }

    /** Search SOMA's memory — returns array of { content, score } */
    async recall(query, options = {}) {
        if (!this._available) return [];
        try {
            const { default: fetch } = await import('node-fetch');
            const params = new URLSearchParams({ q: query, limit: options.topK || 5 });
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/soma/memory/excavate?${params}`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
            ]);
            if (!r.ok) return [];
            const data = await r.json();
            return Array.isArray(data) ? data : (data.results || data.memories || []);
        } catch {
            return [];
        }
    }

    // ── SOMA Goal Injection ───────────────────────────────────────────────

    /**
     * Inject a goal directly into SOMA's agentic loop.
     * This makes MAX a true co-pilot — able to steer SOMA's focus.
     * goal: { title, description, type, priority }
     */
    async injectGoal(goal) {
        if (!this._available) return { success: false, error: 'SOMA offline' };
        const { task, created } = this.tasks.create({ type: 'goal.inject', payload: goal });
        if (!created) return { success: true, deduplicated: true, taskId: task.id, status: task.status };
        try {
            this.tasks.beginAttempt(task.id);
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/goals`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(goal)
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))
            ]);
            if (!r.ok) throw new Error(`SOMA ${r.status}`);
            const data = await r.json();
            this.tasks.transition(task.id, 'accepted', { evidence: { goalId: data.id || null, httpStatus: r.status } });
            console.log(`[SomaBridge] 🎯 Goal injected into SOMA: "${goal.title}"`);
            return { success: true, goalId: data.id, taskId: task.id, status: 'accepted' };
        } catch (err) {
            const updated = this.tasks.retry(task.id, err.message);
            return { success: false, error: err.message, taskId: task.id, status: updated.status };
        }
    }

    /**
     * Fetch live SOMA daemon/agent status.
     * Returns health, active agents, pending goals, last error.
     */
    async getSomaStatus() {
        if (!this._available) return null;
        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/system/status`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
            ]);
            if (!r.ok) return null;
            return await r.json();
        } catch {
            return null;
        }
    }

    /** Fetch SOMA's active goals list. Returns { goals, count } or null if offline. */
    async getSomaGoals() {
        if (!this._available) return null;
        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/goals/active`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
            ]);
            if (!r.ok) return null;
            return await r.json();
        } catch {
            return null;
        }
    }

    // ── Tool Proxy ───────────────────────────────────────────────────────

    /**
     * Execute any SOMA tool by name.
     * Gives MAX access to SOMA's full tool suite: computer_control, vision_scan,
     * visual_task, screenshot, audio, whisper, and all 14+ registered tools.
     *
     * Usage:
     *   await somaBridge.callTool('vision_scan', { source: 'screen' })
     *   await somaBridge.callTool('computer_control', { actionType: 'click', label: 'Submit' })
     *   await somaBridge.callTool('visual_task', { instruction: 'Click the login button' })
     */
    async callTool(toolName, args = {}, timeoutMs = 15000) {
        if (!this._available) return { success: false, error: 'SOMA offline' };
        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/tools/execute`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ name: toolName, args })
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
            ]);
            if (!r.ok) return { success: false, error: `SOMA ${r.status}` };
            const data = await r.json();
            return { success: true, result: data.result ?? data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ── Diagnostics & Engineering ────────────────────────────────────────

    /**
     * Section 8: SomaHealthScanner.
     * MAX audits the SOMA kernel's health and proposes improvements.
     */
    async auditSoma() {
        if (!this._available) return null;

        try {
            const { default: fetch } = await import('node-fetch');
            const res = await fetch(`${this.baseUrl}/api/system/status`);
            if (!res.ok) return null;
            
            const somaStatus = await res.json();
            const discoveries = [];

            // Detect SOMA bottlenecks
            if (somaStatus.memory?.pressure > 0.8) {
                discoveries.push({
                    title: "SOMA: Optimize MnemonicArbiter memory pressure",
                    priority: 0.85,
                    type: "optimization"
                });
            }

            if (somaStatus.brain?.errors > 10) {
                discoveries.push({
                    title: "SOMA: Debug frequent QuadBrain failovers",
                    priority: 0.9,
                    type: "fix"
                });
            }

            return discoveries;
        } catch { return null; }
    }

    /**
     * Notify SOMA that MAX modified one of its files.
     * SOMA logs the event and can trigger hot-reload / restart as needed.
     * Fire-and-forget — never blocks the build cycle.
     */
    async notifyFileChanged(filePath) {
        if (!this._available) return;
        try {
            const { default: fetch } = await import('node-fetch');
            await Promise.race([
                fetch(`${this.baseUrl}/api/soma/file-changed`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ path: filePath, source: 'MAX', ts: Date.now() })
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
            ]);
        } catch { /* non-blocking */ }
    }

    /**
     * Section 1: Hot-patch a SOMA module.
     * Allows MAX to push code improvements directly to the SOMA kernel.
     */
    async deployToSoma(moduleName, code) {
        if (!this._available) return { success: false, error: 'SOMA offline' };

        const { task, created } = this.tasks.create({
            type: 'code.deploy',
            payload: {
                moduleName,
                codeHash: createHash('sha256').update(String(code || '')).digest('hex')
            }
        });
        if (!created) return { success: false, deduplicated: true, taskId: task.id, status: task.status };

        try {
            this.tasks.beginAttempt(task.id);
            const result = await applyProposal({
                taskId: task.id,
                file: moduleName,
                newCode: code,
                rationale: 'MAX to SOMA verified bridge deployment'
            });
            if (!result.applied) {
                this.tasks.transition(task.id, 'failed', { evidence: result, error: result.error || result.reason || 'deployment rejected' });
                return { success: false, taskId: task.id, ...result };
            }
            this.tasks.transition(task.id, 'accepted', { evidence: { receiptPath: result.receiptPath } });
            this.tasks.transition(task.id, 'completed', { evidence: result });
            return { success: true, taskId: task.id, ...result };
        } catch (err) {
            const updated = this.tasks.retry(task.id, err.message);
            return { success: false, error: err.message, taskId: task.id, status: updated.status };
        }
    }

    // ── SOMA → MAX curiosity goal sync ───────────────────────────────────

    /**
     * Pull pending curiosity goals from SOMA and inject them into MAX's GoalEngine.
     * Called periodically so MAX stays aligned with what SOMA is curious about.
     * Returns number of goals injected.
     */
    async syncCuriosityGoals(maxGoals) {
        if (!this._available || !maxGoals) return 0;
        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(`${this.baseUrl}/api/goals?source=curiosity&limit=5`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
            ]);
            if (!r.ok) return 0;
            const data  = await r.json();
            const goals = Array.isArray(data) ? data : (data.goals || data.items || []);
            let injected = 0;
            for (const g of goals.slice(0, 3)) {
                if (!g?.title) continue;
                maxGoals.addGoal({
                    title:       `[SOMA] ${g.title}`.slice(0, 120),
                    description: (g.description || '').slice(0, 400),
                    type:        g.type || 'research',
                    source:      'soma_curiosity',
                    priority:    Math.min(0.7, g.priority || 0.4)
                });
                injected++;
            }
            if (injected > 0) {
                console.log(`[SomaBridge] 🎯 Synced ${injected} curiosity goal(s) from SOMA`);
            }
            return injected;
        } catch {
            return 0;
        }
    }

    // ── Status ────────────────────────────────────────────────────────────

    getStatus() {
        return {
            available:       this._available,
            baseUrl:         this.baseUrl,
            signalConnected: this._signalConnected,
            wsUrl:           this._wsUrl,
            ...this.stats
        };
    }
}
