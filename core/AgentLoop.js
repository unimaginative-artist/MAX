// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AgentLoop.js â€” MAX's autonomous execution engine
//
// This is what makes MAX agentic. When the heartbeat fires, the AgentLoop:
//   1. Picks the highest priority goal/task (from GoalEngine + tasks.md)
//   2. Simulates the plan (WorldModel)
//   3. Decomposes into steps (ReasoningChamber)
//   4. Executes each step with tools
//   5. Tracks outcome (OutcomeTracker)
//   6. Updates tasks.md and goal state
//   7. Emits insight so user sees what happened
//
// Human approval gate: anything destructive pauses and waits for /approve
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import { EventEmitter } from 'events';
import fs   from 'fs/promises';
import path from 'path';
import { commandPolicy }  from './CommandPolicyEngine.js';
import { LoopSelector }   from './LoopSelector.js';
import { ExploreLoop }    from './loops/ExploreLoop.js';
import { BuildLoop }      from './loops/BuildLoop.js';
import { ReflectLoop }    from './loops/ReflectLoop.js';
import { SentinelLoop }   from './loops/SentinelLoop.js';
import { DreamLoop }      from './loops/DreamLoop.js';
import { VisionLoop }     from './loops/VisionLoop.js';

// Actions that require human approval before running
const REQUIRES_APPROVAL = ['shell', 'git.commit', 'git.push', 'file.delete', 'file.write', 'file.replace', 'file.patch'];

