import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

export class ClusterControlPlane {
    constructor(config = {}) {
        this.nodeId = String(config.nodeId || process.env.MAX_NODE_ID || 'max-prime');
        this.dbPath = path.resolve(config.dbPath || process.env.MAX_CLUSTER_DB || path.join(process.cwd(), '.max', 'cluster-control.db'));
        mkdirSync(path.dirname(this.dbPath), { recursive: true });
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS cluster_leader (scope TEXT PRIMARY KEY, node_id TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS cluster_dispatch (id TEXT PRIMARY KEY, worker_id TEXT, kind TEXT, status TEXT, receipt_hash TEXT, payload TEXT, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS budget_usage (day TEXT PRIMARY KEY, actual_cost REAL NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS budget_reservation (id TEXT PRIMARY KEY, day TEXT NOT NULL, node_id TEXT NOT NULL, estimated_cost REAL NOT NULL, created_at INTEGER NOT NULL);
        `);
    }

    acquireLeadership(scope = 'coordinator', ttlMs = 30_000) {
        const now = Date.now();
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT * FROM cluster_leader WHERE scope = ?').get(scope);
            if (row && row.node_id !== this.nodeId && row.expires_at > now) return false;
            this.db.prepare(`INSERT INTO cluster_leader(scope,node_id,expires_at,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(scope) DO UPDATE SET node_id=excluded.node_id, expires_at=excluded.expires_at, updated_at=excluded.updated_at`)
                .run(scope, this.nodeId, now + ttlMs, new Date().toISOString());
            return true;
        })();
    }

    reserveBudget(day, estimatedCost, cap) {
        return this.db.transaction(() => {
            this.db.prepare('DELETE FROM budget_reservation WHERE created_at < ?').run(Date.now() - 60 * 60_000);
            const actual = this.db.prepare('SELECT actual_cost FROM budget_usage WHERE day = ?').get(day)?.actual_cost || 0;
            const reserved = this.db.prepare('SELECT COALESCE(SUM(estimated_cost),0) value FROM budget_reservation WHERE day = ?').get(day).value;
            if (actual + reserved + estimatedCost > cap) return null;
            const id = randomUUID();
            this.db.prepare('INSERT INTO budget_reservation VALUES(?,?,?,?,?)').run(id, day, this.nodeId, estimatedCost, Date.now());
            return id;
        })();
    }

    settleBudget(id, day, actualCost) {
        this.db.transaction(() => {
            if (id) this.db.prepare('DELETE FROM budget_reservation WHERE id = ?').run(id);
            this.db.prepare(`INSERT INTO budget_usage(day,actual_cost) VALUES(?,?)
                ON CONFLICT(day) DO UPDATE SET actual_cost=actual_cost+excluded.actual_cost`).run(day, actualCost);
        })();
    }

    releaseBudget(id) { if (id) this.db.prepare('DELETE FROM budget_reservation WHERE id = ?').run(id); }

    budgetStatus(day) {
        const actual = this.db.prepare('SELECT actual_cost FROM budget_usage WHERE day = ?').get(day)?.actual_cost || 0;
        const reserved = this.db.prepare('SELECT COALESCE(SUM(estimated_cost),0) value FROM budget_reservation WHERE day = ?').get(day).value;
        return { actual, reserved, committed: actual + reserved };
    }

    recordDispatch(event) {
        this.db.prepare(`INSERT INTO cluster_dispatch(id,worker_id,kind,status,receipt_hash,payload,updated_at) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET status=excluded.status, receipt_hash=excluded.receipt_hash, payload=excluded.payload, updated_at=excluded.updated_at`)
            .run(event.id, event.workerId || null, event.kind || null, event.status || null, event.receipt?.resultHash || null, JSON.stringify(event), new Date().toISOString());
    }

    status() {
        const leader = this.db.prepare('SELECT * FROM cluster_leader WHERE scope = ?').get('coordinator') || null;
        const recent = this.db.prepare('SELECT id,worker_id,kind,status,receipt_hash,updated_at FROM cluster_dispatch ORDER BY updated_at DESC LIMIT 20').all();
        return { dbPath: this.dbPath, nodeId: this.nodeId, leader, recentDispatches: recent };
    }

    close() { this.db?.close(); }
}

export default ClusterControlPlane;
