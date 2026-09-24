// ═══════════════════════════════════════════════════════════════════════════
// ExecutionJobStore.js — Durable SQLite WAL store for execution tasks & outbox
// Guarantees task results survive process restarts, dropped sockets, and client disconnects.
// ═══════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

const DEFAULT_DB_PATH = path.join(process.cwd(), '.max', 'execution-jobs.db');

export const VALID_STATUSES = new Set([
    'queued',
    'running',
    'completed',
    'failed',
    'blocked',
    'incomplete',
    'cancelled'
]);

export class ExecutionJobStore {
    /**
     * @param {Object} [options]
     * @param {string} [options.dbPath] - Database file path or ':memory:'
     */
    constructor(options = {}) {
        this.dbPath = options.dbPath || DEFAULT_DB_PATH;
        
        if (this.dbPath !== ':memory:') {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        this.db = new Database(this.dbPath);
        if (this.dbPath !== ':memory:') {
            this.db.pragma('journal_mode = WAL');
        }
        this.db.pragma('synchronous = NORMAL');

        this._initSchema();
        this._prepareStatements();
    }

    _initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS execution_jobs (
                job_id TEXT PRIMARY KEY,
                goal_id TEXT,
                task TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                summary TEXT,
                evidence_json TEXT,
                tools_used_json TEXT,
                tool_results_json TEXT,
                verification_json TEXT,
                error TEXT,
                next_step TEXT,
                reporting_json TEXT,
                heartbeat_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_execution_jobs_status ON execution_jobs(status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_execution_jobs_goal ON execution_jobs(goal_id);

            CREATE TABLE IF NOT EXISTS notification_outbox (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                event TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER NOT NULL DEFAULT 3,
                last_error TEXT,
                next_attempt_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(job_id, channel, event)
            );

            CREATE INDEX IF NOT EXISTS idx_outbox_pending ON notification_outbox(status, next_attempt_at);
        `);
    }

    _prepareStatements() {
        this.stmts = {
            insertJob: this.db.prepare(`
                INSERT INTO execution_jobs (
                    job_id, goal_id, task, status, created_at, updated_at,
                    started_at, completed_at, summary, evidence_json,
                    tools_used_json, tool_results_json, verification_json,
                    error, next_step, reporting_json, heartbeat_at
                ) VALUES (
                    @job_id, @goal_id, @task, @status, @created_at, @updated_at,
                    @started_at, @completed_at, @summary, @evidence_json,
                    @tools_used_json, @tool_results_json, @verification_json,
                    @error, @next_step, @reporting_json, @heartbeat_at
                )
            `),
            getJob: this.db.prepare(`
                SELECT * FROM execution_jobs WHERE job_id = ?
            `),
            getJobByGoal: this.db.prepare(`
                SELECT * FROM execution_jobs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1
            `),
            updateHeartbeat: this.db.prepare(`
                UPDATE execution_jobs SET heartbeat_at = ?, updated_at = ? WHERE job_id = ?
            `),
            listRunning: this.db.prepare(`
                SELECT * FROM execution_jobs WHERE status = 'running'
            `),
            updateStatusAndResult: this.db.prepare(`
                UPDATE execution_jobs SET
                    status = COALESCE(@status, status),
                    updated_at = @updated_at,
                    started_at = COALESCE(@started_at, started_at),
                    completed_at = COALESCE(@completed_at, completed_at),
                    summary = COALESCE(@summary, summary),
                    evidence_json = COALESCE(@evidence_json, evidence_json),
                    tools_used_json = COALESCE(@tools_used_json, tools_used_json),
                    tool_results_json = COALESCE(@tool_results_json, tool_results_json),
                    verification_json = COALESCE(@verification_json, verification_json),
                    error = COALESCE(@error, error),
                    next_step = COALESCE(@next_step, next_step),
                    reporting_json = COALESCE(@reporting_json, reporting_json),
                    heartbeat_at = COALESCE(@heartbeat_at, heartbeat_at)
                WHERE job_id = @job_id
            `),
            enqueueOutbox: this.db.prepare(`
                INSERT INTO notification_outbox (
                    id, job_id, channel, event, payload_json, status,
                    attempts, max_attempts, last_error, next_attempt_at,
                    created_at, updated_at
                ) VALUES (
                    @id, @job_id, @channel, @event, @payload_json, 'pending',
                    0, @max_attempts, NULL, @next_attempt_at,
                    @created_at, @updated_at
                )
                ON CONFLICT(job_id, channel, event) DO NOTHING
            `),
            getPendingOutbox: this.db.prepare(`
                SELECT * FROM notification_outbox
                WHERE status = 'pending' AND next_attempt_at <= ?
                ORDER BY next_attempt_at ASC
                LIMIT ?
            `),
            markOutboxDelivered: this.db.prepare(`
                UPDATE notification_outbox
                SET status = 'delivered', updated_at = ?
                WHERE id = ?
            `),
            markOutboxFailedAttempt: this.db.prepare(`
                UPDATE notification_outbox
                SET attempts = attempts + 1,
                    last_error = @last_error,
                    next_attempt_at = @next_attempt_at,
                    status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
                    updated_at = @updated_at
                WHERE id = @id
            `),
            getOutboxItem: this.db.prepare(`
                SELECT * FROM notification_outbox WHERE id = ?
            `),
            getOutboxForJob: this.db.prepare(`
                SELECT * FROM notification_outbox WHERE job_id = ?
            `)
        };
    }

    /**
     * Create a new durable execution job.
     */
    createJob(params = {}) {
        const now = Date.now();
        const jobId = params.jobId || `job_${now}_${randomUUID().slice(0, 8)}`;
        const status = params.status || 'queued';

        if (!VALID_STATUSES.has(status)) {
            throw new Error(`Invalid job status: ${status}`);
        }

        const defaultReporting = {
            websocket: 'pending',
            sse: 'pending',
            notifier: 'pending',
            discord: 'pending',
            ...(params.reporting || {})
        };

        const record = {
            job_id: jobId,
            goal_id: params.goalId || null,
            task: String(params.task || '').trim(),
            status,
            created_at: params.createdAt || now,
            updated_at: params.updatedAt || now,
            started_at: params.startedAt || (status === 'running' ? now : null),
            completed_at: params.completedAt || null,
            summary: params.summary || null,
            evidence_json: JSON.stringify(params.evidence || []),
            tools_used_json: JSON.stringify(params.toolsUsed || []),
            tool_results_json: JSON.stringify(params.toolResults || []),
            verification_json: JSON.stringify(params.verification || {}),
            error: params.error || null,
            next_step: params.nextStep || null,
            reporting_json: JSON.stringify(defaultReporting),
            heartbeat_at: params.heartbeatAt || (status === 'running' ? now : null)
        };

        this.stmts.insertJob.run(record);
        return this.getJob(jobId);
    }

    /**
     * Retrieve a normalized job record by jobId.
     */
    getJob(jobId) {
        if (!jobId) return null;
        const row = this.stmts.getJob.get(jobId);
        if (!row) return null;
        return this._deserializeJob(row);
    }

    /**
     * Retrieve job by associated goalId.
     */
    getJobByGoalId(goalId) {
        if (!goalId) return null;
        const row = this.stmts.getJobByGoal.get(goalId);
        if (!row) return null;
        return this._deserializeJob(row);
    }

    /**
     * Update job state and fields durably.
     */
    updateJob(jobId, updates = {}) {
        const existing = this.getJob(jobId);
        if (!existing) {
            throw new Error(`Job not found: ${jobId}`);
        }

        const now = Date.now();
        const nextStatus = updates.status || existing.status;
        if (!VALID_STATUSES.has(nextStatus)) {
            throw new Error(`Invalid job status: ${nextStatus}`);
        }

        let startedAt = updates.startedAt !== undefined ? updates.startedAt : existing.startedAt;
        if (nextStatus === 'running' && !startedAt) {
            startedAt = now;
        }

        let completedAt = updates.completedAt !== undefined ? updates.completedAt : existing.completedAt;
        if (['completed', 'failed', 'blocked', 'incomplete', 'cancelled'].includes(nextStatus) && !completedAt) {
            completedAt = now;
        }

        let reporting = existing.reporting;
        if (updates.reporting) {
            reporting = { ...existing.reporting, ...updates.reporting };
        }

        const params = {
            job_id: jobId,
            status: nextStatus,
            updated_at: now,
            started_at: startedAt,
            completed_at: completedAt,
            summary: updates.summary !== undefined ? updates.summary : existing.summary,
            evidence_json: updates.evidence !== undefined ? JSON.stringify(updates.evidence) : JSON.stringify(existing.evidence),
            tools_used_json: updates.toolsUsed !== undefined ? JSON.stringify(updates.toolsUsed) : JSON.stringify(existing.toolsUsed),
            tool_results_json: updates.toolResults !== undefined ? JSON.stringify(updates.toolResults) : JSON.stringify(existing.toolResults),
            verification_json: updates.verification !== undefined ? JSON.stringify(updates.verification) : JSON.stringify(existing.verification),
            error: updates.error !== undefined ? updates.error : existing.error,
            next_step: updates.nextStep !== undefined ? updates.nextStep : existing.nextStep,
            reporting_json: JSON.stringify(reporting),
            heartbeat_at: updates.heartbeatAt !== undefined ? updates.heartbeatAt : (nextStatus === 'running' ? now : existing.heartbeatAt)
        };

        this.stmts.updateStatusAndResult.run(params);
        return this.getJob(jobId);
    }

    /**
     * Touch the heartbeat timestamp for an active job.
     */
    updateHeartbeat(jobId) {
        const now = Date.now();
        this.stmts.updateHeartbeat.run(now, now, jobId);
    }

    /**
     * Update a specific channel delivery status in the reporting object.
     */
    updateReportingStatus(jobId, channel, status) {
        const job = this.getJob(jobId);
        if (!job) return null;
        const reporting = { ...job.reporting, [channel]: status };
        return this.updateJob(jobId, { reporting });
    }

    /**
     * Recover stale running jobs left behind by server restarts or crashes.
     * Marks running jobs older than threshold as incomplete with reason.
     * @param {number} [thresholdMs=60000]
     * @returns {Array<Object>} Recovered jobs
     */
    recoverStaleJobs(thresholdMs = 60000) {
        const now = Date.now();
        const running = this.stmts.listRunning.all();
        const recovered = [];

        for (const row of running) {
            const job = this._deserializeJob(row);
            const lastActive = job.heartbeatAt || job.startedAt || job.updatedAt || job.createdAt;
            if (now - lastActive > thresholdMs) {
                console.warn(`[ExecutionJobStore] Recovering stale job ${job.jobId} (status: running -> incomplete)`);
                const updated = this.updateJob(job.jobId, {
                    status: 'incomplete',
                    error: 'Process restarted or job heartbeat went stale before task finished',
                    completedAt: now,
                    summary: job.summary || 'Task was interrupted by process restart or crash.'
                });
                recovered.push(updated);
            }
        }

        return recovered;
    }

    /**
     * Enqueue an external notification to the outbox with idempotency.
     */
    enqueueNotification({ jobId, channel, event, payload, maxAttempts = 3, nextAttemptAt = Date.now() }) {
        const id = `outbox_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const now = Date.now();
        
        this.stmts.enqueueOutbox.run({
            id,
            job_id: jobId,
            channel,
            event,
            payload_json: JSON.stringify(payload || {}),
            max_attempts: maxAttempts,
            next_attempt_at: nextAttemptAt,
            created_at: now,
            updated_at: now
        });

        return id;
    }

    /**
     * Retrieve pending outbox items ready for dispatch.
     */
    getPendingNotifications(limit = 10) {
        const now = Date.now();
        const rows = this.stmts.getPendingOutbox.all(now, limit);
        return rows.map(r => ({
            id: r.id,
            jobId: r.job_id,
            channel: r.channel,
            event: r.event,
            payload: JSON.parse(r.payload_json || '{}'),
            status: r.status,
            attempts: r.attempts,
            maxAttempts: r.max_attempts,
            lastError: r.last_error,
            nextAttemptAt: r.next_attempt_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        }));
    }

    /**
     * Mark an outbox item as delivered.
     */
    markNotificationDelivered(id) {
        const now = Date.now();
        this.stmts.markOutboxDelivered.run(now, id);
        const item = this.stmts.getOutboxItem.get(id);
        if (item) {
            this.updateReportingStatus(item.job_id, item.channel, 'sent');
        }
    }

    /**
     * Record a failed delivery attempt with exponential backoff.
     */
    markNotificationFailed(id, errorMsg, backoffMs = 5000) {
        const now = Date.now();
        const nextAttemptAt = now + backoffMs;
        this.stmts.markOutboxFailedAttempt.run({
            id,
            last_error: String(errorMsg || 'Delivery error'),
            next_attempt_at: nextAttemptAt,
            updated_at: now
        });

        const item = this.stmts.getOutboxItem.get(id);
        if (item && item.status === 'failed') {
            this.updateReportingStatus(item.job_id, item.channel, 'failed');
        }
    }

    /**
     * Get all outbox items for a specific job.
     */
    getOutboxForJob(jobId) {
        return this.stmts.getOutboxForJob.all(jobId).map(r => ({
            id: r.id,
            jobId: r.job_id,
            channel: r.channel,
            event: r.event,
            payload: JSON.parse(r.payload_json || '{}'),
            status: r.status,
            attempts: r.attempts,
            maxAttempts: r.max_attempts,
            lastError: r.last_error
        }));
    }

    close() {
        try {
            this.db.close();
        } catch {}
    }

    _deserializeJob(row) {
        return {
            jobId: row.job_id,
            goalId: row.goal_id,
            task: row.task,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            summary: row.summary,
            evidence: JSON.parse(row.evidence_json || '[]'),
            toolsUsed: JSON.parse(row.tools_used_json || '[]'),
            toolResults: JSON.parse(row.tool_results_json || '[]'),
            verification: JSON.parse(row.verification_json || '{}'),
            error: row.error,
            nextStep: row.next_step,
            reporting: JSON.parse(row.reporting_json || '{}'),
            heartbeatAt: row.heartbeat_at
        };
    }
}
