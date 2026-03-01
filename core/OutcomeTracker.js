// ═══════════════════════════════════════════════════════════════════════════
// OutcomeTracker.js — every action MAX takes gets logged here
// Tracks: what happened, did it work, reward signal, duration
// MAX learns what approaches work by querying his own history
// Ported from SOMA OutcomeTracker.js — converted to ESM, simplified for MAX
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs               from 'fs/promises';
import path             from 'path';

export class OutcomeTracker extends EventEmitter {
    constructor(config = {}) {
        super();
        this.storageDir = config.storageDir || path.join(process.cwd(), '.max', 'outcomes');

        // In-memory indexes (fast queries)
        this._outcomes       = new Map();   // id → outcome
        this._byAgent        = new Map();   // agent → Set<id>
        this._byAction       = new Map();   // action → Set<id>
        this._byTimestamp    = [];          // [{ts, id}] sorted

        this.stats = {
            total: 0, success: 0, failed: 0,
            avgReward: 0,
            totalTokens: 0,
            avgLatency: 0,
            byAction: {},   // action → { count, successRate, avgReward, avgTokens, avgLatency }
            byAgent:  {}    // agent  → { count, successRate, avgReward }
        };

        this._persistTimer = null;
        this._ready = false;
    }

    async initialize() {
        await fs.mkdir(this.storageDir, { recursive: true });
        await this._load();
        this._persistTimer = setInterval(() => this._persist(), 60_000);
        this._ready = true;
        console.log(`[OutcomeTracker] ✅ ${this.stats.total} outcomes loaded`);
    }

    // ─── Record an outcome ────────────────────────────────────────────────
    record({ agent, action, context = {}, result, success, reward, duration, tokens = 0, metadata = {} }) {
        if (!agent || !action) throw new Error('agent and action required');

        const id  = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const ts  = Date.now();
        const r   = reward ?? (success ? 1.0 : -1.0);
        const ok  = success ?? (r > 0);

        const entry = { id, agent, action, context, result, success: ok, reward: r, duration, tokens, metadata, ts };

        // Store + index
        this._outcomes.set(id, entry);
        this._index(this._byAgent,  agent,  id);
        this._index(this._byAction, action, id);
        this._byTimestamp.push({ ts, id });

        // Stats
        this.stats.total++;
        this.stats.totalTokens += tokens;
        ok ? this.stats.success++ : this.stats.failed++;
        const n = this.stats.total;
        this.stats.avgReward = ((this.stats.avgReward * (n - 1)) + r) / n;
        
        if (duration) {
            this.stats.avgLatency = ((this.stats.avgLatency * (this.stats.total - 1)) + duration) / this.stats.total;
        }

        this._updateBucket(this.stats.byAction, action, ok, r, tokens, duration);
        this._updateBucket(this.stats.byAgent,  agent,  ok, r);

        // Evict if too large
        if (this._outcomes.size > 10_000) this._evict(500);

        this.emit('outcome', entry);
        return id;
    }

    // ─── Query outcomes ───────────────────────────────────────────────────
    query({ agent, action, success, minReward, since, limit = 50, sortBy = 'ts', order = 'desc' } = {}) {
        let results = agent
            ? [...(this._byAgent.get(agent) || [])].map(id => this._outcomes.get(id)).filter(Boolean)
            : action
            ? [...(this._byAction.get(action) || [])].map(id => this._outcomes.get(id)).filter(Boolean)
            : [...this._outcomes.values()];

        if (success !== undefined) results = results.filter(o => o.success === success);
        if (minReward !== undefined) results = results.filter(o => o.reward >= minReward);
        if (since !== undefined) results = results.filter(o => o.ts >= since);
        if (agent && action) results = results.filter(o => o.action === action);

        results.sort((a, b) => order === 'asc' ? a[sortBy] - b[sortBy] : b[sortBy] - a[sortBy]);
        return results.slice(0, limit);
    }

    // ─── What approach works best for a given action? ─────────────────────
    getBestApproach(action) {
        const outcomes = this.query({ action, success: true, limit: 20 });
        if (outcomes.length === 0) return null;
        // Return the highest-reward outcome's context as the "best known approach"
        return outcomes.sort((a, b) => b.reward - a.reward)[0];
    }

    // ─── Success rate for an agent/action in a time window ────────────────
    getSuccessRate(agent, action = null, windowMs = 3_600_000) {
        const outcomes = this.query({ agent, action, since: Date.now() - windowMs });
        if (!outcomes.length) return null;
        return outcomes.filter(o => o.success).length / outcomes.length;
    }

    // ─── Summary for system prompt injection ─────────────────────────────
    getSummary() {
        const rate = this.stats.total > 0
            ? ((this.stats.success / this.stats.total) * 100).toFixed(0)
            : 'n/a';
        return `Actions tracked: ${this.stats.total} | Success rate: ${rate}% | Avg reward: ${this.stats.avgReward.toFixed(2)}`;
    }

    // ─── Internals ────────────────────────────────────────────────────────
    _index(map, key, id) {
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(id);
    }

    _updateBucket(obj, key, success, reward, tokens = 0, duration = 0) {
        if (!obj[key]) obj[key] = { count: 0, successRate: 0, avgReward: 0, avgTokens: 0, avgLatency: 0 };
        const b = obj[key];
        const n = b.count + 1;
        b.successRate = (b.successRate * b.count + (success ? 1 : 0)) / n;
        b.avgReward   = (b.avgReward   * b.count + reward)            / n;
        b.avgTokens   = (b.avgTokens   * b.count + tokens)            / n;
        if (duration) {
            b.avgLatency  = (b.avgLatency  * b.count + duration)          / n;
        }
        b.count = n;
    }

    _evict(n) {
        this._byTimestamp.sort((a, b) => a.ts - b.ts);
        const toEvict = this._byTimestamp.splice(0, n);
        for (const { id } of toEvict) {
            const o = this._outcomes.get(id);
            if (!o) continue;
            this._outcomes.delete(id);
            this._byAgent.get(o.agent)?.delete(id);
            this._byAction.get(o.action)?.delete(id);
        }
    }

    async _persist() {
        try {
            const file = path.join(this.storageDir, 'outcomes_current.json');
            await fs.writeFile(file, JSON.stringify({ stats: this.stats, outcomes: [...this._outcomes.values()] }));
        } catch { /* non-fatal */ }
    }

    async _load() {
        try {
            const file = path.join(this.storageDir, 'outcomes_current.json');
            const raw  = await fs.readFile(file, 'utf8');
            const data = JSON.parse(raw);
            if (data.stats) this.stats = data.stats;
            for (const o of (data.outcomes || [])) {
                this._outcomes.set(o.id, o);
                this._index(this._byAgent,  o.agent,  o.id);
                this._index(this._byAction, o.action, o.id);
                this._byTimestamp.push({ ts: o.ts, id: o.id });
            }
        } catch { /* start fresh */ }
    }

    async shutdown() {
        clearInterval(this._persistTimer);
        await this._persist();
    }

    getStats() { return { ...this.stats, inMemory: this._outcomes.size }; }
}
