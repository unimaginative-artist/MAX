import { ExecutionJobStore } from '../../../core/ExecutionJobStore.js';
import fs from 'fs';
import path from 'path';

describe('ExecutionJobStore', () => {
    let store;
    const testDbPath = path.join(process.cwd(), '.max', `test-exec-${Date.now()}.db`);

    beforeEach(() => {
        store = new ExecutionJobStore({ dbPath: ':memory:' });
    });

    afterEach(() => {
        if (store) {
            store.close();
        }
    });

    test('creates a job with default queued status and reporting fields', () => {
        const job = store.createJob({
            task: 'Inspect codebase for leaks'
        });

        expect(job).toBeDefined();
        expect(job.jobId).toMatch(/^job_/);
        expect(job.status).toBe('queued');
        expect(job.task).toBe('Inspect codebase for leaks');
        expect(job.createdAt).toBeGreaterThan(0);
        expect(job.startedAt).toBeNull();
        expect(job.completedAt).toBeNull();
        expect(job.summary).toBeNull();
        expect(job.evidence).toEqual([]);
        expect(job.toolsUsed).toEqual([]);
        expect(job.toolResults).toEqual([]);
        expect(job.verification).toEqual({});
        expect(job.reporting).toEqual({
            websocket: 'pending',
            sse: 'pending',
            notifier: 'pending',
            discord: 'pending'
        });
    });

    test('retrieves an existing job by jobId and goalId', () => {
        const created = store.createJob({
            jobId: 'job_custom_123',
            goalId: 'goal_abc_456',
            task: 'Build test matrix'
        });

        const byId = store.getJob('job_custom_123');
        expect(byId).toEqual(created);

        const byGoal = store.getJobByGoalId('goal_abc_456');
        expect(byGoal).toEqual(created);

        expect(store.getJob('nonexistent')).toBeNull();
    });

    test('updates job status and results cleanly', () => {
        store.createJob({
            jobId: 'job_update_test',
            task: 'Run verification suite'
        });

        const updated = store.updateJob('job_update_test', {
            status: 'running',
            toolsUsed: ['file.grep', 'observation.record']
        });

        expect(updated.status).toBe('running');
        expect(updated.startedAt).toBeGreaterThan(0);
        expect(updated.toolsUsed).toEqual(['file.grep', 'observation.record']);

        const completed = store.updateJob('job_update_test', {
            status: 'completed',
            summary: 'Suite passed with 100% assertions',
            evidence: ['All 12 checks passed'],
            verification: { passed: true }
        });

        expect(completed.status).toBe('completed');
        expect(completed.completedAt).toBeGreaterThan(0);
        expect(completed.summary).toBe('Suite passed with 100% assertions');
        expect(completed.evidence).toEqual(['All 12 checks passed']);
        expect(completed.verification).toEqual({ passed: true });
    });

    test('recovers stale running jobs whose heartbeats expired', () => {
        const pastTime = Date.now() - 120000;
        
        // Job 1: Running, active heartbeat -> should NOT be recovered
        store.createJob({
            jobId: 'job_active',
            task: 'Active task',
            status: 'running',
            heartbeatAt: Date.now()
        });

        // Job 2: Running, old heartbeat -> should be recovered as incomplete
        store.createJob({
            jobId: 'job_stale',
            task: 'Stale task',
            status: 'running',
            heartbeatAt: pastTime
        });

        const recovered = store.recoverStaleJobs(60000);
        expect(recovered.length).toBe(1);
        expect(recovered[0].jobId).toBe('job_stale');
        expect(recovered[0].status).toBe('incomplete');
        expect(recovered[0].error).toContain('Process restarted or job heartbeat went stale');

        const activeJob = store.getJob('job_active');
        expect(activeJob.status).toBe('running');
    });

    test('outbox enforces idempotency and handles failure backoff', () => {
        const jobId = 'job_outbox_test';
        store.createJob({ jobId, task: 'Report task' });

        // Enqueue first time
        const id1 = store.enqueueNotification({
            jobId,
            channel: 'discord',
            event: 'execution_complete',
            payload: { summary: 'Finished' },
            maxAttempts: 2
        });

        // Enqueue second time with same (jobId, channel, event) -> should be ignored (idempotent)
        store.enqueueNotification({
            jobId,
            channel: 'discord',
            event: 'execution_complete',
            payload: { summary: 'Duplicate' },
            maxAttempts: 2
        });

        const pending = store.getPendingNotifications();
        expect(pending.length).toBe(1);
        expect(pending[0].payload.summary).toBe('Finished');

        // Fail attempt 1
        store.markNotificationFailed(pending[0].id, 'Network timeout', 1000);
        
        const outboxAfterFail = store.getOutboxForJob(jobId);
        expect(outboxAfterFail[0].attempts).toBe(1);
        expect(outboxAfterFail[0].status).toBe('pending');
        expect(outboxAfterFail[0].lastError).toBe('Network timeout');

        // Fail attempt 2 -> reached maxAttempts (2) -> status becomes failed
        store.markNotificationFailed(pending[0].id, 'Connection refused', 1000);
        const outboxFinal = store.getOutboxForJob(jobId);
        expect(outboxFinal[0].attempts).toBe(2);
        expect(outboxFinal[0].status).toBe('failed');

        const jobRecord = store.getJob(jobId);
        expect(jobRecord.reporting.discord).toBe('failed');
    });

    test('survives disk recreation with SQLite file', () => {
        const diskStore1 = new ExecutionJobStore({ dbPath: testDbPath });
        diskStore1.createJob({
            jobId: 'job_disk_persisted',
            task: 'Persisted to disk',
            status: 'completed',
            summary: 'Saved successfully'
        });
        diskStore1.close();

        // Reopen database from same file
        const diskStore2 = new ExecutionJobStore({ dbPath: testDbPath });
        const retrieved = diskStore2.getJob('job_disk_persisted');
        expect(retrieved).toBeDefined();
        expect(retrieved.status).toBe('completed');
        expect(retrieved.summary).toBe('Saved successfully');
        diskStore2.close();

        // Cleanup test db files
        try {
            if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
            const wal = `${testDbPath}-wal`;
            const shm = `${testDbPath}-shm`;
            if (fs.existsSync(wal)) fs.unlinkSync(wal);
            if (fs.existsSync(shm)) fs.unlinkSync(shm);
        } catch {}
    });
});
