// ═══════════════════════════════════════════════════════════════════════════
// MaxMemory.js — 3-tier persistent memory
//
// Inspired by SOMA's MnemonicArbiter, rebuilt for MAX (ESM, no BaseArbiter,
// no Redis — single-user agent doesn't need a cache server)
//
//  HOT tier  — JS Map, current session, <1ms
//  WARM tier — in-memory vector store, semantic search, ~5ms
//  COLD tier — SQLite, survives restarts, ~20ms
//
// Special: workspace tracking — MAX knows what you're building
// ═══════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import fs       from 'fs';
import path     from 'path';
import crypto   from 'crypto';
import { Embedder } from './Embedder.js';

const IMPORTANCE_DECAY_DAYS = 30;   // forget unaccessed low-importance after 30d
const MIN_IMPORTANCE        = 0.25; // below this + old = candidate for pruning
const VECTOR_PERSIST_MS     = 15_000;
const CLEANUP_MS            = 5 * 60 * 1000;

export class MaxMemory {
    constructor(config = {}) {
        this.dbPath      = config.dbPath || path.join(process.cwd(), '.max', 'memory.db');
        this.vectorPath  = config.vectorPath || path.join(process.cwd(), '.max', 'vectors.json');
        this.embedder    = new Embedder();

        // Three tiers
        this._hot     = new Map();              // id → { content, metadata, ts }
        this._vectors = new Map();              // id → float array (384)
        this._db      = null;

        this._vectorsDirty = false;
        this._persistTimer = null;
        this._cleanupTimer = null;

        this.metrics = {
            hot:  { hits: 0, misses: 0 },
            warm: { hits: 0, misses: 0 },
            cold: { hits: 0, misses: 0 },
            stores: 0
        };
    }

    // ─── Initialize all tiers ─────────────────────────────────────────────
    async initialize() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Cold tier
        this._db = new Database(this.dbPath);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('synchronous = NORMAL');
        this._createSchema();

        // Warm tier — load existing vectors from disk
        this._loadVectors();

        // Start background jobs
        this._startPersistence();
        this._startCleanup();

        // Try to load embedder (non-blocking — falls back to keyword search if missing)
        this.embedder.initialize().catch(() => {});

