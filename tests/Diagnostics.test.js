
import { DiagnosticsSystem } from '../core/Diagnostics.js';
import { jest } from '@jest/globals';

describe('DiagnosticsSystem', () => {
    let mockMax;
    let diag;

    beforeEach(() => {
        mockMax = {
            outcomes: { getStats: () => ({ total: 10, avgLatency: 1000 }) },
            goals: { addGoal: jest.fn() },
            soma: { available: false }
        };
        diag = new DiagnosticsSystem(mockMax);
    });

    test('should run all scanners in parallel', async () => {
        const start = Date.now();
        
        // Add two 1-second scanners
        diag.scanners = [
            async () => await new Promise(r => setTimeout(r, 1000)),
            async () => await new Promise(r => setTimeout(r, 1000))
        ];

        await diag.runAll();
        
        const duration = Date.now() - start;
        console.log(`Parallel Audit duration: ${duration}ms`);
        // If it's parallel, it should take ~1000ms, NOT 2000ms
        expect(duration).toBeLessThan(1500);
    });
});
