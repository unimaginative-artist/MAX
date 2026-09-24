// ═══════════════════════════════════════════════════════════════════════════
// TreeSearchTool — SOMA ASI Tree Search & Cognitive Recombination in MAX
// 
// Bridges MAX with SOMA's TreeSearchEngine, DivergentGenerator, CriticBrain,
// and RecombinationEngine for deep solution space exploration.
// Falls back to MAX Brain prompts if SOMA ASI modules are not mounted.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getSomaAsiCorePath() {
    const candidates = [
        process.env.SOMA_DIR ? path.join(process.env.SOMA_DIR, 'asi', 'core') : null,
        path.resolve(process.cwd(), '../SOMA/asi/core'),
        'c:\\Users\\barry\\Desktop\\SOMA\\asi\\core'
    ].filter(Boolean);

    for (const c of candidates) {
        try {
            if (fs.existsSync(path.join(c, 'TreeSearchEngine.cjs'))) {
                return c;
            }
        } catch {
            // ignore filesystem access errors
        }
    }
    return null;
}

export const createTreeSearchTool = (max) => {
    const asiPath = getSomaAsiCorePath();
    let TreeSearchEngine = null;
    let DivergentGenerator = null;
    let CriticBrain = null;
    let RecombinationEngine = null;

    if (asiPath) {
        try {
            TreeSearchEngine = require(path.join(asiPath, 'TreeSearchEngine.cjs'));
            DivergentGenerator = require(path.join(asiPath, 'DivergentGenerator.cjs'));
            CriticBrain = require(path.join(asiPath, 'CriticBrain.cjs'));
            RecombinationEngine = require(path.join(asiPath, 'RecombinationEngine.cjs'));
        } catch (err) {
            console.warn(`[TreeSearchTool] SOMA ASI modules load warning: ${err.message}`);
        }
    }

    const getLlmAdapter = () => ({
        generate: async (prompt, opts = {}) => {
            const brain = max.agentBrain || max.brain;
            if (!brain) return '';
            const res = await brain.think(prompt, {
                tier: opts.tier || 'smart',
                temperature: opts.temperature ?? 0.7,
                maxTokens: opts.maxTokens || 1200,
                systemPrompt: opts.systemPrompt || 'You are an advanced cognitive reasoning engine.'
            });
            return typeof res === 'string' ? res : (res?.text || res?.content || '');
        }
    });

    const createLogger = (prefix) => ({
        debug: () => {},
        info: (msg) => console.log(`  [${prefix}] ${msg}`),
        warn: (msg) => console.warn(`  [${prefix}] ⚠️ ${msg}`),
        error: (msg) => console.error(`  [${prefix}] ❌ ${msg}`)
    });

    return {
        name: 'treesearch',
        description: `Explore complex solution spaces using Tree Search, Divergent Thinking, Multi-Perspective Critique, and Cognitive Recombination.
Available actions:
  search    → Beam / best-first exploration over approaches: TOOL:treesearch:search:{"problem":"...","strategy":"beam","maxDepth":3}
  diverge   → Force multi-paradigm approach generation: TOOL:treesearch:diverge:{"problem":"...","count":4}
  critique  → Adversarially analyze proposal for flaws & edge cases: TOOL:treesearch:critique:{"problem":"...","solution":"..."}
  recombine → Cognitive crossover of 2+ solutions into hybrid: TOOL:treesearch:recombine:{"problem":"...","solutions":["A","B"]}`,

        actions: {
            search: async ({ problem, strategy = 'beam', maxDepth = 3, branchingFactor = 4, pruneThreshold = 0.2 }) => {
                if (!problem) return { success: false, error: 'Problem description is required' };

                if (TreeSearchEngine) {
                    try {
                        const engine = new TreeSearchEngine({
                            strategy,
                            maxDepth,
                            branchingFactor,
                            pruneThreshold,
                            llm: getLlmAdapter(),
                            useCognitiveDiversity: true,
                            logger: createLogger('TreeSearch')
                        });
                        const result = await engine.search(problem);
                        return result;
                    } catch (err) {
                        console.warn(`[TreeSearchTool] SOMA TreeSearchEngine failed, falling back: ${err.message}`);
                    }
                }

                // Native Brain Fallback
                const brain = max.agentBrain || max.brain;
                if (!brain) return { success: false, error: 'No brain available for search' };
                const prompt = `Perform a structured ${strategy} tree search to solve this problem.\n` +
                    `Problem: ${problem}\n` +
                    `Max depth: ${maxDepth}, Branching factor: ${branchingFactor}\n` +
                    `Output:\n1. Explored branches and hypotheses\n2. Evaluation/critique of each\n3. Best chosen solution and step-by-step reasoning.`;
                const res = await brain.think(prompt, { tier: 'smart', temperature: 0.3 });
                return {
                    success: true,
                    solution: { text: typeof res === 'string' ? res : res.text },
                    mode: 'brain_fallback'
                };
            },

            diverge: async ({ problem, count = 4, paradigms }) => {
                if (!problem) return { success: false, error: 'Problem description is required' };

                if (DivergentGenerator) {
                    try {
                        const generator = new DivergentGenerator({
                            llm: getLlmAdapter(),
                            paradigms: Array.isArray(paradigms) && paradigms.length > 0 ? paradigms : undefined,
                            logger: createLogger('DivergentGenerator')
                        });
                        const approaches = await generator.generate(
                            typeof problem === 'string' ? { description: problem } : problem,
                            count
                        );
                        return { success: true, count: approaches.length, approaches };
                    } catch (err) {
                        console.warn(`[TreeSearchTool] SOMA DivergentGenerator failed, falling back: ${err.message}`);
                    }
                }

                // Native Brain Fallback
                const brain = max.agentBrain || max.brain;
                if (!brain) return { success: false, error: 'No brain available for diverge' };
                const prompt = `Generate ${count} fundamentally different solution paradigms (e.g. recursive, iterative, functional, mathematical, heuristic, event-driven) for:\n${problem}\n` +
                    `For each paradigm, specify: name, paradigm, strategy, strengths, weaknesses.`;
                const res = await brain.think(prompt, { tier: 'smart', temperature: 0.7 });
                return {
                    success: true,
                    approaches: [{ text: typeof res === 'string' ? res : res.text }],
                    mode: 'brain_fallback'
                };
            },

            critique: async ({ problem, solution }) => {
                if (!problem || !solution) return { success: false, error: 'Both problem and solution are required' };

                if (CriticBrain) {
                    try {
                        const critic = new CriticBrain({
                            llm: getLlmAdapter(),
                            temperature: 0.2,
                            logger: createLogger('CriticBrain')
                        });
                        const evalResult = await critic.evaluate(
                            { solution: typeof solution === 'string' ? solution : JSON.stringify(solution) },
                            problem
                        );
                        return { success: true, ...evalResult };
                    } catch (err) {
                        console.warn(`[TreeSearchTool] SOMA CriticBrain failed, falling back: ${err.message}`);
                    }
                }

                // Native Brain Fallback
                const brain = max.agentBrain || max.brain;
                if (!brain) return { success: false, error: 'No brain available for critique' };
                const prompt = `Adversarially critique this solution for the problem.\n` +
                    `Problem: ${problem}\n` +
                    `Solution: ${typeof solution === 'string' ? solution : JSON.stringify(solution)}\n\n` +
                    `Identify:\n1. Flaws, edge cases, vulnerabilities, and performance bottlenecks\n2. Feasibility score (0.0 to 1.0)\n3. Required corrections.`;
                const res = await brain.think(prompt, { tier: 'smart', temperature: 0.2 });
                return {
                    success: true,
                    critique: typeof res === 'string' ? res : res.text,
                    score: 0.8,
                    mode: 'brain_fallback'
                };
            },

            recombine: async ({ problem, solutions = [], targetCount = 2 }) => {
                if (!problem || !solutions || solutions.length < 2) {
                    return { success: false, error: 'At least 2 solutions and a problem description are required' };
                }

                if (RecombinationEngine) {
                    try {
                        const recombiner = new RecombinationEngine({
                            llm: getLlmAdapter(),
                            logger: createLogger('RecombinationEngine')
                        });
                        const nodes = solutions.map((s, idx) => ({
                            approach: `solution_${idx + 1}`,
                            solution: typeof s === 'string' ? s : JSON.stringify(s),
                            score: 0.8
                        }));
                        const hybrids = await recombiner.recombine(
                            nodes,
                            typeof problem === 'string' ? { description: problem } : problem,
                            targetCount
                        );
                        return { success: true, hybrids };
                    } catch (err) {
                        console.warn(`[TreeSearchTool] SOMA RecombinationEngine failed, falling back: ${err.message}`);
                    }
                }

                // Native Brain Fallback
                const brain = max.agentBrain || max.brain;
                if (!brain) return { success: false, error: 'No brain available for recombine' };
                const prompt = `Perform cognitive crossover / recombination on these candidate solutions to produce ${targetCount} superior hybrid solutions.\n` +
                    `Problem: ${problem}\n` +
                    solutions.map((s, i) => `Solution Candidate ${i + 1}:\n${typeof s === 'string' ? s : JSON.stringify(s)}`).join('\n\n') +
                    `\nSynthesize the best attributes into unified superior solutions.`;
                const res = await brain.think(prompt, { tier: 'smart', temperature: 0.5 });
                return {
                    success: true,
                    hybrids: [{ text: typeof res === 'string' ? res : res.text }],
                    mode: 'brain_fallback'
                };
            }
        }
    };
};
