import { jest } from '@jest/globals';
import { GoalEngine } from '../core/GoalEngine.js';

describe('GoalEngine', () => {
    let brain;
    let outcomeTracker;
    let memory;
    let engine;

    beforeEach(() => {
        brain = { think: jest.fn() };
        outcomeTracker = { record: jest.fn() };
        memory = { search: jest.fn() };
        engine = new GoalEngine(brain, outcomeTracker, memory);
    });

    test('should initialize with empty active goals', () => {
        expect(engine.listActive()).toEqual([]);
    });

    test('should add a goal', () => {
        const goal = { title: 'Test Goal', type: 'task', priority: 0.5 };
        const id = engine.addGoal(goal);
        expect(id).toBeDefined();
        expect(engine.listActive().length).toBe(1);
        expect(engine.listActive()[0].title).toBe('Test Goal');
    });
});
