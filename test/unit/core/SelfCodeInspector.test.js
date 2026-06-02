import { SelfCodeInspector } from '../../../core/SelfCodeInspector.js';
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

describe('SelfCodeInspector', () => {
    let mockGoals;
    let inspector;

    beforeEach(() => {
        mockGoals = {
            addGoal: jest.fn().mockImplementation((g) => `goal_mocked_${g.priority}`)
        };
        inspector = new SelfCodeInspector(mockGoals);
    });

    test('should construct with proper defaults', () => {
        expect(inspector.goals).toBe(mockGoals);
        expect(inspector.getStatus().lastRun).toBe('never');
        expect(inspector.getStatus().findings).toBe(0);
    });

    test('should scan files and detect markers correctly', async () => {
        // Run inspection (which scans core/tools/etc. and launcher.mjs if they exist)
        const findings = await inspector.inspect();
        expect(Array.isArray(findings)).toBe(true);

        // Verify structure of findings
        if (findings.length > 0) {
            const first = findings[0];
            expect(first).toHaveProperty('file');
            expect(first).toHaveProperty('line');
            expect(first).toHaveProperty('label');
            expect(first).toHaveProperty('text');
            expect(first).toHaveProperty('priority');
        }
    });

    test('should queue findings as GoalEngine goals based on priority', () => {
        inspector._findings = [
            { file: 'core/Test.js', line: 10, label: 'TODO', text: '// TODO: do something', priority: 0.65 },
            { file: 'core/Bad.js', line: 20, label: 'FIXME', text: '// FIXME: critical bug', priority: 0.80 },
            { file: 'core/Hack.js', line: 30, label: 'HACK', text: '// HACK: work around', priority: 0.70 },
            { file: 'core/Duplicate.js', line: 40, label: 'TODO', text: '// TODO: duplicate', priority: 0.65 },
        ];

        const queued = inspector.queueGoals(3);
        
        // Should cap at 3 goals
        expect(queued.length).toBe(3);
        
        // Priority order check: FIXME (0.80) first, then HACK (0.70), then TODO (0.65)
        expect(queued[0].finding.label).toBe('FIXME');
        expect(queued[1].finding.label).toBe('HACK');
        expect(queued[2].finding.label).toBe('TODO');

        expect(mockGoals.addGoal).toHaveBeenCalledTimes(3);
        expect(mockGoals.addGoal).toHaveBeenCalledWith(expect.objectContaining({
            type: 'improvement',
            source: 'auto'
        }));
    });

    test('should correctly summarize findings', () => {
        inspector._findings = [
            { file: 'a.js', line: 1, label: 'TODO', text: '', priority: 0.6 },
            { file: 'b.js', line: 2, label: 'TODO', text: '', priority: 0.6 },
            { file: 'c.js', line: 3, label: 'FIXME', text: '', priority: 0.8 }
        ];

        const summary = inspector.getSummary();
        expect(summary).toContain('3 findings');
        expect(summary).toContain('TODO: 2');
        expect(summary).toContain('FIXME: 1');
    });
});
