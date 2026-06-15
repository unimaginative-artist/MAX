import { AttentionEngine, ATTENTION_PRIORITY, ATTENTION_COST } from '../../../core/AttentionEngine.js';

describe('AttentionEngine Unit Tests', () => {
    let engine;

    beforeEach(() => {
        engine = new AttentionEngine();
    });

    describe('Initialization', () => {
        it('should initialize with default weights and config', () => {
            expect(engine.weights.urgency).toBe(0.30);
            expect(engine.weights.intent).toBe(0.22);
            expect(engine.recentTopics).toEqual([]);
            expect(engine.tensions.size).toBe(0);
        });
    });

    describe('Scoring Signals', () => {
        it('should score high urgency for emergency words', () => {
            const result = engine.evaluate('This is critical, the build is broken and crashing!');
            expect(result.signals.urgency).toBeGreaterThan(0.7);
            expect(result.priority).toBe(ATTENTION_PRIORITY.NORMAL); // 0.56 weighted score
        });

        it('should score low intent for simple phrasal replies', () => {
            const result = engine.evaluate('cool');
            expect(result.signals.intent).toBe(0.2);
            expect(result.priority).toBe(ATTENTION_PRIORITY.IGNORE);
            expect(result.allowedCost).toBe(ATTENTION_COST.REFLEX);
        });

        it('should match goal keywords correctly', () => {
            engine.config.activeGoals = ['Database refactoring', 'Optimize imports'];
            const result = engine.evaluate('Let us discuss the database refactoring task');
            expect(result.signals.goal).toBeGreaterThan(0.5);
            expect(result.reasons).toContain('goal_relevant');
        });

        it('should detect emotions correctly', () => {
            const result = engine.evaluate('I am so stressed and overwhelmed');
            expect(result.signals.emotion).toBe(0.85);
            expect(result.reasons).toContain('emotionally_weighted');
        });
    });

    describe('Tension Management', () => {
        it('should support adding and resolving tensions', () => {
            engine.addTension('tension_1', { level: 0.8, topic: 'memory leak' });
            expect(engine.tensions.has('tension_1')).toBe(true);

            const result = engine.evaluate('Investigate the memory leak');
            expect(result.signals.tension).toBeGreaterThan(0);

            const resolved = engine.resolveTension('tension_1');
            expect(resolved).toBe(true);
            expect(engine.tensions.get('tension_1').status).toBe('resolved');
        });

        it('should decay active tensions periodically', () => {
            engine.addTension('tension_2', { level: 0.5, decayRate: 0.1 });
            expect(engine.tensions.get('tension_2').level).toBe(0.5);

            engine.decayTensions();
            expect(engine.tensions.get('tension_2').level).toBe(0.4);

            // Decay until threshold to delete
            for (let i = 0; i < 5; i++) {
                engine.decayTensions();
            }
            expect(engine.tensions.has('tension_2')).toBe(false);
        });
    });

    describe('Memory Actions', () => {
        it('should map scores to memory actions correctly', () => {
            const reflexResult = engine.evaluate('lol');
            expect(reflexResult.memoryAction).toBe('DISCARD');

            // Urgent but goal-free query to score 0.56 -> KEEP
            const normalResult = engine.evaluate('please refactor this codebase and fix the layout bugs immediately!');
            expect(normalResult.memoryAction).toBe('KEEP'); 

            // High tension trigger (> 0.75) -> PIN
            engine.addTension('pin_tension', { level: 0.9, topic: 'emergency' });
            const pinResult = engine.evaluate('emergency!');
            expect(pinResult.memoryAction).toBe('PIN');
        });
    });
});
