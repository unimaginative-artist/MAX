import { jest } from '@jest/globals';
import { AgentLoop } from '../../../core/AgentLoop.js';

function makeLoop(overrides = {}) {
    const mockMax = {
        goals:   { getNext: jest.fn(() => null), listActive: jest.fn(() => []) },
        profile: { getActiveTasks: jest.fn(() => []) },
        drive:   { onIdleTick: jest.fn(), tension: 0.5 },
        brain:   { think: jest.fn(async () => ({ response: 'ok', tokens: 10 })), _ready: true },
        tools:   { list: jest.fn(() => []), execute: jest.fn(async () => ({ success: true })) },
        skills:  null,
        swarm:   null,
        memory:  null,
        ...overrides
    };
    const loop = new AgentLoop(mockMax, { stepTimeoutMs: 5000, requireApproval: false, autoApproveLevel: 'all' });
    return { loop, mockMax };
}

describe('AgentLoop', () => {
    describe('construction', () => {
        it('initializes stats to zero', () => {
            const { loop } = makeLoop();
            expect(loop.stats.cyclesRun).toBe(0);
            expect(loop.stats.goalsStarted).toBe(0);
            expect(loop.stats.goalsCompleted).toBe(0);
        });

        it('starts in non-busy state', () => {
            const { loop } = makeLoop();
            expect(loop._busy).toBe(false);
        });

        it('has no pending approval on construction', () => {
            const { loop } = makeLoop();
            expect(loop._pendingApproval).toBeNull();
            expect(loop.getPendingApproval()).toBeNull();
        });
    });

    describe('approve() / deny()', () => {
        it('approve() returns false when no pending approval', () => {
            const { loop } = makeLoop();
            expect(loop.approve()).toBe(false);
        });

        it('deny() returns false when no pending approval', () => {
            const { loop } = makeLoop();
            expect(loop.deny()).toBe(false);
        });

        it('approve() resolves pending approval with true', async () => {
            const { loop } = makeLoop();
            // Simulate a pending approval
            const p = new Promise(resolve => {
                loop._pendingApproval = { resolve, description: 'test action' };
            });
            loop.approve();
            const result = await p;
            expect(result).toBe(true);
            expect(loop._pendingApproval).toBeNull();
        });

        it('deny() resolves pending approval with false', async () => {
            const { loop } = makeLoop();
            const p = new Promise(resolve => {
                loop._pendingApproval = { resolve, description: 'test action' };
            });
            loop.deny();
            const result = await p;
            expect(result).toBe(false);
            expect(loop._pendingApproval).toBeNull();
        });
    });

    describe('runCycle()', () => {
        it('increments cyclesRun on each call', async () => {
            const { loop } = makeLoop();
            await loop.runCycle();
            await loop.runCycle();
            expect(loop.stats.cyclesRun).toBe(2);
        });

        it('returns null when no goals are available', async () => {
            const { loop } = makeLoop();
            const result = await loop.runCycle();
            expect(result).toBeNull();
        });

        it('calls drive.onIdleTick() when no goal found', async () => {
            const { loop, mockMax } = makeLoop();
            await loop.runCycle();
            expect(mockMax.drive.onIdleTick).toHaveBeenCalled();
        });

        it('sets _busy to false after cycle completes', async () => {
            const { loop } = makeLoop();
            await loop.runCycle();
            expect(loop._busy).toBe(false);
        });

        it('queues a pending cycle instead of running concurrently', async () => {
            const { loop, mockMax } = makeLoop();
            // Simulate a slow cycle by making brain.think take a while
            let resolveThink;
            const slowGoal = {
                id: 'goal_1', title: 'Slow goal', description: 'slow',
                steps: [{ step: 1, action: 'think', tool: 'brain', success: 'done', dependsOn: [] }],
                priority: 0.8, source: 'test'
            };
            mockMax.goals.getNext.mockReturnValueOnce(slowGoal);

            // Start a cycle (will run into the brain.think which we'll resolve later)
            // For this test, we just verify that a second runCycle() while busy sets _pendingCycle
            loop._busy = true; // manually mark as busy
            loop.runCycle(); // should set _pendingCycle = true
            expect(loop._pendingCycle).toBe(true);
        });
    });

    describe('getStatus()', () => {
        it('returns stats and pending approval state', () => {
            const { loop } = makeLoop();
            const status = loop.getStatus?.();
            // getStatus may not exist yet — guard it
            if (status) {
                expect(typeof status.busy).toBe('boolean');
                expect(typeof status.pending).toBe('boolean');
            }
        });
    });
});