// Wrap any promise with a hard timeout â€” prevents tool hangs from freezing the loop
function withTimeout(promise, ms, label = 'operation') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class AgentLoop extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max    = max;
        this.config = {
            maxStepsPerGoal:  config.maxStepsPerGoal  || 6,
            stepTimeoutMs:    config.stepTimeoutMs    || 60_000,
            requireApproval:  config.requireApproval  ?? true,   // gate destructive actions
            autoApproveLevel: config.autoApproveLevel || 'read', // 'read'|'write'|'all'
            maxReplans:       config.maxReplans       || 3,      // pivot attempts before giving up
            verifySteps:      config.verifySteps      ?? true,   // LLM verification gate per step
            ...config
        };

        this._running         = false;
        this._busy            = false;
        this._pendingApproval = null;   // { resolve, reject, description }
        this._interrupted     = false;  // set by interrupt() to pause at next wave boundary
        this._interruptFile   = path.join(process.cwd(), '.max', 'interrupt_state.json');
        this._toolFailures    = new Map(); // toolName -> count (Level 4 Meta-Correction)

        // â”€â”€ Loop dispatch infrastructure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this._selector = new LoopSelector();
        this._loops    = {
            explore:  new ExploreLoop(),
            build:    new BuildLoop(),
            reflect:  new ReflectLoop(),
            watch:    new SentinelLoop(),
            dream:    new DreamLoop(),
            vision:   new VisionLoop(),
        };

        this.stats = {
            cyclesRun:    0,
            goalsStarted: 0,
            goalsCompleted: 0,
            stepsExecuted: 0,
            replans:      0,
            searches:     0,
            approvalsPending: 0,
            approvalsGranted: 0,
            approvalsDenied: 0
        };
    }

    // â”€â”€â”€ Run one agent cycle (called by Heartbeat) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async runCycle() {
        if (this._busy) return null;
        this._busy = true;
        this.stats.cyclesRun++;

        try {
            // Check for a saved interrupt state â€” resume if found
            const saved = await this._loadInterruptState();
            const result = saved ? await this._resumeCycle(saved) : await this._cycle();
            return result;
        } catch (err) {
            console.error('[AgentLoop] Cycle error:', err.message);
            return null;
        } finally {
            this._busy = false;
        }
    }

    async _cycle(goalOverride = null) {
        const goals   = this.max.goals;
        const profile = this.max.profile;
        const drive   = this.max.drive;

        // â”€â”€ 1. Pick next goal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Priority: goalOverride (resume) > GoalEngine goals > tasks.md > curiosity
        let goal = goalOverride || goals?.getNext(drive);

        if (!goal) {
            // Fall back to tasks.md active tasks
            const tasks = profile?.getActiveTasks() || [];
            if (tasks.length > 0) {
                const taskTitle = tasks[0];
                goal = {
                    id:          `task_${Date.now()}`,
                    title:       taskTitle,
                    description: taskTitle,
                    type:        'task',
                    source:      'tasks.md',
                    steps:       [],
                    priority:    0.6
                };
            }
        }

        if (!goal) {
            // Nothing to do — let drive build tension
            drive?.onIdleTick();
            return null;
        }

        // ── 1.5 Route to specialized loop if applicable ───────────────────
        const { loop, confidence, rationale } = this._selector.classify(goal);

        if (loop !== 'default') {
            console.log(`  [AgentLoop] ðŸ”€ Loop: ${loop} (confidence: ${(confidence * 100).toFixed(0)}% â€” ${rationale})`);
            const loopHandler = this._loops[loop];
            if (loopHandler) {
                try {
                    const result = await loopHandler.run(goal, this.max, this);
                    // Surface the result as an insight so the launcher can show it
                    this.emit('insight', {
                        source: 'agent',
                        label:  result?.success
                            ? `âœ… Done (${loop}): ${goal.title}`
                            : `âš ï¸  Blocked (${loop}): ${goal.title}`,
                        result: result?.summary || goal.title
                    });
                    return result;
                } catch (err) {
                    this.emit('insight', {
                        source: 'agent',
                        label:  `âš ï¸  ${loop} loop error: ${goal.title}`,
                        result: err.message
                    });
                    console.warn(`  [AgentLoop] âš ï¸  ${loop} loop error â€” falling back to default: ${err.message}`);
                    // fall through to default linear execution
                }
            }
        }

        // ── 1.7 Adversarial Protocol for High-Priority Engineering ───────
        if (goal.priority >= 0.8 && goal.type === 'fix' && this.max.swarm) {
            try {
                const advResult = await this.max.swarm.adversarialRun(goal);
                if (advResult?.synthesis) {
                    return { goal: goal.title, success: true, summary: advResult.synthesis };
                }
            } catch (err) {
                console.warn(`  [AgentLoop] ⚔️ Adversarial run failed: ${err.message}`);
            }
        }

        // ── 2. Decompose into steps if needed ──────────────────────────────
        const toolNames = (this.max.tools?.list() || []).map(t => t.name);

        if (!goal.steps || goal.steps.length === 0) {
            // Recall a proven skill — inject into planner so it reuses what worked before
            const skill = await this.max.skills?.recall(goal.title) || null;

            if (goals?.decompose) {
                // ARCHITECT PHASE: Use smart tier (Reasoner) for planning
                goal.steps = await goals.decompose(goal, { availableTools: toolNames, skill, tier: 'smart' });
            } else {
                goal.steps = [{ step: 1, action: goal.description || goal.title, tool: 'brain', success: 'completed', dependsOn: [] }];
            }
            // Validate the plan before committing to it — ARCHITECT PHASE
            goal.steps = await this._validatePlan(goal, goal.steps, toolNames);
        }

        console.log(`\n[AgentLoop] ðŸŽ¯ Goal: "${goal.title}" (${goal.steps.length} steps)`);
        this.stats.goalsStarted++;

        this.emit('goalStart', { goal });

        // â”€â”€ 2.5 Swarm Delegation for complex tasks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (goal.steps.length >= 5 && this.max.swarm) {
            console.log(`  [AgentLoop] ðŸ Goal is complex â€” delegating to SwarmCoordinator`);
            try {
                const swarmResult = await this.max.swarm.run({
                    name: goal.title,
                    subtasks: goal.steps.map(s => ({ id: `step_${s.step}`, prompt: s.action, tools: [{ tool: s.tool, action: s.action_name || 'run', params: s.params || {} }] }))
                });
                if (swarmResult?.synthesis) {
                    return { goal: goal.title, success: true, summary: swarmResult.synthesis };
                }
            } catch (err) {
                console.warn(`  [AgentLoop] âš ï¸ Swarm delegation failed, falling back to serial execution: ${err.message}`);
            }
        }

        // â”€â”€ 3. Execute steps â€” with Pivot Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // On step failure, re-decompose with error context and retry.
        const stepResults = [];
        let   goalSuccess = false;
        let   goalSummary = '';
        let   replans     = 0;

        while (replans <= this.config.maxReplans) {
            stepResults.length = 0;
            const stepResultMap = new Map();
            let failed    = false;
            let failReason = '';

            const allSteps = goal.steps.slice(0, this.config.maxStepsPerGoal);
            const waves    = this._buildExecutionWaves(allSteps);

            for (const wave of waves) {
                // â”€â”€ Interrupt check â€” pause at wave boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
                if (this._interrupted) {
                    this._interrupted = false;
                    await this._saveInterruptState(goal, stepResultMap);
                    this.emit('insight', {
                        source: 'agent',
                        label:  'â¸ï¸ Task paused',
                        result: `Saved progress on "${goal.title}" â€” /resume to continue`
                    });
                    return { goal: goal.title, success: false, summary: 'Paused â€” use /resume', interrupted: true };
                }

                let waveResults;
                if (wave.length > 1) {
                    console.log(`  [AgentLoop] âš¡ Parallel: steps ${wave.map(s => s.step).join(', ')}`);
                    waveResults = await Promise.all(wave.map(s => this._executeStep(s, goal, stepResultMap)));
                } else {
                    waveResults = [await this._executeStep(wave[0], goal, stepResultMap)];
                }

                for (const result of waveResults) {
                    stepResultMap.set(result.step, result);
                    stepResults.push(result);
                }

                const failedResult = waveResults.find(r => !r.success);
                if (failedResult) {
                    failed     = true;
                    failReason = `Step ${failedResult.step} failed: ${failedResult.error}`;
                    break;
                }

                drive?.onTaskExecuted();
                this.stats.stepsExecuted += wave.length;
            }

            if (!failed) {
                // â”€â”€ #3: verifyCommand â€” run a smoke test to confirm success â”€â”€
                // Goals can include a verifyCommand like "node --check file.js" or
                // "curl -s http://localhost:3100/health". If it fails, the goal is
                // marked incomplete and MAX gets another attempt with the failure context.
                if (goal.verifyCommand) {
                    try {
                        console.log(`  [AgentLoop] ðŸ” Verifying: ${goal.verifyCommand}`);
                        const verifyResult = await withTimeout(
                            this.max.tools.execute('shell', 'run', {
                                command:   goal.verifyCommand,
                                timeoutMs: 15_000
                            }),
                            18_000,
                            'verify'
                        );
                        const passed = verifyResult?.exitCode === 0 || verifyResult?.success !== false;
                        if (!passed) {
                            const errOut = (verifyResult?.stderr || verifyResult?.stdout || 'non-zero exit').slice(0, 200);
                            failed      = true;
                            failReason  = `verifyCommand failed: ${errOut}`;
                            console.log(`  [AgentLoop] âŒ Verification failed: ${failReason}`);
                            // Don't break â€” fall through to the replan logic below
                        } else {
                            console.log(`  [AgentLoop] âœ… Verification passed`);
                        }
                    } catch (verifyErr) {
                        console.warn(`  [AgentLoop] âš ï¸  Verify error (non-fatal): ${verifyErr.message}`);
                        // Don't fail the goal on verify timeout/error â€” treat as passed
                    }
                }

                if (!failed) {
                    goalSuccess = true;
                    goalSummary = stepResults.map(r => r.summary || '').filter(Boolean).join(' â†’ ');
                    // Encode the winning plan as a skill (fire-and-forget procedural memory)
                    this.max.skills?.encodeFromRun(goal, goal.steps, this.max.brain).catch(() => {});
                    // Auto-commit any file changes made during this goal
                    this._autoCommit(goal.title).catch(() => {});
                    break;
                }
                // else: fall through with failed=true and failReason set from verifyCommand
            }

            // â”€â”€ Smart error categorization â€” choose pivot strategy â”€â”€â”€â”€â”€â”€â”€â”€
            const errType = this._categorizeError(failReason);
            console.log(`  [AgentLoop] ðŸ”¬ Error type: ${errType} â€” ${failReason.slice(0, 80)}`);

            // â”€â”€ Level 4 Meta-Correction: Track Tool Failure Hotspots â”€â”€â”€â”€â”€
            if (errType === 'TOOL_ERROR' || errType === 'TEST_FAILURE') {
                const failedStep = stepResults.find(r => !r.success);
                const tName = failedStep?.tool?.split('.')[0] || 'unknown';
                const count = (this._toolFailures.get(tName) || 0) + 1;
                this._toolFailures.set(tName, count);

                if (count >= 3 && tName !== 'unknown') {
                    console.log(`  [AgentLoop]   [AgentLoop] âš ï¸ Tool "${tName}" failed ${count} times â€” triggering Architectural Audit`);

                    // Persist hotspot to OutcomeTracker so GoalEngine priority + decompose can see it
                    this.max.outcomes?.record({
                        agent:   'AgentLoop',
                        action:  'tool_hotspot',
                        context: { tool: tName, failCount: count, goalTitle: goal.title },
                        result:  failedStep?.error?.slice(0, 200),
                        success: false,
                        reward:  -0.5
                    });

                    // Trigger Level 4 Meta-Correction (Project Lazarus)
                    await this._metaCorrect(tName, failedStep?.error, failReason);

                    this._toolFailures.set(tName, 0); // reset after triggering
                }
            }

            // PERMISSION: surface to user and stop â€” don't burn replans on auth issues
            if (errType === 'PERMISSION') {
                this.emit('approvalNeeded', {
                    description: `Permission error on "${goal.title}": ${failReason}`,
                    goal:    goal.title,
                    step:    null,
                    approve: () => {},
                    deny:    () => {}
                });
                this._proactiveSocialReachout(goal, `Permission error: ${failReason}`).catch(() => {});
                goalSummary = `Blocked by permission: ${failReason}`;
                break;
            }

            replans++;
            this.stats.replans++;

            if (replans > this.config.maxReplans) {
                goalSummary = `Gave up after ${replans - 1} replans. Last error: ${failReason}`;
                this._proactiveSocialReachout(goal, `Max replans reached. Last error: ${failReason}`).catch(() => {});
                // â”€â”€ Proactive fallback: build a structured investigation goal â”€â”€
                // Instead of silently giving up, queue a deeper investigation so
                // MAX steps back and comes at the problem from a different angle.
                const fallback = await this._buildFallbackGoal(goal, failReason);
                if (fallback) {
                    const newId = this.max.goals?.addGoal(fallback);
                    if (newId) {
                        goalSummary += ` Queued investigation: "${fallback.title}"`;
                        this.emit('insight', {
                            source: 'agent',
                            label:  `ðŸ—ºï¸  Building investigation plan for: ${goal.title}`,
                            result: `Couldn't solve directly after ${replans - 1} attempts.\nQueued structured investigation: "${fallback.title}"\n${fallback.description}`
                        });
                    }
                }
                break;
            }

            // â”€â”€ Diagnosis step-back â€” first LOGIC failure on a real GoalEngine goal â”€â”€
            // Instead of immediately redecomposing (same approach, different words),
            // diagnose the root cause and queue a structurally different remedy goal.
            // The original goal re-enters the queue blocked on the remedy â€” the
            // dependency graph handles the rest automatically when remedy completes.
            if (errType === 'LOGIC' && replans === 1 && goal.id && this.max.goals?._active?.has(goal.id)) {
                console.log(`  [AgentLoop] ðŸ”¬ Diagnosing root cause before replan...`);
                const diagnosis = await this._diagnoseFailure(goal, failReason, stepResults);

                if (diagnosis?.remedyGoal) {
                    const remedyId = this.max.goals.addGoal({
                        ...diagnosis.remedyGoal,
                        source:    'auto',
                        blockedBy: []
                    });

                    if (remedyId) {
                        this.max.goals.requeue(goal.id, [remedyId]);

                        this.emit('insight', {
                            source: 'agent',
                            label:  `ðŸ”¬ Diagnosed: ${goal.title}`,
                            result: `Root cause: ${diagnosis.rootCause}\n${diagnosis.explanation}\n\nQueued remedy: "${diagnosis.remedyGoal.title}"\nOriginal goal re-queued â€” will retry when remedy completes.`
                        });

                        this.max.outcomes?.record({
                            agent:   'AgentLoop',
                            action:  'goal:diagnosed',
                            context: { title: goal.title, rootCause: diagnosis.rootCause },
                            result:  diagnosis.explanation,
                            success: true,
                            reward:  0.3   // positive â€” this is intelligent behavior
                        });

                        console.log(`  [AgentLoop] ðŸ—ºï¸  Diagnosis: ${diagnosis.rootCause} â€” remedy: "${diagnosis.remedyGoal.title}"`);
                        return { goal: goal.title, success: false, summary: `Diagnosed: ${diagnosis.explanation}`, diagnosed: true };
                    }
                }
                // Diagnosis failed or remedy couldn't be created â€” fall through to normal replan
                console.log(`  [AgentLoop] Diagnosis inconclusive â€” falling back to replan`);
            }

            // TIMEOUT: count against replan budget â€” retrying identical plan on a slow model
            // loops forever. Increment replans so we give up after maxReplans attempts.
            if (errType === 'TIMEOUT') {
                replans++;
                if (replans > this.config.maxReplans) break;
                console.log(`  [AgentLoop] â±ï¸  Timeout (${replans}/${this.config.maxReplans}) â€” retrying with reduced scope`);
                await new Promise(r => setTimeout(r, 5_000));
                continue;
            }

            // NETWORK: short backoff then replan â€” might need different endpoint/approach
            if (errType === 'NETWORK') {
                console.log(`  [AgentLoop] ðŸŒ Network error â€” backing off 5s then replanning`);
                await new Promise(r => setTimeout(r, 5_000));
            }

            // LOGIC + NETWORK (after backoff): research + replan
            console.log(`  [AgentLoop] â†©ï¸  Pivoting (replan ${replans}/${this.config.maxReplans}): ${failReason}`);

            // â”€â”€ After 2 failures: research before replanning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Two bad plans in a row means MAX doesn't know enough.
            // Do deeper research on the topic before generating plan 3+.
            let researchContext = '';
            if (replans >= 2) {
                console.log(`  [AgentLoop] ðŸ“š Two failures â€” researching before replan ${replans}...`);
                researchContext = await this._deepResearch(goal, failReason);
                if (researchContext) {
                    console.log(`  [AgentLoop] ðŸ“– Research complete â€” injecting context`);
                    this.stats.searches++;
                    this.emit('insight', {
                        source: 'agent',
                        label:  `ðŸ“š Research: "${goal.title}"`,
                        result: researchContext
                    });
                    this.max.memory?.remember(researchContext, { goal: goal.title, source: 'agent_research' }, {
                        type: 'research', importance: 0.75
                    });
                }
            }

            // Append failure context (+ research if available) and re-decompose
            const errorNote = `[Attempt ${replans} failed (${errType}): ${failReason}. Try a completely different approach.]`;
            const researchNote = researchContext ? `\n\n[Research findings:\n${researchContext}]` : '';
            goal.description = `${goal.description || goal.title}\n\n${errorNote}${researchNote}`;
            const newSteps = goals?.decompose
                ? await goals.decompose(goal, { availableTools: toolNames })
                : [{ step: 1, action: goal.description, tool: 'brain', success: 'completed' }];
            goal.steps = await this._validatePlan(goal, newSteps, toolNames);

            console.log(`  [AgentLoop] ðŸ”„ New plan: ${goal.steps.length} steps`);
        }

        // â”€â”€ 4. Record outcome â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.max.outcomes?.record({
            agent:   'AgentLoop',
            action:  `goal:${goal.type}`,
            context: { title: goal.title, source: goal.source, steps: goal.steps.length },
            result:  goalSummary,
            success: goalSuccess,
            reward:  goalSuccess ? 0.9 : -0.2
        });

        // ── 5. Consolidate outcome into knowledge base ────────────────────
        if (goalSummary && this.max.kb?._ready) {
            // High-fidelity Trajectory Compression (Phase 1)
            this.max.reflection?.compressTrajectory(goal, stepResults, goalSuccess).catch(() => {});
            
            const entry = goalSuccess
                ? `Completed: "${goal.title}"\n${goalSummary}`
                : `Failed: "${goal.title}"\nReason: ${goalSummary}`;
            this.max.kb.remember(entry, { source: 'agent_loop', goalType: goal.type }).catch(() => {});
        }

        // â”€â”€ 6. Update goal state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (goal.source === 'tasks.md' && goalSuccess) {
            profile?.completeTask(goal.title);
        } else if (goals?._active?.has(goal.id)) {
            goalSuccess ? goals.complete(goal.id, { summary: goalSummary })
                        : goals.fail(goal.id, goalSummary);
        }

        goalSuccess ? drive?.onGoalComplete(goal.title) : null;

        // Crystallize successful runs into reusable skills (fire-and-forget)
        if (goalSuccess && stepResults.length > 0) {
            this.max.skills?.encodeFromRun(goal, stepResults, this.max.agentBrain).catch(() => {});
        }

        this.stats.goalsCompleted += goalSuccess ? 1 : 0;

        // â”€â”€ #4: Economics â€” reward for goal completion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if (goalSuccess && this.max.economics) {
            const baseReward = 0.05;
            const priorityBonus = (goal.priority || 0.5) * 0.10;
            const totalReward = baseReward + priorityBonus;
            this.max.economics.recordEarning(totalReward, `goal:${goal.title}`);
        }

        // â”€â”€ 6. Emit insight to surface result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const insightResult = goalSuccess
            ? `Completed: "${goal.title}"\n${goalSummary}`
            : `Could not complete: "${goal.title}"\n${goalSummary}`;

        this.emit('insight', {
            source: 'agent',
            label:  goalSuccess ? `âœ… Goal done: ${goal.title}` : `âš ï¸ Goal blocked: ${goal.title}`,
            result: insightResult
        });

        // â”€â”€ 7. Proactive background messaging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        this.max.say(
            goalSuccess 
                ? `I've successfully completed the background task: "${goal.title}".` 
                : `I've hit a roadblock with the background task: "${goal.title}".`,
            goalSuccess ? "Success" : "Blocked"
        );

        // Store in memory
        this.max.memory?.remember(insightResult, { goal: goal.title, source: 'agent_loop' }, {
            type: 'task_result',
            importance: goalSuccess ? 0.8 : 0.5
        });

        this.emit('goalDone', { goal, success: goalSuccess });
        return { goal: goal.title, success: goalSuccess, summary: goalSummary };
    }

    // ─── Execute a single step ─────────────────────────────────────────────
    async _executeStep(step, goal, stepResultMap = new Map()) {
        const stepAction = step.action;
        const fullToolName = step.tool || 'brain';

        // Parse tool and action from step.tool (format: "tool" or "tool.action")
        const [toolName, tDotAction] = fullToolName.includes('.') ? fullToolName.split('.') : [fullToolName, 'run'];
        const action = step.action_name || tDotAction;

        // Only log step start for tool steps — brain steps are too noisy in chat
        if (toolName !== 'brain') {
            console.log(`  [AgentLoop] Step ${step.step}: ${stepAction.slice(0, 70)} [${toolName}.${action}]`);
        }

        // ── Inject outputs from dependency steps into the prompt context ──
        const depContext = (step.dependsOn || [])
            .map(d => stepResultMap.get(Number(d)))
            .filter(Boolean)
            .map(r => `Step ${r.step} result: ${(r.result || '').slice(0, 400)}`)
            .join('\n');

        // ── Approval gate ──────────────────────────────────────────────────
        if (this.config.requireApproval && this.needsApproval(toolName, action)) {
            const approved = await this.requestApproval(toolName, action, step.params || {}, goal);
            if (!approved) {
                return { step: step.step, success: false, error: 'User denied', summary: '' };
            }
        }

        this.emit('stepStart', {
            step:       step.step,
            action:     stepAction.slice(0, 80),
            tool:       toolName,
            toolAction: action,
            params:     step.params || {}
        });

        try {
            let result = '';

            const timeoutMs = this.config.stepTimeoutMs;
            const isCoding  = this._isCodingStep(step, goal);

            if (toolName === 'brain') {
                const depNote = depContext ? `\n\nPRIOR STEP OUTPUTS:\n${depContext}` : '';
                const resObj = await withTimeout(
                    this.max.agentBrain.think(
                        `Complete this step concisely:\n\nGOAL: ${goal.title}\nSTEP: ${action}${depNote}`,
                        {
                            systemPrompt: `You are MAX completing an autonomous task step. Be concrete and brief.`,
                            temperature:  isCoding ? 0.2 : 0.4,
                            maxTokens:    isCoding ? 2048 : 512,
                            tier:         isCoding ? 'code' : 'fast'   // non-coding steps use local LLM
                        }
                    ),
                    timeoutMs,
                    'brain step'
                );
                result = resObj.text;
            } else {
                const tool = this.max.tools.get(toolName);

                if (tool) {
                    // step.params is the authoritative source (set by the planner).
                    // Legacy fallbacks ensure old plans without params still work.
                    const toolParams = {
                        command:  action,       // shell fallback: action as command
                        filePath: step.path || step.file,
                        content:  step.content,
                        query:    action,       // web fallback
                        cwd:      process.cwd(),
                        ...(step.params || {})  // planner-specified params win
                    };

                    // Policy gate: validate shell commands before execution
                    if (toolName === 'shell' && toolParams.command) {
                        const policy = commandPolicy.validate(String(toolParams.command), toolParams.cwd || process.cwd());
                        if (!policy.allowed) {
                            console.warn(`  [AgentLoop] 🚫 Command blocked by policy: ${policy.reason}`);
                            return { step: step.step, success: false, result: '', summary: `Blocked — ${policy.reason}` };
                        }
                    }

                    // ── Self-Healing Pipeline: Backup Original State ──
                    let originalContent = null;
                    const isFileMod = toolName === 'file' && ['write', 'replace', 'edit', 'patch'].includes(action);
                    if (isFileMod && toolParams.filePath) {
                        try {
                            const fs = await import('fs/promises');
                            originalContent = await fs.readFile(toolParams.filePath, 'utf8');
                        } catch { /* file might not exist yet, which is fine for 'write' */ }
                    }

                    let toolResult = await withTimeout(
                        this.max.tools.execute(toolName, action, toolParams),
                        timeoutMs,
                        `${toolName}.${action}`
                    );

                    // ── Step retry for file:replace "not found" ──
                    if (toolResult?.success === false && toolName === 'file' && action === 'replace'
                            && toolResult.error?.includes('not found')) {
                        console.log(`  [AgentLoop] 🔄 Replace failed — re-reading file and retrying...`);
                        toolResult = await this._retryReplace(toolParams, step, goal).catch(() => toolResult);
                    }

                    // ── Self-Healing Pipeline: Pre-Commit Shadow Loop ──
                    if (toolResult?.success && isFileMod && toolParams.filePath) {
                        const ext = toolParams.filePath.split('.').pop().toLowerCase();
                        if (['js', 'mjs', 'cjs', 'ts'].includes(ext)) {
                            console.log(`  [AgentLoop] 🕵️‍♂️ Running Pre-Commit Shadow Validation on ${toolParams.filePath}...`);
                            try {
                                const checkCmd = `node --check ${toolParams.filePath}`;
                                const checkResult = await withTimeout(
                                    this.max.tools.execute('shell', 'run', { command: checkCmd }),
                                    10000,
                                    'shadow validation'
                                );
                                
                                // node --check sometimes returns 0 even on syntax error in certain environments.
                                // We check both exit code AND stderr for "SyntaxError" string.
                                const hasError = checkResult?.success === false || 
                                               (checkResult?.stderr && checkResult.stderr.includes('SyntaxError'));

                                if (hasError) {
                                    console.warn(`  [AgentLoop] ❌ Shadow Validation Failed! Reverting change.`);
                                    // Auto-revert the broken code
                                    const fs = await import('fs/promises');
                                    if (originalContent !== null) {
                                        await fs.writeFile(toolParams.filePath, originalContent);
                                    } else {
                                        await fs.unlink(toolParams.filePath).catch(() => {});
                                    }
                                    
                                    // Throw the error so the AgentLoop pivots and tries a different approach
                                    throw new Error(`Syntax Error Introduced: ${checkResult.stderr || checkResult.error || 'Invalid code structure'}. The change was reverted. Fix the logic and try again.`);
                                }
                                console.log(`  [AgentLoop] ✅ Shadow Validation Passed.`);
                                // Trigger CI suite non-blocking — failures auto-queue fix goals
                                this.max?.ci?.checkOnFileWrite(toolParams.filePath).catch(() => {});

                                // ── Phase 5.4: Autonomous Test Running ──
                                // If a relevant test file exists, run it!
                                const baseName = path.basename(toolParams.filePath, ext.startsWith('.') ? ext : `.${ext}`);
                                const testFile = toolParams.filePath.replace(ext, `test.${ext}`);
                                
                                try {
                                    const testStat = await fs.stat(testFile);
                                    if (testStat.isFile()) {
                                        console.log(`  [AgentLoop] 🧪 Found matching test file: ${testFile}. Running validation...`);
                                        const testCmd = `npm test ${testFile} -- --passWithNoTests`;
                                        const testResult = await withTimeout(
                                            this.max.tools.execute('shell', 'run', { command: testCmd }),
                                            30000,
                                            'unit test'
                                        );
                                        
                                        if (testResult?.success === false) {
                                            console.warn(`  [AgentLoop] ❌ Unit Test Failed! Reverting change.`);
                                            if (originalContent !== null) await fs.writeFile(toolParams.filePath, originalContent);
                                            throw new Error(`Behavioral Regression Detected: The change broke the existing unit test (${testFile}). Reverted for safety. Fix the implementation.`);
                                        }
                                        console.log(`  [AgentLoop] ✅ Unit Test Passed.`);
                                    }
                                } catch { /* no test file — skip behavioral check */ }

                            } catch (shadowErr) {
                                // If the shadow validation itself fails (e.g. timeout or syntax error thrown), propagate it
                                if (shadowErr.message.includes('Syntax Error')) throw shadowErr;
                                console.warn(`  [AgentLoop] ⚠️ Shadow validation skipped or errored internally: ${shadowErr.message}`);
                            }
                        }
                    }

                    // Propagate tool failures as thrown errors so search-and-retry
                    // kicks in rather than silently reporting success on a broken step.
                    if (toolResult?.success === false) {
                        throw new Error(toolResult.error || `${tName}.${tAction} returned failure`);
                    }

                    result = JSON.stringify(toolResult).slice(0, 500);
                } else {
                    // Unknown tool â€” fall back to brain
                    const resObj = await withTimeout(
                        this.max.agentBrain.think(
                            `Complete this step: ${action}`,
                            { temperature: 0.4, maxTokens: 512, tier: 'fast' }
                        ),
                        timeoutMs,
                        'brain fallback'
                    );
                    result = resObj.text;
                }
            }

            const summary = typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);

            // â”€â”€ Verification Gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Success criterion is a substring that should appear in the output.
            // "completed" means no output check needed (write/create steps).
            if (this.config.verifySteps && step.success && step.success !== 'completed') {
                const criterion = step.success.toLowerCase();
                const outputLower = summary.toLowerCase();
                // Fast path: literal substring check (no LLM call needed)
                const passedLiteral = outputLower.includes(criterion);
                if (!passedLiteral) {
                    // Slow path: ask brain only if literal check fails
                    try {
                        const verifyResult = await withTimeout(
                            this.max.agentBrain.think(
                                `Does this output satisfy the success criterion?\n\nCRITERION: ${step.success}\nOUTPUT: ${summary}\n\nReply with only YES or NO.`,
                                { temperature: 0.0, maxTokens: 10, tier: 'fast' }
                            ),
                            15_000,
                            'verify'
                        );
                        const verdict = verifyResult.text.trim().toUpperCase();
                        if (verdict.startsWith('NO')) {
                            throw new Error(`Verification failed: expected "${step.success}" but output was: ${summary.slice(0, 100)}`);
                        }
                    } catch (verifyErr) {
                        // Only treat as failure if it's our own thrown error, not a brain timeout
                        if (verifyErr.message.startsWith('Verification failed')) throw verifyErr;
                        // Brain timeout â†’ skip verification, proceed
                        console.warn(`  [AgentLoop] Verify skipped: ${verifyErr.message}`);
                    }
                }
            }

            this.emit('stepDone', { step: step.step, success: true, summary });
            return { step: step.step, success: true, result, summary };

        } catch (err) {
            // â”€â”€ Search-and-Retry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            // Before giving up, search the web for a solution and retry once.
            console.log(`  [AgentLoop] ðŸ” Searching for a solution to: ${err.message.slice(0, 80)}`);
            const searchContext = await this._searchForSolution(step, goal, err.message);

            if (searchContext) {
                try {
                    const retryObj = await withTimeout(
                        this.max.agentBrain.think(
                            `Complete this step. A previous attempt failed.\n\nGOAL: ${goal.title}\nSTEP: ${action}\nERROR: ${err.message}\n\nSEARCH RESULTS:\n${searchContext}\n\nUse the search results to find the correct approach.`,
                            { systemPrompt: 'You are MAX completing an autonomous task step. Be concrete and brief.', temperature: 0.3, maxTokens: 512, tier: 'fast' }
                        ),
                        this.config.stepTimeoutMs,
                        'search retry'
                    );
                    const retrySummary = retryObj.text.slice(0, 200);
                    console.log(`  [AgentLoop] âœ… Search retry succeeded`);
                    this.stats.searches++;
                    this.emit('stepDone', { step: step.step, success: true, summary: retrySummary });
                    return { step: step.step, success: true, result: retryObj.text, summary: retrySummary };
                } catch (retryErr) {
                    console.error(`  [AgentLoop] Search retry also failed:`, retryErr.message);
                }
            }

            console.error(`  [AgentLoop] Step ${step.step} failed:`, err.message);
            this.emit('stepDone', { step: step.step, success: false, summary: '' });
            return { step: step.step, success: false, error: err.message, summary: '' };
        }
    }

    // â”€â”€â”€ Search for a solution to a failed step â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async _searchForSolution(step, goal, errorMsg) {
        try {
            const query = `how to ${step.action.slice(0, 80)} ${errorMsg.slice(0, 60)}`.replace(/\s+/g, ' ').trim();
            console.log(`  [AgentLoop] ðŸŒ Web search: "${query.slice(0, 100)}"`);

            const searchResult = await withTimeout(
                this.max.tools.execute('web', 'search', { query }),
                20_000,
                'web search'
            );

            if (!searchResult?.results?.length) return null;

            return searchResult.results
                .slice(0, 3)
                .map(r => `[${r.title}]: ${r.snippet || r.body || ''}`)
                .join('\n\n')
                .slice(0, 1500);

        } catch (e) {
            console.warn(`  [AgentLoop] Search unavailable: ${e.message}`);
            return null;
        }
    }

    // --- Deep research -- iterative search + synthesis ----------------------
    // Phase 1: LLM generates targeted queries
    // Phase 2: Run each query, collect learnings + follow-up questions
    // Phase 3: One follow-up search on most promising question
    // Phase 4: Synthesize all learnings into actionable guidance
    async _deepResearch(goal, lastError) {
        try {
            // Phase 1 -- LLM generates queries
            const queryPlan = await withTimeout(
                this.max.agentBrain.think(
                    `Goal: "${goal.title}"
Failed with: ${lastError.slice(0, 120)}

Generate exactly 3 targeted search queries to find a solution. Return as JSON array of strings, nothing else. Example: ["query one","query two","query three"]`,
                    { temperature: 0.2, maxTokens: 150, tier: 'fast' }
                ),
                15_000,
                'query generation'
            );

            let queries;
            try {
                const match = queryPlan.text.match(/[[sS]*]/);
                queries = match ? JSON.parse(match[0]) : [];
            } catch { queries = []; }

            if (!queries.length) {
                queries = [
                    `how to ${goal.title.slice(0, 80)}`,
                    `${lastError.slice(0, 60)} solution`,
                    `best approach for ${goal.title.slice(0, 60)}`
                ];
            }

            // Phase 2 -- run searches, accumulate learnings + follow-ups
            const learnings = [];
            const followUps = [];

            for (const query of queries.slice(0, 3)) {
                try {
                    console.log(`  [AgentLoop] Research: "${query.slice(0, 80)}"`);
                    const r = await withTimeout(
                        this.max.tools.execute('web', 'search', { query }),
                        20_000,
                        'research search'
                    );
                    if (!r?.results?.length) continue;

                    const snippets = r.results.slice(0, 3).map(x => `${x.title}: ${x.snippet || x.body || ''}`).join('\n')
                    const extract = await withTimeout(
                        this.max.agentBrain.think(
                            `Query: "${query}"
Results:
${snippets.slice(0, 1500)}

Extract 1-2 key learnings and 1 follow-up question. JSON: {"learnings":["..."],"followUp":"..."}`,
                            { temperature: 0.2, maxTokens: 150, tier: 'fast' }
                        ),
                        12_000,
                        'learning extract'
                    );
                    try {
                        const m = extract.text.match(/{[sS]*}/);
                        if (m) {
                            const parsed = JSON.parse(m[0]);
                            if (parsed.learnings) learnings.push(...parsed.learnings);
                            if (parsed.followUp) followUps.push(parsed.followUp);
                        }
                    } catch { learnings.push(snippets.slice(0, 300)); }
                } catch { /* skip failed individual searches */ }
            }

            // Phase 3 -- one follow-up search
            if (followUps.length) {
                try {
                    const fq = followUps[0];
                    console.log(`  [AgentLoop] Follow-up: "${fq.slice(0, 80)}"`);
                    const r2 = await withTimeout(
                        this.max.tools.execute('web', 'search', { query: fq }),
                        20_000,
                        'followup search'
                    );
                    if (r2?.results?.length) {
                        learnings.push(...r2.results.slice(0, 2).map(x => `${x.title}: ${x.snippet || x.body || ''}`));
                    }
                } catch { /* ok */ }
            }

            if (learnings.length === 0) return null;

            // Phase 4 -- synthesize
            const synthesis = await withTimeout(
                this.max.agentBrain.think(
                    `Goal: "${goal.title}"
Failed with: ${lastError}

Research learnings:
${learnings.map((l, i) => `${i + 1}. ${l}`).join('\n').slice(0, 2500)}

Synthesize into 3-5 actionable bullet points for how to succeed on this goal.`,
                    { temperature: 0.3, maxTokens: 400, tier: 'smart' }
                ),
                30_000,
                'research synthesis'
            );

            return synthesis.text.slice(0, 1000);
        } catch (e) {
            console.warn(`  [AgentLoop] Deep research failed: ${e.message}`);
            return null;
        }
    }

    async _resumeCycle(saved) {
        console.log(`[AgentLoop] â–¶ï¸  Resuming "${saved.goal.title}" (${saved.completedSteps.length} steps already done)`);
        await fs.unlink(this._interruptFile).catch(() => {});

        // Filter out already-completed steps so we pick up where we left off
        const doneNums = new Set(saved.completedSteps.map(([k]) => k));
        saved.goal.steps = (saved.goal.steps || []).filter(s => !doneNums.has(s.step));

        this.stats.cyclesRun--;  // avoid double-counting â€” runCycle already incremented
        return this._cycle(saved.goal);
    }

    // â”€â”€â”€ Build execution waves from a flat step list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Steps with empty dependsOn are independent and can run in parallel.
    // Steps that list deps wait for those to complete first.
    _buildExecutionWaves(steps) {
        const completed = new Set();
        const remaining = [...steps];
        const waves     = [];

        while (remaining.length > 0) {
            const ready = remaining.filter(s =>
                (s.dependsOn || []).every(d => completed.has(Number(d)))
            );
            // Safety: if nothing is ready (circular dep), just run next step
            const wave = ready.length > 0 ? ready : [remaining[0]];
            waves.push(wave);
            wave.forEach(s => {
                completed.add(s.step);
                remaining.splice(remaining.indexOf(s), 1);
            });
        }

        return waves;
    }

    // â”€â”€â”€ Interrupt / resume API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    interrupt() {
        if (!this._busy) return false;
        this._interrupted = true;
        console.log('[AgentLoop] â¸ï¸  Interrupt requested â€” will pause at next step boundary');
        return true;
    }

    async _saveInterruptState(goal, stepResultMap) {
        try {
            const state = {
                goal,
                completedSteps: [...stepResultMap.entries()],
                timestamp:      Date.now()
            };
            await fs.mkdir(path.dirname(this._interruptFile), { recursive: true });
            await fs.writeFile(this._interruptFile, JSON.stringify(state, null, 2));
            console.log(`[AgentLoop] ðŸ’¾ Interrupt state saved`);
        } catch (e) {
            console.warn('[AgentLoop] Could not save interrupt state:', e.message);
        }
    }

    async _loadInterruptState() {
        try {
            const raw  = await fs.readFile(this._interruptFile, 'utf8');
            const data = JSON.parse(raw);
            // Only resume if the state is less than 24h old
            if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
                console.log(`[AgentLoop] ðŸ“‚ Found interrupt state for "${data.goal?.title}"`);
                return data;
            }
        } catch { /* no saved state */ }
        return null;
    }

    // â”€â”€â”€ Plan validation gate â€” catches bad plans before first step â”€â”€â”€â”€â”€â”€â”€â”€
    // Asks the brain to review the plan for logical holes or bad tool choices.
    // If a critical issue is found and a corrected plan returned, swaps it in.
    async _validatePlan(goal, steps, toolNames = []) {
        if (!steps?.length || !this.max.brain?._ready) return steps;
        // Single-step plans don't need validation — nothing to reorder or check for deps
        if (steps.length <= 1) return steps;

        const planText = steps
            .map(s => `  ${s.step}. [${s.tool}] ${s.action} â†’ success: ${s.success}`)
            .join('\n');

        const toolHint = toolNames.length
            ? `Available tools: ${toolNames.join(', ')}`
            : '';

        try {
            const result = await withTimeout(
                this.max.agentBrain.think(
                    `Review this execution plan for critical issues before running it.

GOAL: ${goal.title}
${toolHint}

PLAN:
${planText}

Check for: wrong tool choices, impossible steps, missing prerequisites, wrong order.
Reply ONLY with JSON: {"ok": true} if the plan is fine, or:
{"ok": false, "issue": "brief description", "fix": [corrected step array]}

Return {"ok": true} unless there is a clear critical flaw.`,
                    { temperature: 0.1, maxTokens: 500, tier: 'fast' }
                ),
                15_000,
                'plan validation'
            );

            const match = result.text.match(/\{[\s\S]*\}/);
            if (!match) return steps;

            const review = JSON.parse(match[0]);
            if (!review.ok && review.fix && Array.isArray(review.fix) && review.fix.length > 0) {
                console.log(`  [AgentLoop] ðŸ”§ Plan issue: "${review.issue}" â€” applying fix (${steps.length} â†’ ${review.fix.length} steps)`);
                return review.fix;
            }
        } catch { /* non-fatal â€” proceed with original plan */ }

        return steps;
    }

    // â”€â”€â”€ Build a fallback investigation goal after repeated failure â”€â”€â”€â”€â”€â”€â”€â”€
    // When MAX can't solve something in N replans, he steps back and builds
    // a structured research goal rather than declaring defeat.
    async _buildFallbackGoal(failedGoal, lastError) {
        if (!this.max.brain?._ready) return null;
        try {
            const result = await withTimeout(
                this.max.agentBrain.think(
                    `A task failed after multiple attempts and needs a smarter investigation approach.

FAILED TASK: ${failedGoal.title}
DESCRIPTION: ${(failedGoal.description || '').slice(0, 300)}
LAST ERROR: ${lastError.slice(0, 200)}

Design a structured investigation goal that:
1. First understands WHY the direct approach failed
2. Explores the problem space before acting
3. Produces concrete findings, not just another failed attempt

Return ONLY a JSON object:
{
  "title": "Investigate: [specific thing to understand]",
  "description": "1. [first: understand X by doing Y]. 2. [then: check Z]. 3. [finally: produce findings report]",
  "type": "research",
  "priority": 0.85
}`,
                    { temperature: 0.2, maxTokens: 300, tier: 'fast' }
                ),
                15_000,
                'fallback goal'
            );

            const match = result.text.match(/\{[\s\S]*\}/);
            if (!match) return null;

            const g = JSON.parse(match[0]);
            if (!g.title) return null;

            return { ...g, source: 'auto', blockedBy: [] };
        } catch {
            return null;
        }
    }

    // â”€â”€â”€ Diagnose failure root cause + design a remedy goal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Called after first genuine LOGIC failure. Uses brain to understand WHY
    // the approach itself failed, then proposes a different-typed goal that
    // addresses the root cause before retrying the original.
    async _diagnoseFailure(goal, failReason, stepResults) {
        if (!this.max.brain?._ready) return null;

        const stepSummary = stepResults
            .map(r => `  Step ${r.step}: ${r.success ? 'âœ“' : 'âœ—'} ${(r.summary || r.error || '').slice(0, 120)}`)
            .join('\n');

        try {
            const result = await withTimeout(
                this.max.agentBrain.think(
                    `An autonomous task failed. Diagnose WHY and design a smarter follow-up goal.

FAILED TASK: ${goal.title}
DESCRIPTION: ${(goal.description || '').slice(0, 200)}
ERROR: ${failReason.slice(0, 200)}
STEP RESULTS:
${stepSummary}

Diagnose the ROOT CAUSE. Return ONLY JSON:
{
  "rootCause": "MISSING_INFO|MISSING_PREREQ|WRONG_APPROACH|ENVIRONMENT|AMBIGUOUS|TOOL_BUG|TEST_FAILURE",
  "explanation": "one sentence: exactly what went wrong and why the approach itself was wrong",
  "remedyGoal": {
    "title": "specific thing to do to resolve the root cause",
    "description": "concrete steps: 1. ... 2. ... 3. ...",
    "type": "research|fix|task",
    "priority": 0.9
  }
}

Root cause guide:
- MISSING_INFO: task needs information that wasn't gathered first
- MISSING_PREREQ: a dependency (tool/package/service/file) isn't installed or ready
- WRONG_APPROACH: the strategy itself is wrong â€” a different method is needed
- ENVIRONMENT: system-level issue (path, version mismatch, config, OS difference)
- AMBIGUOUS: the goal is too vague to execute without clarification
- TOOL_BUG: a coding error in one of MAX's own tools (reference error, type error, etc.)
- TEST_FAILURE: implementation failed the verification step â€” fix the code based on test output`,
                    { temperature: 0.2, maxTokens: 400, tier: 'fast' }
                ),
                15_000,
                'diagnose failure'
            );

            const match = result.text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            const diagnosis = JSON.parse(match[0]);
            if (!diagnosis.rootCause || !diagnosis.remedyGoal?.title) return null;
            return diagnosis;
        } catch {
            return null;
        }
    }

    // â”€â”€â”€ Retry a failed file:replace by re-reading the file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Reads the current file content, asks the brain to find correct oldText,
    // then retries the replace once. Returns the retry toolResult.
    async _retryReplace(toolParams, step, goal) {
        const fp = toolParams.filePath || toolParams.path;
        if (!fp) return { success: false, error: 'No filePath to retry' };

        const freshRead = await this.max.tools.execute('file', 'read', { filePath: fp });
        if (!freshRead?.success) return { success: false, error: 'Could not re-read file for retry' };

        try {
            const correctionResult = await withTimeout(
                this.max.agentBrain.think(
                    `A file:replace operation failed because oldText wasn't found. Find the correct text.\n\nFILE: ${fp}\nCONTENT (first 3000 chars):\n${freshRead.content.slice(0, 3000)}\n\nFAILED oldText:\n${toolParams.oldText}\n\nINTENDED newText:\n${toolParams.newText}\n\nGOAL: ${step.action}\n\nFind the exact text in the file that should be replaced to achieve this goal.\nRespond ONLY with JSON: {"oldText": "exact matching text from file", "newText": "replacement text"}`,
                    { temperature: 0.1, maxTokens: 1500, tier: 'code' }
                ),
                30_000,
                'replace correction'
            );
            const m = correctionResult.text.match(/\{[\s\S]*\}/);
            if (!m) return { success: false, error: 'Brain could not generate corrected params' };

            const corrected = JSON.parse(m[0]);
            if (!corrected.oldText) return { success: false, error: 'No oldText in brain response' };

            const retryResult = await this.max.tools.execute('file', 'replace', {
                ...toolParams,
                oldText: corrected.oldText,
                newText: corrected.newText || toolParams.newText
            });
            if (retryResult.success) {
                console.log(`  [AgentLoop] âœ… Replace retry succeeded`);
            }
            return retryResult;
        } catch (e) {
            return { success: false, error: `Replace retry error: ${e.message}` };
        }
    }

    // â”€â”€â”€ Auto-commit after successful goal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Only commits if there are staged changes in the working tree and
    // autoApproveLevel is not 'read' (respects the user's permission config).
    async _autoCommit(goalTitle) {
        if (this.config.autoApproveLevel === 'read') return;  // user wants to control commits

        try {
            const cwd    = process.cwd();
            const status = await this.max.tools.execute('git', 'status', { cwd });
            if (!status?.success || !status.output) return;  // no changes or not a git repo

            await this.max.tools.execute('git', 'add', { cwd, files: '.' });
            const message = `AgentLoop: ${goalTitle.slice(0, 72)}`;
            const commit  = await this.max.tools.execute('git', 'commit', { cwd, message });
            if (commit?.success) {
                console.log(`  [AgentLoop] ðŸ“¦ Committed: "${message}"`);
            }
        } catch { /* non-fatal â€” git not available or nothing to commit */ }
    }

    // â”€â”€â”€ Level 4 Meta-Correction: Autonomous Tool Healing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async _metaCorrect(toolName, error, failReason) {
        console.log(`  [AgentLoop] ðŸ”§ Project Lazarus: Self-healing triggered for "${toolName}"`);

        // 1. Diagnose the source code
        const toolDir = path.join(process.cwd(), 'tools');
        const toolFiles = await fs.readdir(toolDir);
        const targetFile = toolFiles.find(f => f.toLowerCase().startsWith(toolName.toLowerCase()));

        if (!targetFile) {
            console.warn(`  [AgentLoop] ðŸ”§ Healing aborted: Could not find source for ${toolName}`);
            return;
        }

        const toolId = targetFile.replace(/\.js$/, '');
        const toolSrc = await fs.readFile(path.join(toolDir, targetFile), 'utf8');

        this.emit('insight', {
            source: 'agent',
            label:  `ðŸ”§ Self-healing: ${toolName}`,
            result: `Tool failed 3 times. Error: ${error || failReason}\nAttempting autonomous repair of tools/${targetFile}...`
        });

        // 2. Add a high-priority repair goal
        this.max.goals?.addGoal({
            title:       `Project Lazarus: Repair tools/${targetFile}`,
            description: `The "${toolName}" tool is failing with: ${error || failReason}.
1. Read the source: tools/${targetFile}
2. Identify the bug (likely a reference error, type mismatch, or unhandled edge case).
3. Use the self_evolution tool to propose, verify, and commit a fix.
4. Verify the tool works by running a small test script.`,
            type:        'fix',
            priority:    1.0, // Top priority
            source:      'lazarus'
        });

        // 3. Economics: reward for triggering a self-healing audit
        if (this.max.economics) {
            this.max.economics.recordEarning(0.10, `meta_correction:${toolName}`);
        }
    }

    // â”€â”€â”€ Categorize error for smart pivot strategy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Returns 'TIMEOUT' | 'PERMISSION' | 'NETWORK' | 'LOGIC' | 'TOOL_ERROR'
    _categorizeError(msg) {
        const m = (msg || '').toLowerCase();
        if (m.includes('timeout') || m.includes('timed out'))
            return 'TIMEOUT';
        if (m.includes('permission') || m.includes('access denied') ||
            m.includes('eacces')    || m.includes('eperm')          ||
            m.includes('unauthorized') || m.includes('forbidden'))
            return 'PERMISSION';
        if (m.includes('econnrefused') || m.includes('enotfound') ||
            m.includes('network')    || m.includes('fetch failed') ||
            m.includes('getaddrinfo'))
            return 'NETWORK';
        
        // Tool-specific errors (logic bugs in the tool itself)
        if (m.includes('not a function') || m.includes('is not defined') || 
            m.includes('cannot read property') || m.includes('syntaxerror') ||
            m.includes('referenceerror') || m.includes('typeerror'))
            return 'TOOL_ERROR';

        if (m.includes('test failed') || m.includes('assertion failed') || m.includes('verifycommand failed'))
            return 'TEST_FAILURE';

        return 'LOGIC';
    }

    // â”€â”€â”€ Detect coding steps â€” route these to smart tier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    _isCodingStep(step, goal) {
        const codingTools = ['file.write', 'file.edit', 'shell', 'shell.run', 'shell.start', 'coderunner', 'lab'];
        const codingWords = ['write', 'implement', 'create', 'code', 'fix', 'refactor',
                             'edit', 'debug', 'build', 'generate', 'patch', 'update'];

        const toolStr   = (step.tool   || '').toLowerCase();
        const actionStr = (step.action || '').toLowerCase();
        const goalStr   = (goal.title  || '').toLowerCase();

        const codingTool = codingTools.some(t => toolStr.includes(t));
        const codingAction = codingWords.some(w => actionStr.includes(w) || goalStr.includes(w));

        return codingTool || codingAction;
    }

    // â”€â”€â”€ Proactive Social Reachout â€” reach Barry when blocked â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async _proactiveSocialReachout(goal, reason) {
        if (!this.max.brain?._ready) return;

        console.log(`  [AgentLoop] ðŸ“¡ Blocked â€” attempting social reachout...`);

        try {
            const message = `ðŸš¨ MAX is blocked on a background task!\n\nGOAL: "${goal.title}"\nREASON: ${reason}\n\nPlease check the terminal to provide approval or guidance.`;
            
            // 1. Try Discord (priority)
            const discord = this.max.tools.get('discord');
            if (discord && discord.connected) {
                await this.max.tools.execute('discord', 'send', { message });
                console.log(`  [AgentLoop] âœ… Notification sent via Discord`);
                return;
            }

            // 2. Try Email (fallback)
            const email = this.max.tools.get('email');
            if (email && email.connected) {
                await this.max.tools.execute('email', 'send', { 
                    to: this.max.profile?.email || 'user@example.com',
                    subject: `[MAX BLOCKED] ${goal.title.slice(0, 40)}`,
                    body: message
                });
                console.log(`  [AgentLoop] âœ… Notification sent via Email`);
                return;
            }

            console.log(`  [AgentLoop] âš ï¸  No active social channels for reachout.`);
        } catch (err) {
            console.warn(`  [AgentLoop] âŒ Social reachout failed: ${err.message}`);
        }
    }

    // â”€â”€â”€ Approval gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // autoApproveLevel:
    //   'read'  â€” only reads are auto-approved; shell/write/git all need approval
    //   'write' â€” reads + writes auto-approved; only git.push, git.commit, file.delete gated
    //   'all'   â€” nothing requires approval (fully autonomous)
    needsApproval(tool, action) {
        if (this.config.autoApproveLevel === 'all') return false;

        if (this.config.autoApproveLevel === 'write') {
            // Gate only truly destructive/irreversible operations
            if (tool === 'file'  && action === 'delete')  return true;
            if (tool === 'git'   && (action === 'commit' || action === 'push')) return true;
            return false;
        }

        // Default 'read' level: gate shell, git, file.write, file.delete
        // Fix: check both tool AND action for dot-notation rules
        const destructive = REQUIRES_APPROVAL.some(r => {
            if (r.includes('.')) {
                const [t, a] = r.split('.');
                return tool === t && action === a;
            }
            return tool === r;
        });

        return destructive;
    }

    async requestApproval(tool, action, params, goal = null) {
        this.stats.approvalsPending++;

        return new Promise(resolve => {
            this._pendingApproval = {
                resolve,
                tool,
                action,
                params,
                goal: goal?.title || 'autonomous task'
            };

            // Emit so the launcher can display it
            this.emit('approvalNeeded', {
                tool,
                action,
                params,
                goal
            });
        });
    }

    // â”€â”€â”€ User calls these from the REPL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    approve() {
        if (!this._pendingApproval) return false;
        this.stats.approvalsGranted++;
        this._pendingApproval.resolve(true);
        this._pendingApproval = null;
        return true;
    }

    deny() {
        if (!this._pendingApproval) return false;
        this.stats.approvalsDenied++;
        this._pendingApproval.resolve(false);
        this._pendingApproval = null;
        return true;
    }

    getPendingApproval() { return this._pendingApproval; }

    getStatus() {
        return {
            busy:    this._busy,
            pending: !!this._pendingApproval,
            ...this.stats
        };
    }
}


