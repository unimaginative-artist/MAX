import { describe, it, expect } from '@jest/globals';
import { createTreeSearchTool } from '../../../tools/TreeSearchTool.js';

describe('TreeSearchTool', () => {
    const mockBrain = {
        think: async (prompt, opts) => {
            return { text: `[MOCK BRAIN RESPONSE for ${opts?.tier || 'smart'}]` };
        }
    };

    const mockMax = {
        brain: mockBrain,
        agentBrain: mockBrain
    };

    it('creates tool with correct name and actions', () => {
        const tool = createTreeSearchTool(mockMax);
        expect(tool.name).toBe('treesearch');
        expect(typeof tool.actions.search).toBe('function');
        expect(typeof tool.actions.diverge).toBe('function');
        expect(typeof tool.actions.critique).toBe('function');
        expect(typeof tool.actions.recombine).toBe('function');
    });

    it('executes search with problem statement', async () => {
        const tool = createTreeSearchTool(mockMax);
        const res = await tool.actions.search({ problem: 'Optimize memory indexing latency' });
        expect(res.success).toBe(true);
    });

    it('executes diverge to generate diverse approaches', async () => {
        const tool = createTreeSearchTool(mockMax);
        const res = await tool.actions.diverge({ problem: 'Optimize disk caching', count: 3 });
        expect(res.success).toBe(true);
        expect(Array.isArray(res.approaches)).toBe(true);
    });

    it('executes critique to evaluate a solution', async () => {
        const tool = createTreeSearchTool(mockMax);
        const res = await tool.actions.critique({
            problem: 'Optimize disk caching',
            solution: 'Use LRU cache with SQLite binary BLOBs'
        });
        expect(res.success).toBe(true);
        expect(res.score).toBeDefined();
    });

    it('executes recombine to synthesize solutions', async () => {
        const tool = createTreeSearchTool(mockMax);
        const res = await tool.actions.recombine({
            problem: 'Distributed task coordination',
            solutions: ['Centralized broker with WAL', 'Gossip protocol peer-to-peer']
        });
        expect(res.success).toBe(true);
        expect(Array.isArray(res.hybrids)).toBe(true);
    });
});
