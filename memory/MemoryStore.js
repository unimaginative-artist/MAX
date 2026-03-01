// ═══════════════════════════════════════════════════════════════════════════
// MemoryStore.js — MAX's persistent memory
// SQLite-backed. Stores: conversations, task results, curiosity notes, facts.
// ═══════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const MAX_MEMORIES_PER_TYPE = 10000;

export class MemoryStore {
    constructor(config = {}) {
        this.dbPath = config.dbPath || path.join(process.cwd(), '.max', 'memory.db');
        this.db     = null;
    }

    initialize() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this._createSchema();
        console.log(`[Memory] ✅ Database: ${this.dbPath}`);
    }

    _createSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                type        TEXT    NOT NULL,
                key         TEXT,
                content     TEXT    NOT NULL,
                metadata    TEXT    DEFAULT '{}',
                created_at  INTEGER NOT NULL,
                importance  REAL    DEFAULT 0.5
            );
            CREATE INDEX IF NOT EXISTS idx_type ON memories(type);
            CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_key ON memories(key);

            CREATE TABLE IF NOT EXISTS conversations (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                role       TEXT    NOT NULL,
                content    TEXT    NOT NULL,
                persona    TEXT    DEFAULT 'grinder',
                created_at INTEGER NOT NULL
            );
        `);
    }

    // ─── Store a memory ───────────────────────────────────────────────────
    store(type, data, { key = null, importance = 0.5 } = {}) {
        if (!this.db) return;
        const content = typeof data === 'string' ? data : JSON.stringify(data);
        this.db.prepare(
            'INSERT INTO memories (type, key, content, metadata, created_at, importance) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(type, key, content, '{}', Date.now(), importance);

        // Prune old low-importance memories
        this._pruneIfNeeded(type);
    }

    // ─── Recall recent memories ───────────────────────────────────────────
    recall(type, limit = 20) {
        if (!this.db) return [];
        return this.db.prepare(
            'SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT ?'
        ).all(type, limit);
    }

    // ─── Recall by key ────────────────────────────────────────────────────
    recallByKey(type, key) {
        if (!this.db) return null;
        return this.db.prepare(
            'SELECT * FROM memories WHERE type = ? AND key = ? ORDER BY created_at DESC LIMIT 1'
        ).get(type, key);
    }

    // ─── Search memories ──────────────────────────────────────────────────
    search(query, limit = 10) {
        if (!this.db) return [];
        const q = `%${query}%`;
        return this.db.prepare(
            'SELECT * FROM memories WHERE content LIKE ? ORDER BY importance DESC, created_at DESC LIMIT ?'
        ).all(q, limit);
    }

    // ─── Conversation history ─────────────────────────────────────────────
    addConversation(role, content, persona = 'grinder') {
        if (!this.db) return;
        this.db.prepare(
            'INSERT INTO conversations (role, content, persona, created_at) VALUES (?, ?, ?, ?)'
        ).run(role, content, persona, Date.now());
    }

    getConversationHistory(limit = 20) {
        if (!this.db) return [];
        return this.db.prepare(
            'SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?'
        ).all(limit).reverse();
    }

    // ─── Prune oldest low-importance memories ────────────────────────────
    _pruneIfNeeded(type) {
        const count = this.db.prepare('SELECT COUNT(*) as c FROM memories WHERE type = ?').get(type)?.c || 0;
        if (count > MAX_MEMORIES_PER_TYPE) {
            this.db.prepare(
                'DELETE FROM memories WHERE type = ? AND id IN (SELECT id FROM memories WHERE type = ? ORDER BY importance ASC, created_at ASC LIMIT ?)'
            ).run(type, type, count - MAX_MEMORIES_PER_TYPE + 100);
        }
    }

    getStats() {
        if (!this.db) return {};
        const total    = this.db.prepare('SELECT COUNT(*) as c FROM memories').get()?.c || 0;
        const convs    = this.db.prepare('SELECT COUNT(*) as c FROM conversations').get()?.c || 0;
        return { totalMemories: total, conversationTurns: convs };
    }
}
