import { jest } from '@jest/globals';
import { GoalEngine } from '../../../core/GoalEngine.js';
import os from 'os';
import path from 'path';

function makeEngine() {
    const mockBrain    = { think: jest.fn(), _ready: true };
    const mockOutcomes = { record: jest.fn(), query: jest.fn(() => []), getSuccessRate: jest.fn(() => null) };
    // Use a temp dir so tests don't pollute .max/goals.json
    const storageDir = path.join(os.tmpdir(), `max-test-goals-${Date.now()}`);
    return new GoalEngine(mockBrain, mockOutcomes, null, { storageDir });
}

describe('GoalEngine', () => {
    describe('addGoal', () => {
        it('returns a string id starting with goal_', () => {
            const engine = makeEngine();
            const id = engine.addGoal({ title: 'Fix login bug', priority: 0.8 });
            expect(typeof id).toBe('string');
            expect(id.startsWith('goal_')).toBe(true);
        });

        it('stores the goal so it appears in listActive()', () => {
            const engine = makeEngine();
            engine.addGoal({ title: 'Write tests', priority: 0.7 });
            const active = engine.listActive();
            expect(active).toHaveLength(1);
            expect(active[0].title).toBe('Write tests');
        });

        it('increments stats.created', () => {
            const engine = makeEngine();
            engine.addGoal({ title: 'Goal A', priority: 0.5 });
            engine.addGoal({ title: 'Goal B', priority: 0.5 });
            expect(engine.stats.created).toBe(2);
        });
    });

    describe('deduplication', () => {
        it('returns the existing id when the same title is added twice', () => {
            const engine = makeEngine();
            const id1 = engine.addGoal({ title: 'Investigate memory leak', priority: 0.9 });
            const id2 = engine.addGoal({ title: 'Investigate memory leak', priority: 0.9 });
            expect(id1).toBe(id2);
            expect(engine.listActive()).toHaveLength(1);
        });

        it('is case-insensitive for duplicate detection', () => {
            const engine = makeEngine();
            const id1 = engine.addGoal({ title: 'Fix Bug' });
            const id2 = engine.addGoal({ title: 'fix bug' });
            expect(id1).toBe(id2);
        });
    });

    describe('listActive()', () => {
        it('returns goals sorted by priority descending', () => {
            const engine = makeEngine();
            engine.addGoal({ title: 'Low priority task',  priority: 0.2 });
            engine.addGoal({ title: 'High priority task', priority: 0.9 });
            engine.addGoal({ title: 'Mid priority task',  priority: 0.5 });
            const active = engine.listActive();
            expect(active[0].priority).toBe(0.9);
            expect(active[1].priority).toBe(0.5);
            expect(active[2].priority).toBe(0.2);
        });
    });

    describe('getStatus()', () => {
        it('reflects current active count', () => {
            const engine = makeEngine();
            engine.addGoal({ title: 'Task 1', priority: 0.5 });
            engine.addGoal({ title: 'Task 2', priority: 0.5 });
            const status = engine.getStatus();
            expect(status.active).toBe(2);
            expect(typeof status.completed).toBe('number');
        });
    });

    describe('PortUtils.checkPort', () => {
        // Moved here to avoid a separate file for a 2-case test
        it('returns true for a free port', async () => {
            const { checkPort } = await import('../../../core/PortUtils.js');
            const free = await checkPort(59871); // high port, very unlikely to be in use
            expect(free).toBe(true);
        });

        it('returns false when port is already bound', async () => {
            const { checkPort } = await import('../../../core/PortUtils.js');
            const net = await import('net');
            const srv = net.default.createServer();
            await new Promise(r => srv.listen(59872, '127.0.0.1', r));
            try {
                const free = await checkPort(59872);
                expect(free).toBe(false);
            } finally {
                await new Promise(r => srv.close(r));
            }
        });
    });
});
