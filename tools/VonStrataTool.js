import { Environment, Payload, CompositionCell, TransformRegistry } from '../core/VonStrata.js';

export const VonStrataTool = {
    name: 'vonstrata',
    description: 'Evolve, optimize, and execute pure data-transformation pipelines (Compositions) via structural mutations.',

    actions: {
        async execute({ chain, data, context = {} }) {
            try {
                const composition = new CompositionCell(chain);
                const payload = new Payload(data, context);
                const result = await composition.execute(payload);
                if (result === null) {
                    return { success: false, error: 'Execution failed or timed out' };
                }
                return { success: true, result: result.data };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async getPrimitives() {
            try {
                const keys = Array.from(TransformRegistry.all().keys());
                return { success: true, primitives: keys };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async evolve({ trainingData, generations = 10, populationSize = 30 }) {
            try {
                if (!Array.isArray(trainingData) || trainingData.length === 0) {
                    return { success: false, error: 'trainingData must be a non-empty array' };
                }

                const env = new Environment(populationSize);

                for (let gen = 0; gen < generations; gen++) {
                    // 1. Inject inputs for all compositions to measure fitness
                    for (const item of trainingData) {
                        const context = item.context || {};
                        const payload = new Payload(item.input, context);

                        for (const comp of env.compositions) {
                            const result = await env.inject(comp, payload);
                            
                            // Extra fitness score if output matches the expected target
                            if (result && result.data !== undefined) {
                                const expected = item.expected;
                                const actual = result.data;
                                const isMatch = (typeof expected === 'object' && expected !== null)
                                    ? JSON.stringify(expected) === JSON.stringify(actual)
                                    : String(expected) === String(actual);

                                if (isMatch) {
                                    const contextName = context.label || 'default';
                                    const contextMap = env.metrics.get(contextName) || new Map();
                                    if (!env.metrics.has(contextName)) {
                                        env.metrics.set(contextName, contextMap);
                                    }
                                    const currentScore = contextMap.get(comp.signature) || 0;
                                    contextMap.set(comp.signature, currentScore + 10.0); // Large fitness bonus
                                }
                            }
                        }
                    }

                    // 2. Rank and spawn variants from the top 50% performers
                    const ranked = Array.from(env.compositions).map(comp => {
                        let totalScore = 0;
                        for (const context of env.metrics.keys()) {
                            const contextMap = env.metrics.get(context);
                            totalScore += contextMap.get(comp.signature) || 0;
                        }
                        return { comp, score: totalScore };
                    }).sort((a, b) => b.score - a.score);

                    const spawnCount = Math.floor(ranked.length / 2);
                    for (let i = 0; i < spawnCount; i++) {
                        env.spawnVariant(ranked[i].comp);
                    }
                }

                // Gather the final fitness report
                const finalRanked = Array.from(env.compositions).map(comp => {
                    let totalScore = 0;
                    for (const context of env.metrics.keys()) {
                        const contextMap = env.metrics.get(context);
                        totalScore += contextMap.get(comp.signature) || 0;
                    }
                    return {
                        chain: Array.from(comp.chain),
                        score: totalScore,
                        signature: comp.signature
                    };
                }).sort((a, b) => b.score - a.score);

                return {
                    success: true,
                    fittest: finalRanked.slice(0, 5),
                    totalPopulation: env.compositions.size
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
};
