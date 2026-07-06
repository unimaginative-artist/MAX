import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

const ACTIVE = ['queued', 'dispatched', 'accepted', 'executing'];
const TRANSITIONS = {
    queued: new Set(['dispatched', 'failed', 'expired']),
    dispatched: new Set(['queued', 'accepted', 'failed', 'expired']),
    accepted: new Set(['executing', 'completed', 'failed', 'expired']),
    executing: new Set(['completed', 'failed', 'expired']),
};

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export class BridgeTaskLedger {
    constructor({ dbPath = path.join(process.cwd(), '.max', 'bridge-tasks.db') } = {}) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bridge_tasks (
                id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, task_type TEXT NOT NULL,
                source TEXT NOT NULL, target TEXT NOT NULL, payload_json TEXT NOT NULL,
                status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL, hop_count INTEGER NOT NULL DEFAULT 0,
                max_hops INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
                evidence_json TEXT, last_error TEXT, created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS bridge_tasks_dedupe ON bridge_tasks(dedupe_key, status, deadline_at);
        `);
    }

    create({ type, payload, source = 'MAX', target = 'SOMA', ttlMs = 10 * 60_000, maxAttempts = 3, maxHops = 2 }) {
        const now = Date.now();
        this.expire(now);
        const dedupeKey = createHash('sha256').update(`${type}:${stableJson(payload)}`).digest('hex');
        const marks = ACTIVE.map(() => '?').join(',');
        const existing = this.db.prepare(`SELECT * FROM bridge_tasks WHERE dedupe_key=? AND status IN (${marks}) AND deadline_at>? ORDER BY created_at DESC LIMIT 1`)
            .get(dedupeKey, ...ACTIVE, now);
        if (existing) return { task: this._decode(existing), created: false };
        const task = { id: randomUUID(), dedupeKey, type, source, target, payload, status: 'queued', attempts: 0, maxAttempts, hopCount: 0, maxHops, deadlineAt: now + ttlMs, evidence: null, lastError: null, createdAt: now, updatedAt: now };
        this.db.prepare(`INSERT INTO bridge_tasks
            (id,dedupe_key,task_type,source,target,payload_json,status,attempts,max_attempts,hop_count,max_hops,deadline_at,evidence_json,last_error,created_at,updated_at)
            VALUES (@id,@dedupeKey,@type,@source,@target,@payloadJson,@status,@attempts,@maxAttempts,@hopCount,@maxHops,@deadlineAt,NULL,NULL,@createdAt,@updatedAt)`)
            .run({ ...task, payloadJson: stableJson(payload) });
        return { task, created: true };
    }

    beginAttempt(id) {
        const task = this.get(id);
        if (!task) throw new Error(`Unknown bridge task: ${id}`);
        if (task.deadlineAt <= Date.now()) {
            this.transition(id, 'expired', { error: 'deadline exceeded' });
            throw new Error('Bridge task deadline exceeded');
        }
        if (task.attempts >= task.maxAttempts || task.hopCount >= task.maxHops || task.status !== 'queued') {
            if (task.status === 'queued') this.transition(id, 'failed', { error: 'bridge retry or hop budget exhausted' });
            throw new Error('Bridge task budget exhausted');
        }
        this.db.prepare(`UPDATE bridge_tasks SET status='dispatched', attempts=attempts+1, hop_count=hop_count+1, updated_at=? WHERE id=?`).run(Date.now(), id);
        return this.get(id);
    }

    transition(id, status, { evidence = null, error = null } = {}) {
        const task = this.get(id);
        if (!task) throw new Error(`Unknown bridge task: ${id}`);
        if (!TRANSITIONS[task.status]?.has(status)) throw new Error(`Invalid bridge transition: ${task.status} -> ${status}`);
        this.db.prepare(`UPDATE bridge_tasks SET status=?, evidence_json=?, last_error=?, updated_at=? WHERE id=?`)
            .run(status, evidence == null ? null : stableJson(evidence), error, Date.now(), id);
        return this.get(id);
    }

    retry(id, error) {
        const task = this.get(id);
        const exhausted = !task || task.attempts >= task.maxAttempts || task.deadlineAt <= Date.now();
        return this.transition(id, exhausted ? 'failed' : 'queued', { error });
    }

    expire(now = Date.now()) {
        const marks = ACTIVE.map(() => '?').join(',');
        return this.db.prepare(`UPDATE bridge_tasks SET status='expired', last_error='deadline exceeded', updated_at=? WHERE status IN (${marks}) AND deadline_at<=?`)
            .run(now, ...ACTIVE, now).changes;
    }

    get(id) {
        const row = this.db.prepare('SELECT * FROM bridge_tasks WHERE id=?').get(id);
        return row ? this._decode(row) : null;
    }

    close() { this.db.close(); }

    _decode(row) {
        return { id: row.id, dedupeKey: row.dedupe_key, type: row.task_type, source: row.source, target: row.target, payload: JSON.parse(row.payload_json), status: row.status, attempts: row.attempts, maxAttempts: row.max_attempts, hopCount: row.hop_count, maxHops: row.max_hops, deadlineAt: row.deadline_at, evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at };
    }
}
