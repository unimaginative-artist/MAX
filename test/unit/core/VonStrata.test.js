import { TransformRegistry, Payload, StratumCell, CompositionCell, StructuralMutation, Environment } from '../../../core/VonStrata.js';
import { VonStrataTool } from '../../../tools/VonStrataTool.js';

describe('VonStrata Structures', () => {
    describe('TransformRegistry', () => {
        it('has all bootstrap primitives registered and sealed', () => {
            const primitives = Array.from(TransformRegistry.all().keys());
            expect(primitives).toContain('normalize');
            expect(primitives).toContain('partition');
            expect(primitives).toContain('hash');
            expect(primitives).toContain('emit');
            expect(primitives).toContain('upper');
            expect(primitives).toContain('double');
        });

        it('throws an error if attempting to register after seal', () => {
            expect(() => {
                TransformRegistry.register('invalid', () => {});
            }).toThrow('Registry is sealed');
        });
    });

    describe('StratumCell & Execution', () => {
        it('executes a primitive transform on a payload', async () => {
            const cell = new StratumCell('upper');
            const payload = new Payload('hello');
            const result = await cell.execute(payload);
            expect(result).not.toBeNull();
            expect(result.data).toBe('HELLO');
        });

        it('executes double primitive on a number', async () => {
            const cell = new StratumCell('double');
            const payload = new Payload(15);
            const result = await cell.execute(payload);
            expect(result).not.toBeNull();
            expect(result.data).toBe(30);
        });
    });

    describe('CompositionCell & Chains', () => {
        it('sequentially executes multiple primitives in a chain', async () => {
            const chain = new CompositionCell(['upper', 'normalize', 'hash']);
            const payload = new Payload('hello');
            const result = await chain.execute(payload);
            
            expect(result).not.toBeNull();
            expect(typeof result.data).toBe('number');
        });
    });

    describe('StructuralMutation', () => {
        it('extends a chain by adding a primitive to the end', () => {
            const base = new CompositionCell(['upper']);
            const extended = StructuralMutation.extend(base, 'double');
            expect(extended.chain).toEqual(['upper', 'double']);
        });

        it('splices two chains together', () => {
            const chainA = new CompositionCell(['upper']);
            const chainB = new CompositionCell(['double', 'normalize']);
            const spliced = StructuralMutation.splice(chainA, chainB);
            expect(spliced.chain).toEqual(['upper', 'double', 'normalize']);
        });

        it('truncates a chain to keep first N elements', () => {
            const base = new CompositionCell(['upper', 'double', 'normalize']);
            const truncated = StructuralMutation.truncate(base, 2);
            expect(truncated.chain).toEqual(['upper', 'double']);
        });

        it('swaps a primitive at a specific index', () => {
            const base = new CompositionCell(['upper', 'double']);
            const swapped = StructuralMutation.swap(base, 1, 'normalize');
            expect(swapped.chain).toEqual(['upper', 'normalize']);
        });
    });

    describe('Environment & Tool Evolution', () => {
        it('runs evolution and finds the fittest composition to double numbers', async () => {
            // Objective: double a number once (x * 2)
            // Inputs: 5 -> Expected: 10; Inputs: 10 -> Expected: 20
            const trainingData = [
                { input: 5, expected: 10, context: { label: 'five' } },
                { input: 10, expected: 20, context: { label: 'ten' } }
            ];

            const result = await VonStrataTool.actions.evolve({
                trainingData,
                generations: 3,
                populationSize: 15
            });

            expect(result.success).toBe(true);
            expect(result.fittest.length).toBeGreaterThan(0);
            
            // The fittest composition should be ['double']
            const topChain = result.fittest[0].chain;
            expect(topChain).toEqual(['double']);
        });
    });
});
