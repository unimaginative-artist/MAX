import { jest } from '@jest/globals';
import { PersonaEngine, PERSONAS } from '../../../personas/PersonaEngine.js';

describe('PersonaEngine Unit Tests', () => {
    let pe;

    beforeEach(() => {
        pe = new PersonaEngine();
    });

    describe('Initialization', () => {
        it('should initialize with default persona MUSE', () => {
            expect(pe.current.id).toBe('muse');
        });

        it('should load expert personas from files', () => {
            // Check if experts map has loaded the markdown expert files
            expect(pe.experts.size).toBeGreaterThan(0);
        });
    });

    describe('selectForTask (Conversational Keywords)', () => {
        it('should switch to muse when conversational greeting is present', async () => {
            // Set current persona to something else
            pe.switchTo('grinder');
            expect(pe.current.id).toBe('grinder');

            const selected = await pe.selectForTask('hey max, how are you doing?');
            expect(selected.id).toBe('muse');
            expect(pe.current.id).toBe('muse');
        });
    });

    describe('selectForTask (Muse Mode Stickiness)', () => {
        it('should stay in muse mode when a technical request is sent without exit triggers', async () => {
            pe.switchTo('muse');
            const selected = await pe.selectForTask('please build the database and implement factorial', { tension: 0.8 }, null);
            expect(selected.id).toBe('muse');
            expect(pe.current.id).toBe('muse');
        });

        it('should stay in muse mode even when an exit trigger is sent (exiting is manual)', async () => {
            pe.switchTo('muse');
            const selected = await pe.selectForTask('switch to grinder mode: build the app', { tension: 0.8 }, null);
            expect(selected.id).toBe('muse');
            expect(pe.current.id).toBe('muse');
        });
    });

    describe('selectForTask (Heuristics Fallback when Brain is Offline)', () => {
        it('should fall back to grinder under high tension and action verbs', async () => {
            pe.switchTo('explainer'); // start in neutral persona to test routing
            const driveState = { tension: 0.8, satisfaction: 0.3 };
            const selected = await pe.selectForTask('please build the app', driveState, null);
            expect(selected.id).toBe('grinder');
        });

        it('should select architect if message contains architect keywords', async () => {
            pe.switchTo('explainer');
            const selected = await pe.selectForTask('let us discuss the database design structure', null, null);
            expect(selected.id).toBe('architect');
        });

        it('should select paranoid if message contains security keywords', async () => {
            pe.switchTo('explainer');
            const selected = await pe.selectForTask('check for vulnerability exploit', null, null);
            expect(selected.id).toBe('paranoid');
        });
    });

    describe('selectForTask (LLM-Driven Classification)', () => {
        it('should query the brain and switch persona based on LLM decision', async () => {
            pe.switchTo('explainer');

            const mockBrain = {
                think: jest.fn().mockResolvedValue({ text: 'architect' })
            };

            const selected = await pe.selectForTask('let us plan the scalability of our service', null, mockBrain);

            expect(mockBrain.think).toHaveBeenCalled();
            expect(selected.id).toBe('architect');
            expect(pe.current.id).toBe('architect');
        });

        it('should handle markdown block or extra whitespace in LLM output', async () => {
            pe.switchTo('explainer');

            const mockBrain = {
                think: jest.fn().mockResolvedValue({ text: '```json\n"grinder"\n```' })
            };

            const selected = await pe.selectForTask('implement factorial in js', null, mockBrain);

            expect(selected.id).toBe('grinder');
            expect(pe.current.id).toBe('grinder');
        });

        it('should fall back to keyword triggers if the LLM output is not a valid persona ID', async () => {
            pe.switchTo('explainer');

            const mockBrain = {
                think: jest.fn().mockResolvedValue({ text: 'unknown_garbage_persona' })
            };

            // Heuristic matching should hit "vulnerability" -> paranoid
            const selected = await pe.selectForTask('check for vulnerability exploit', null, mockBrain);

            expect(mockBrain.think).toHaveBeenCalled();
            expect(selected.id).toBe('paranoid');
        });

        it('should fall back to keywords if the LLM query throws an error', async () => {
            pe.switchTo('explainer');

            const mockBrain = {
                think: jest.fn().mockRejectedValue(new Error('API Timeout'))
            };

            // Heuristics should hit "design" -> architect
            const selected = await pe.selectForTask('design this database', null, mockBrain);

            expect(mockBrain.think).toHaveBeenCalled();
            expect(selected.id).toBe('architect');
        });
    });

    describe('Manual switching and experts', () => {
        it('should allow switching manually via switchTo', () => {
            pe.switchTo('explainer');
            expect(pe.current.id).toBe('explainer');
        });

        it('should support switching to loaded expert personas', () => {
            pe.switchTo('appsecauditor');
            expect(pe.current.id).toBe('appsecauditor');
            expect(pe.current.emoji).toBe('AS');
        });

        it('should throw error when switching to nonexistent persona', () => {
            expect(() => pe.switchTo('nonexistent')).toThrow();
        });
    });
});
