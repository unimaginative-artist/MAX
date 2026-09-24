import { jest } from '@jest/globals';
import { AgentLoop } from '../../../core/AgentLoop.js';
import { ExecutionJobStore } from '../../../core/ExecutionJobStore.js';
import { ExecutionReporter } from '../../../core/ExecutionReporter.js';

describe('AgentLoop Durable Reporting & Idempotency', () => {
    let jobStore;
    let mockMax;
    let loop;
    let reportedEvents = [];

    beforeEach(() => {
        jobStore = new ExecutionJobStore({ dbPath: ':memory:' });
        reportedEvents = [];

        mockMax = {
            jobStore,
            executionReporter: null,
            goals: {
                getNext: jest.fn(() => null),
                complete: jest.fn(),
                fail: jest.fn()
            },
            profile: { getActiveTasks: jest.fn(() => []) },
            drive: { onIdleTick: jest.fn(), onGoalComplete: jest.fn() },
            tools: {
                get: jest.fn(() => null),
                execute: jest.fn().mockResolvedValue({ success: true })
            },
            notifier: {
                notify: jest.fn().mockResolvedValue(true)
            },
            memory: { remember: jest.fn() },
            emitActivity: jest.fn((e) => reportedEvents.push(e))
        };

        mockMax.executionReporter = new ExecutionReporter(mockMax, jobStore, (e) => reportedEvents.push(e));

        loop = new AgentLoop(mockMax, {
            requireApproval: false,
            autoApproveLevel: 'all'
        });
    });

    afterEach(() => {
        if (jobStore) jobStore.close();
    });

    test('AgentLoop._reportBack() reports success to reporter and store', async () => {
        const goal = { id: 'goal_success_1', title: 'Optimize Cache', jobId: 'job_goal_1' };
        jobStore.createJob({
            jobId: goal.jobId,
            goalId: goal.id,
            task: goal.title,
            status: 'running'
        });

        const result = await loop._reportBack(goal, true, 'Cache optimized by 40%', goal.jobId);
        expect(result.event).toBe('execution_complete');

        // Verify WS/SSE event emitted
        const event = reportedEvents.find(e => e.type === 'execution_complete' && e.jobId === goal.jobId);
        expect(event).toBeDefined();
        expect(event.summary).toBe('Cache optimized by 40%');

        // Verify store status
        const job = jobStore.getJob(goal.jobId);
        expect(job).toBeDefined();
    });

    test('AgentLoop._reportBack() reports failure when goal fails', async () => {
        const goal = { id: 'goal_fail_1', title: 'Deploy Cluster', jobId: 'job_fail_1' };
        jobStore.createJob({
            jobId: goal.jobId,
            goalId: goal.id,
            task: goal.title,
            status: 'running'
        });

        const result = await loop._reportBack(goal, false, 'Cluster timeout on node 3', goal.jobId);
        expect(result.event).toBe('execution_failed');

        const event = reportedEvents.find(e => e.type === 'execution_failed' && e.jobId === goal.jobId);
        expect(event).toBeDefined();
        expect(event.summary).toBe('Cluster timeout on node 3');
    });

    test('AgentLoop._reportBack() idempotency prevents duplicate notifications', async () => {
        const goal = { id: 'goal_idemp_1', title: 'Audit Logs', jobId: 'job_idemp_1' };
        jobStore.createJob({
            jobId: goal.jobId,
            goalId: goal.id,
            task: goal.title,
            status: 'running'
        });

        // Call reportBack once
        const first = await loop._reportBack(goal, true, 'Audit clean', goal.jobId);
        expect(first.duplicate).toBeUndefined();

        const countAfterFirst = reportedEvents.filter(e => e.jobId === goal.jobId).length;
        expect(countAfterFirst).toBe(1);

        // Call reportBack second time with same outcome
        const second = await loop._reportBack(goal, true, 'Audit clean again', goal.jobId);
        expect(second.duplicate).toBe(true);

        // No new event was emitted to clients
        const countAfterSecond = reportedEvents.filter(e => e.jobId === goal.jobId).length;
        expect(countAfterSecond).toBe(1);
    });

    test('_finalizeGoal() updates jobStore with terminal status, step results, and tools', async () => {
        const goal = { id: 'goal_final_1', title: 'Refactor Module', jobId: 'job_final_1' };
        jobStore.createJob({
            jobId: goal.jobId,
            goalId: goal.id,
            task: goal.title,
            status: 'running'
        });

        const stepResults = [
            { step: 1, tool: 'file', action_name: 'read', success: true },
            { step: 2, tool: 'file', action_name: 'patch', success: true }
        ];

        await loop._finalizeGoal(goal, true, 'Refactor applied cleanly', 'agent_loop', stepResults);

        const updatedJob = jobStore.getJob(goal.jobId);
        expect(updatedJob.status).toBe('completed');
        expect(updatedJob.summary).toBe('Refactor applied cleanly');
        expect(updatedJob.toolsUsed).toEqual(['file.read', 'file.patch']);
        expect(updatedJob.verification.passed).toBe(true);
        expect(updatedJob.completedAt).toBeGreaterThan(0);
    });
});
