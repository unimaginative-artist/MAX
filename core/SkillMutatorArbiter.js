import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * SkillMutatorArbiter — Evolutionary runtime for MAX's skill library.
 *
 * Lifecycle:
 *   spawnVariant(skill)    → generate a mutated step-chain
 *   queueForTest(variant)  → add to the test queue
 *   runNextTest()          → execute the oldest queued variant and score it
 *   scoreVariant()         → called internally after execution; promotes
 *                            high-scoring variants into the SkillLibrary
 *
 * Mutation operators:
 *   extend   — append a random primitive tool step
 *   splice   — concatenate another skill's steps
 *   swap     — replace a random step's tool with a primitive
 *   truncate — drop the tail of the step chain
 */
export class SkillMutatorArbiter extends EventEmitter {
    constructor(max) {
        super();
        this.max = max;
        this._primitives = new Set();
        this._sealed     = false;
        this._testQueue  = [];          // [{variant, testPrompt, skill}]
        this._running    = false;       // prevent concurrent test runs
        this.metrics = new Map();       // variantName -> score
        this.stats = {
            spawned:   0,
            tested:    0,
            promoted:  0,
            failed:    0
        };
    }

    /**
     * Phase 1: Register all core tools as frozen primitives.
     * Must be called once after tools are initialized.
     */
    initializeRegistry() {
        if (this._sealed) return;
        const tools = this.max.tools.list();
        for (const tool of tools) {
            if (tool.name) this._primitives.add(tool.name);
        }
        this._sealed = true;
        console.log(`[SkillMutator] 🛡️ Registry sealed — ${this._primitives.size} primitives.`);
        this.emit('evolution_update', { status: 'sealed', count: this._primitives.size });
    }

    /**
     * Phase 2: Create a mutated variant of an existing skill.
     * Returns null if the skill has no steps or primitives aren't ready.
     */
    spawnVariant(baseSkill) {
        if (!baseSkill?.steps?.length || !this._sealed) return null;

        const ops  = ['extend', 'splice', 'swap', 'truncate'];
        const type = ops[Math.floor(Math.random() * ops.length)];
        let   steps = [...baseSkill.steps];

        try {
            const randPrimitive = () => {
                const arr = Array.from(this._primitives);
                return arr[Math.floor(Math.random() * arr.length)];
            };

            switch (type) {
                case 'extend': {
                    const tool = randPrimitive();
                    steps.push({
                        step:        steps.length + 1,
                        tool,
                        action:      'run',
                        description: `Evolved extension: ${tool}`
                    });
                    break;
                }
                case 'splice': {
                    const all     = this.max.skills?._skills ?? [];
                    const others  = all.filter(s => s.id !== baseSkill.id && s.steps?.length);
                    if (!others.length) return null;
                    const partner = others[Math.floor(Math.random() * others.length)];
                    const extra   = partner.steps.map((s, i) => ({
                        ...s, step: steps.length + i + 1
                    }));
                    steps = [...steps, ...extra];
                    break;
                }
                case 'swap': {
                    const idx  = Math.floor(Math.random() * steps.length);
                    steps[idx] = { ...steps[idx], tool: randPrimitive() };
                    break;
                }
                case 'truncate': {
                    if (steps.length > 1) {
                        const keep = Math.max(1, Math.floor(Math.random() * steps.length));
                        steps = steps.slice(0, keep);
                    }
                    break;
                }
            }

            const variant = {
                name:     `${baseSkill.name}_v${Date.now().toString().slice(-6)}`,
                steps,
                parent:   baseSkill.name,
                mutation: type
            };
            this.stats.spawned++;
            this.emit('evolution_update', { status: 'spawned', variant: variant.name, mutation: type });
            return variant;
        } catch (err) {
            console.warn('[SkillMutator] spawnVariant error:', err.message);
            return null;
        }
    }

    /**
     * Queue a variant for real execution testing.
     * testContext is optional metadata from a recent successful outcome
     * that provides a representative prompt/task to replay.
     */
    queueForTest(variant, testContext = null) {
        if (!variant) return;
        const testPrompt = testContext?.title
            ? `Execute the task: "${testContext.title}"`
            : `Test the following skill steps and report success or failure.`;
        this._testQueue.push({ variant, testPrompt, queuedAt: Date.now() });
        this.emit('evolution_update', {
            status: 'queued',
            variant: variant.name,
            queueDepth: this._testQueue.length
        });
    }