        console.log(`[Memory] ✅ Online — ${this._countMemories()} memories | vectors: ${this._vectors.size}`);
    }

    _createSchema() {
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id           TEXT    PRIMARY KEY,
                type         TEXT    NOT NULL DEFAULT 'general',
                content      TEXT    NOT NULL,
                metadata     TEXT    DEFAULT '{}',
                created_at   INTEGER NOT NULL,
                accessed_at  INTEGER NOT NULL,
                access_count INTEGER DEFAULT 0,
                importance   REAL    DEFAULT 0.5
            );
            CREATE INDEX IF NOT EXISTS idx_type       ON memories(type);
            CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC);
            CREATE INDEX IF NOT EXISTS idx_accessed   ON memories(accessed_at DESC);

            CREATE TABLE IF NOT EXISTS conversations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                role       TEXT    NOT NULL,
                content    TEXT    NOT NULL,
                persona    TEXT    DEFAULT 'grinder',
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preferences (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                updated_at INTEGER NOT NULL
            );
        `);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STORE
    // ═══════════════════════════════════════════════════════════════════════

    async remember(content, metadata = {}, { importance = 0.5, type = 'general' } = {}) {
        if (!content?.trim()) return null;

        const id  = crypto.randomUUID();
        const now = Date.now();
        const meta = typeof metadata === 'string' ? { note: metadata } : metadata;

        // Hot tier
        this._hot.set(id, { id, content, metadata: meta, type, importance, ts: now });

        // Cold tier (always)
        this._db.prepare(`
            INSERT OR REPLACE INTO memories (id, type, content, metadata, created_at, accessed_at, importance)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, type, content, JSON.stringify(meta), now, now, importance);

        // Warm tier — embed async, don't block
        this._embedAndStore(id, content);

        this.metrics.stores++;
        return id;
    }

    async _embedAndStore(id, content) {
        try {
            const vec = await this.embedder.embed(content);
            if (vec) {
                this._vectors.set(id, vec);
                this._vectorsDirty = true;
            }
        } catch { /* non-fatal */ }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECALL — semantic search across all tiers
    // ═══════════════════════════════════════════════════════════════════════

    async recall(query, { topK = 8, type = null } = {}) {
        if (!query?.trim()) return [];

        // 1. Try warm tier (vector search)
        if (this.embedder._ready && this._vectors.size > 0) {
            const results = await this._vectorSearch(query, topK, type);
            if (results.length > 0) {
                this.metrics.warm.hits++;
                this._touchMany(results.map(r => r.id));
                return results;
            }
            this.metrics.warm.misses++;
        }

        // 2. Fall back to cold tier keyword search
        this.metrics.cold.hits++;
        return this._keywordSearch(query, topK, type);
    }

    async _vectorSearch(query, topK, type) {
        const queryVec = await this.embedder.embed(query);
        if (!queryVec) return [];

        // Score all vectors
        const scored = [];
        for (const [id, vec] of this._vectors) {
            const score = Embedder.cosine(queryVec, vec);
            if (score > 0.3) scored.push({ id, score });
        }

        scored.sort((a, b) => b.score - a.score);
        const topIds = scored.slice(0, topK).map(s => s.id);
        if (topIds.length === 0) return [];

        // Hydrate from cold tier
        const placeholders = topIds.map(() => '?').join(',');
        let rows = this._db.prepare(
            `SELECT * FROM memories WHERE id IN (${placeholders})`
        ).all(...topIds);

        if (type) rows = rows.filter(r => r.type === type);

        return rows.map(r => ({
            ...r,
            metadata: this._parseMeta(r.metadata),
            score:    scored.find(s => s.id === r.id)?.score || 0
        })).sort((a, b) => b.score - a.score);
    }

    _keywordSearch(query, topK, type) {
        const q = `%${query.slice(0, 100)}%`;
        let sql = 'SELECT * FROM memories WHERE content LIKE ? ORDER BY importance DESC, accessed_at DESC LIMIT ?';
        const params = [q, topK];

        if (type) {
            sql = 'SELECT * FROM memories WHERE content LIKE ? AND type = ? ORDER BY importance DESC, accessed_at DESC LIMIT ?';
            params.splice(1, 0, type);
        }

        return this._db.prepare(sql).all(...params).map(r => ({
            ...r,
            metadata: this._parseMeta(r.metadata),
            score: 0
        }));
    }

    // ─── Recall by exact type ─────────────────────────────────────────────
    recallRecent(type, limit = 20) {
        return this._db.prepare(
            'SELECT * FROM memories WHERE type = ? ORDER BY accessed_at DESC LIMIT ?'
        ).all(type, limit).map(r => ({ ...r, metadata: this._parseMeta(r.metadata) }));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONVERSATIONS
    // ═══════════════════════════════════════════════════════════════════════

    addConversation(role, content, persona = 'grinder') {
        this._db.prepare(
            'INSERT INTO conversations (role, content, persona, created_at) VALUES (?, ?, ?, ?)'
        ).run(role, content, persona, Date.now());

        // Also store in memories so it's searchable
        this.remember(
            `${role.toUpperCase()}: ${content}`,
            { role, persona, source: 'conversation' },
            { type: 'conversation', importance: role === 'user' ? 0.6 : 0.4 }
        );

        // Extract workspace signals from user messages
        if (role === 'user') this._extractWorkspace(content);
    }

    getConversationHistory(limit = 20) {
        return this._db.prepare(
            'SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?'
        ).all(limit).reverse();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // WORKSPACE — what is the user working on?
    // ═══════════════════════════════════════════════════════════════════════

    _extractWorkspace(userMessage) {
        // File paths
        const files = userMessage.match(/[\w./\\-]+\.(js|ts|py|jsx|tsx|css|json|md|cjs|mjs|html|go|rs|java|c|cpp)\b/g) || [];
        for (const f of files.slice(0, 5)) this._upsertWorkspace('recent_files', f, 0.8);

        // Technologies (common keywords)
        const techPatterns = /\b(react|vue|node|python|rust|go|docker|kubernetes|postgres|mongodb|redis|typescript|graphql|nextjs|express|fastapi|django|rails)\b/gi;
        const techs = [...new Set((userMessage.match(techPatterns) || []).map(t => t.toLowerCase()))];
        for (const t of techs) this._upsertWorkspace('technologies', t, 0.7);

        // Ongoing tasks (imperative phrases)
        const taskPatterns = /\b(building|implementing|fixing|refactoring|debugging|writing|creating|adding|deploying)\s+([a-zA-Z\s]{3,30})/gi;
        const tasks = userMessage.match(taskPatterns) || [];
        for (const t of tasks.slice(0, 3)) this._upsertWorkspace('ongoing_tasks', t.trim(), 0.6);
    }

    _upsertWorkspace(key, value, confidence) {
        // Maintain a comma-separated list per key (most recent first)
        const existing = this._db.prepare('SELECT value FROM workspace WHERE key = ?').get(key);
        let list = existing ? existing.value.split('|||').filter(Boolean) : [];
        list = [value, ...list.filter(v => v !== value)].slice(0, 10);

        this._db.prepare(
            'INSERT OR REPLACE INTO workspace (key, value, confidence, updated_at) VALUES (?, ?, ?, ?)'
        ).run(key, list.join('|||'), confidence, Date.now());
    }

    getWorkspaceContext() {
        const rows = this._db.prepare('SELECT * FROM workspace ORDER BY updated_at DESC').all();
        const ctx  = {};
        for (const row of rows) {
            ctx[row.key] = row.value.split('|||').filter(Boolean);
        }
        return ctx;
    }

    // ─── Build a context string for injection into system prompt ──────────
    getContextString() {
        const ws = this.getWorkspaceContext();
        const parts = [];

        if (ws.ongoing_tasks?.length) {
            parts.push(`Working on: ${ws.ongoing_tasks.slice(0, 3).join(', ')}`);
        }
        if (ws.technologies?.length) {
            parts.push(`Tech stack: ${ws.technologies.slice(0, 6).join(', ')}`);
        }
        if (ws.recent_files?.length) {
            parts.push(`Recent files: ${ws.recent_files.slice(0, 5).join(', ')}`);
        }

        const prefs = this._db.prepare('SELECT key, value FROM preferences ORDER BY confidence DESC LIMIT 5').all();
        if (prefs.length > 0) {
            parts.push(`User preferences: ${prefs.map(p => `${p.key}=${p.value}`).join(', ')}`);
        }

        return parts.length > 0 ? `\n## What I know about your current work\n${parts.join('\n')}` : '';
    }

    // ─── Remember a user preference ───────────────────────────────────────
    rememberPreference(key, value, confidence = 0.7) {
        this._db.prepare(
            'INSERT OR REPLACE INTO preferences (key, value, confidence, updated_at) VALUES (?, ?, ?, ?)'
        ).run(key, value, confidence, Date.now());
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FORGET
    // ═══════════════════════════════════════════════════════════════════════

    forget(id) {
        this._hot.delete(id);
        this._vectors.delete(id);
        this._db.prepare('DELETE FROM memories WHERE id = ?').run(id);
        this._vectorsDirty = true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNALS
    // ═══════════════════════════════════════════════════════════════════════

    _touchMany(ids) {
        const now = Date.now();
        const stmt = this._db.prepare(
            'UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?'
        );
        for (const id of ids) stmt.run(now, id);
    }

    _countMemories() {
        return this._db.prepare('SELECT COUNT(*) as c FROM memories').get()?.c || 0;
    }

    _parseMeta(raw) {
        try { return JSON.parse(raw || '{}'); } catch { return {}; }
    }

    // ─── Auto-cleanup: prune old, unimportant memories ───────────────────
    _cleanup() {
        const cutoff     = Date.now() - IMPORTANCE_DECAY_DAYS * 24 * 60 * 60 * 1000;
        const pruned     = this._db.prepare(
            'DELETE FROM memories WHERE accessed_at < ? AND importance < ?'
        ).run(cutoff, MIN_IMPORTANCE);

        if (pruned.changes > 0) {
            console.log(`[Memory] Pruned ${pruned.changes} old memories`);
            // Also clean vectors for pruned IDs
            const livingIds = new Set(this._db.prepare('SELECT id FROM memories').all().map(r => r.id));
            for (const id of this._vectors.keys()) {
                if (!livingIds.has(id)) {
                    this._vectors.delete(id);
                    this._vectorsDirty = true;
                }
            }
        }
    }

    // ─── Persist vectors to disk ──────────────────────────────────────────
    _persistVectors() {
        if (!this._vectorsDirty) return;
        try {
            const obj = {};
            for (const [id, vec] of this._vectors) obj[id] = vec;
            fs.writeFileSync(this.vectorPath, JSON.stringify(obj));
            this._vectorsDirty = false;
        } catch { /* non-fatal */ }
    }

    _loadVectors() {
        try {
            if (!fs.existsSync(this.vectorPath)) return;
            const raw = JSON.parse(fs.readFileSync(this.vectorPath, 'utf8'));
            for (const [id, vec] of Object.entries(raw)) {
                this._vectors.set(id, vec);
            }
            console.log(`[Memory] Loaded ${this._vectors.size} vectors from disk`);
        } catch { /* start fresh */ }
    }

    _startPersistence() {
        this._persistTimer = setInterval(() => this._persistVectors(), VECTOR_PERSIST_MS);
    }

    _startCleanup() {
        this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_MS);
    }

    shutdown() {
        clearInterval(this._persistTimer);
        clearInterval(this._cleanupTimer);
        this._persistVectors();
    }

    // ─── Stats ────────────────────────────────────────────────────────────
    getStats() {
        return {
            totalMemories:     this._countMemories(),
            conversationTurns: this._db.prepare('SELECT COUNT(*) as c FROM conversations').get()?.c || 0,
            vectorCount:       this._vectors.size,
            embeddingReady:    this.embedder._ready,
            hotSize:           this._hot.size,
            metrics:           this.metrics
        };
    }
}