    /**
     * Phase 3: Run the oldest queued variant through the AgentLoop.
     * Scores it and promotes to SkillLibrary if score exceeds threshold.
     */
    async runNextTest() {
        if (this._running || !this._testQueue.length) return;
        if (!this.max.agentLoop || !this.max.brain?._ready) return;

        this._running = true;
        const { variant, testPrompt } = this._testQueue.shift();

        console.log(`[SkillMutator] 🧪 Testing variant: "${variant.name}" (${variant.mutation})`);
        this.emit('evolution_update', { status: 'testing', variant: variant.name });

        const startTime = Date.now();
        let success = false;
        let outputDiversity = 0;

        try {
            // Build a temporary goal that exercises the variant's step chain
            const tempGoal = {
                id:          `variant_test_${Date.now()}`,
                title:       testPrompt,
                description: `Variant test for ${variant.name}. Execute each step: ${variant.steps.map(s => `${s.tool}.${s.action}`).join(' → ')}`,
                type:        'improvement',
                steps:       variant.steps,
                priority:    0.3,
                source:      'skill_mutator'
            };

            // _executeStep expects a Map (uses .get()/.set() internally)
            const stepResultMap = new Map();
            let stepsPassed = 0;
            for (const step of variant.steps) {
                try {
                    const result = await this.max.agentLoop._executeStep(step, tempGoal, stepResultMap);
                    stepResultMap.set(step.step, result);
                    if (result?.success !== false) stepsPassed++;
                } catch (stepErr) {
                    // One bad step doesn't abort the whole test — measure partial success
                    stepResultMap.set(step.step, { success: false, error: stepErr.message });
                }
            }
            success = stepsPassed === variant.steps.length;
            outputDiversity = Object.values(stepResultMap)
                .filter(r => r?.output || r?.content || r?.result)
                .length;

            this.stats.tested++;
            console.log(`[SkillMutator] Variant "${variant.name}" — ${stepsPassed}/${variant.steps.length} steps OK`);
        } catch (err) {
            console.warn(`[SkillMutator] Test run error for "${variant.name}":`, err.message);
            this.stats.failed++;
        } finally {
            this._running = false;
        }

        await this._scoreAndPromote(variant, {
            success,
            time: Date.now() - startTime,
            outputDiversity
        });
    }

    /**
     * Phase 4: Score execution result and promote strong variants.
     * score formula: +10 on success, –2 on failure, –cost penalty, +diversity bonus
     */
    async _scoreAndPromote(variant, { success, time, outputDiversity }) {
        let score = success ? 10.0 : -2.0;
        score -= Math.min(time / 5000, 5.0);            // penalty: up to –5 for slow execution
        score += Math.min(outputDiversity * 0.2, 2.0);  // bonus: up to +2 for rich outputs

        this.metrics.set(variant.name, score);
        this.emit('evolution_update', { status: 'scored', variant: variant.name, score });

        if (score >= 8.0 && this.max.skills?.encodeFromRun) {
            console.log(`[SkillMutator] ✨ Promoting variant "${variant.name}" (score ${score.toFixed(1)})`);
            this.stats.promoted++;
            try {
                await this.max.skills.encodeFromRun(
                    { title: `Evolved: ${variant.name}`, type: 'improvement' },
                    variant.steps,
                    this.max.brain
                );
                this.emit('evolution_update', {
                    status: 'promoted', variant: variant.name, score,
                    mutation: variant.mutation, parent: variant.parent
                });
            } catch (err) {
                console.warn(`[SkillMutator] Promotion failed for "${variant.name}":`, err.message);
            }
        }
    }

    getStatus() {
        return {
            sealed:        this._sealed,
            primitives:    this._primitives.size,
            queueDepth:    this._testQueue.length,
            running:       this._running,
            compositions:  this.metrics.size,
            ...this.stats
        };
    }
}
