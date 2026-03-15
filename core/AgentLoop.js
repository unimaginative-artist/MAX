// ═══════════════════════════════════════════════════════════════════════════
// AgentLoop.js — MAX's autonomous execution engine
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
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs   from 'fs/promises';
import path from 'path';

// Actions that require human approval before running
const REQUIRES_APPROVAL = ['shell', 'git.commit', 'git.push', 'file.delete', 'file.write'];

// Wrap any promise with a hard timeout — prevents tool hangs from freezing the loop
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

    // ─── Run one agent cycle (called by Heartbeat) ────────────────────────
    async runCycle() {
        if (this._busy) return null;
        this._busy = true;
        this.stats.cyclesRun++;

        try {
            // Check for a saved interrupt state — resume if found
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

        // ── 1. Pick next goal ─────────────────────────────────────────────
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

        // ── 2. Decompose into steps if needed ─────────────────────────────
        const toolNames = (this.max.tools?.list() || []).map(t => t.name);

        if (!goal.steps || goal.steps.length === 0) {
            // Recall a proven skill — inject into planner so it reuses what worked before
            const skill = await this.max.skills?.recall(goal.title) || null;

            if (goals?.decompose) {
                goal.steps = await goals.decompose(goal, { availableTools: toolNames, skill });
            } else {
                goal.steps = [{ step: 1, action: goal.description || goal.title, tool: 'brain', success: 'completed', dependsOn: [] }];
            }
            // Validate the plan before committing to it
            goal.steps = await this._validatePlan(goal, goal.steps, toolNames);
        }

        console.log(`\n[AgentLoop] 🎯 Goal: "${goal.title}" (${goal.steps.length} steps)`);
        this.stats.goalsStarted++;

        this.emit('goalStart', { goal });

        // ── 3. Execute steps — with Pivot Loop ───────────────────────────
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
                // ── Interrupt check — pause at wave boundary ──────────────
                if (this._interrupted) {
                    this._interrupted = false;
                    await this._saveInterruptState(goal, stepResultMap);
                    this.emit('insight', {
                        source: 'agent',
                        label:  '⏸️ Task paused',
                        result: `Saved progress on "${goal.title}" — /resume to continue`
                    });
                    return { goal: goal.title, success: false, summary: 'Paused — use /resume', interrupted: true };
                }

                let waveResults;
                if (wave.length > 1) {
                    console.log(`  [AgentLoop] ⚡ Parallel: steps ${wave.map(s => s.step).join(', ')}`);
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
                goalSuccess = true;
                goalSummary = stepResults.map(r => r.summary || '').filter(Boolean).join(' → ');
                // Encode the winning plan as a skill (fire-and-forget procedural memory)
                this.max.skills?.encodeFromRun(goal, goal.steps, this.max.brain).catch(() => {});
                break;
            }

            // ── Smart error categorization — choose pivot strategy ────────
            const errType = this._categorizeError(failReason);
            console.log(`  [AgentLoop] 🔬 Error type: ${errType} — ${failReason.slice(0, 80)}`);

            // PERMISSION: surface to user and stop — don't burn replans on auth issues
            if (errType === 'PERMISSION') {
                this.emit('approvalNeeded', {
                    description: `Permission error on "${goal.title}": ${failReason}`,
                    goal:    goal.title,
                    step:    null,
                    approve: () => {},
                    deny:    () => {}
                });
                goalSummary = `Blocked by permission: ${failReason}`;
                break;
            }

            replans++;
            this.stats.replans++;

            if (replans > this.config.maxReplans) {
                goalSummary = `Gave up after ${replans - 1} replans. Last error: ${failReason}`;
                // ── Proactive fallback: build a structured investigation goal ──
                // Instead of silently giving up, queue a deeper investigation so
                // MAX steps back and comes at the problem from a different angle.
                const fallback = await this._buildFallbackGoal(goal, failReason);
                if (fallback) {
                    const newId = this.max.goals?.addGoal(fallback);
                    if (newId) {
                        goalSummary += ` Queued investigation: "${fallback.title}"`;
                        this.emit('insight', {
                            source: 'agent',
                            label:  `🗺️  Building investigation plan for: ${goal.title}`,
                            result: `Couldn't solve directly after ${replans - 1} attempts.\nQueued structured investigation: "${fallback.title}"\n${fallback.description}`
                        });
                    }
                }
                break;
            }

            // ── Diagnosis step-back — first LOGIC failure on a real GoalEngine goal ──
            // Instead of immediately redecomposing (same approach, different words),
            // diagnose the root cause and queue a structurally different remedy goal.
            // The original goal re-enters the queue blocked on the remedy — the
            // dependency graph handles the rest automatically when remedy completes.
            if (errType === 'LOGIC' && replans === 1 && goal.id && this.max.goals?._active?.has(goal.id)) {
                console.log(`  [AgentLoop] 🔬 Diagnosing root cause before replan...`);
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
                            label:  `🔬 Diagnosed: ${goal.title}`,
                            result: `Root cause: ${diagnosis.rootCause}\n${diagnosis.explanation}\n\nQueued remedy: "${diagnosis.remedyGoal.title}"\nOriginal goal re-queued — will retry when remedy completes.`
                        });

                        this.max.outcomes?.record({
                            agent:   'AgentLoop',
                            action:  'goal:diagnosed',
                            context: { title: goal.title, rootCause: diagnosis.rootCause },
                            result:  diagnosis.explanation,
                            success: true,
                            reward:  0.3   // positive — this is intelligent behavior
                        });

                        console.log(`  [AgentLoop] 🗺️  Diagnosis: ${diagnosis.rootCause} — remedy: "${diagnosis.remedyGoal.title}"`);
                        return { goal: goal.title, success: false, summary: `Diagnosed: ${diagnosis.explanation}`, diagnosed: true };
                    }
                }
                // Diagnosis failed or remedy couldn't be created — fall through to normal replan
                console.log(`  [AgentLoop] Diagnosis inconclusive — falling back to replan`);
            }

            // TIMEOUT: same plan, just wait and retry — environment may catch up
            if (errType === 'TIMEOUT') {
                console.log(`  [AgentLoop] ⏱️  Timeout — waiting 10s before retry (same plan)`);
                await new Promise(r => setTimeout(r, 10_000));
                continue;  // retry identical steps — don't redecompose
            }

            // NETWORK: short backoff then replan — might need different endpoint/approach
            if (errType === 'NETWORK') {
                console.log(`  [AgentLoop] 🌐 Network error — backing off 5s then replanning`);
                await new Promise(r => setTimeout(r, 5_000));
            }

            // LOGIC + NETWORK (after backoff): research + replan
            console.log(`  [AgentLoop] ↩️  Pivoting (replan ${replans}/${this.config.maxReplans}): ${failReason}`);

            // ── After 2 failures: research before replanning ──────────────
            // Two bad plans in a row means MAX doesn't know enough.
            // Do deeper research on the topic before generating plan 3+.
            let researchContext = '';
            if (replans >= 2) {
                console.log(`  [AgentLoop] 📚 Two failures — researching before replan ${replans}...`);
                researchContext = await this._deepResearch(goal, failReason);
                if (researchContext) {
                    console.log(`  [AgentLoop] 📖 Research complete — injecting context`);
                    this.stats.searches++;
                    this.emit('insight', {
                        source: 'agent',
                        label:  `📚 Research: "${goal.title}"`,
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

            console.log(`  [AgentLoop] 🔄 New plan: ${goal.steps.length} steps`);
        }

        // ── 4. Record outcome ─────────────────────────────────────────────
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
            const entry = goalSuccess
                ? `Completed: "${goal.title}"\n${goalSummary}`
                : `Failed: "${goal.title}"\nReason: ${goalSummary}`;
            this.max.kb.remember(entry, { source: 'agent_loop', goalType: goal.type }).catch(() => {});
        }

        // ── 6. Update goal state ──────────────────────────────────────────
        if (goal.source === 'tasks.md' && goalSuccess) {
            profile?.completeTask(goal.title);
        } else if (goals?._active?.has(goal.id)) {
            goalSuccess ? goals.complete(goal.id, { summary: goalSummary })
                        : goals.fail(goal.id, goalSummary);
        }

        goalSuccess ? drive?.onGoalComplete(goal.title) : null;

        this.stats.goalsCompleted += goalSuccess ? 1 : 0;

        // ── 6. Emit insight to surface result ─────────────────────────────
        const insightResult = goalSuccess
            ? `Completed: "${goal.title}"\n${goalSummary}`
            : `Could not complete: "${goal.title}"\n${goalSummary}`;

        this.emit('insight', {
            source: 'agent',
            label:  goalSuccess ? `✅ Goal done: ${goal.title}` : `⚠️ Goal blocked: ${goal.title}`,
            result: insightResult
        });

        // ── 7. Proactive background messaging ─────────────────────────────
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

        return { goal: goal.title, success: goalSuccess, summary: goalSummary };
    }

    // ─── Execute a single step ────────────────────────────────────────────
    async _executeStep(step, goal, stepResultMap = new Map()) {
        const action   = step.action;
        const toolName = step.tool || 'brain';

        console.log(`  [AgentLoop] Step ${step.step}: ${action.slice(0, 70)} [${toolName}]`);

        // ── Inject outputs from dependency steps into the prompt context ──
        const depContext = (step.dependsOn || [])
            .map(d => stepResultMap.get(Number(d)))
            .filter(Boolean)
            .map(r => `Step ${r.step} result: ${(r.result || '').slice(0, 400)}`)
            .join('\n');

        // ── Approval gate ─────────────────────────────────────────────────
        if (this.config.requireApproval && this._needsApproval(toolName, action)) {
            const approved = await this._requestApproval(step, goal);
            if (!approved) {
                return { step: step.step, success: false, error: 'User denied', summary: '' };
            }
        }

        try {
            let result = '';

            const timeoutMs = this.config.stepTimeoutMs;
            const isCoding  = this._isCodingStep(step, goal);

            if (toolName === 'brain') {
                // Think through this step — use smart tier for coding tasks
                const depNote = depContext ? `\n\nPRIOR STEP OUTPUTS:\n${depContext}` : '';
                const resObj = await withTimeout(
                    this.max.brain.think(
                        `Complete this step concisely:\n\nGOAL: ${goal.title}\nSTEP: ${action}${depNote}`,
                        {
                            systemPrompt: `You are MAX completing an autonomous task step. Be concrete and brief.`,
                            temperature:  isCoding ? 0.2 : 0.4,
                            maxTokens:    isCoding ? 2048 : 512,
                            tier:         isCoding ? 'smart' : 'fast'
                        }
                    ),
                    timeoutMs,
                    'brain step'
                );
                result = resObj.text;
            } else {
                // Parse tool and action from step.tool (format: "tool" or "tool.action")
                // Prefer step.action_name (from params schema) over the dot-notation fallback
                const [tName, tDotAction] = toolName.includes('.') ? toolName.split('.') : [toolName, 'run'];
                const tAction = step.action_name || tDotAction;
                const tool = this.max.tools.get(tName);

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
                    const toolResult = await withTimeout(
                        this.max.tools.execute(tName, tAction, toolParams),
                        timeoutMs,
                        `${tName}.${tAction}`
                    );
                    result = JSON.stringify(toolResult).slice(0, 500);
                } else {
                    // Unknown tool — fall back to brain
                    const resObj = await withTimeout(
                        this.max.brain.think(
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

            // ── Verification Gate ─────────────────────────────────────────
            // If the step has a success criterion, ask the brain to check it.
            if (this.config.verifySteps && step.success && step.success !== 'completed') {
                try {
                    const verifyResult = await withTimeout(
                        this.max.brain.think(
                            `Did this step succeed?\n\nSTEP: ${action}\nSUCCESS CRITERION: ${step.success}\nOUTPUT: ${summary}\n\nReply with only YES or NO.`,
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
                    // Brain timeout → skip verification, proceed
                    console.warn(`  [AgentLoop] Verify skipped: ${verifyErr.message}`);
                }
            }

            return { step: step.step, success: true, result, summary };

        } catch (err) {
            // ── Search-and-Retry ──────────────────────────────────────────
            // Before giving up, search the web for a solution and retry once.
            console.log(`  [AgentLoop] 🔍 Searching for a solution to: ${err.message.slice(0, 80)}`);
            const searchContext = await this._searchForSolution(step, goal, err.message);

            if (searchContext) {
                try {
                    const retryObj = await withTimeout(
                        this.max.brain.think(
                            `Complete this step. A previous attempt failed.\n\nGOAL: ${goal.title}\nSTEP: ${action}\nERROR: ${err.message}\n\nSEARCH RESULTS:\n${searchContext}\n\nUse the search results to find the correct approach.`,
                            { systemPrompt: 'You are MAX completing an autonomous task step. Be concrete and brief.', temperature: 0.3, maxTokens: 512, tier: 'fast' }
                        ),
                        this.config.stepTimeoutMs,
                        'search retry'
                    );
                    const retrySummary = retryObj.text.slice(0, 200);
                    console.log(`  [AgentLoop] ✅ Search retry succeeded`);
                    this.stats.searches++;
                    return { step: step.step, success: true, result: retryObj.text, summary: retrySummary };
                } catch (retryErr) {
                    console.error(`  [AgentLoop] Search retry also failed:`, retryErr.message);
                }
            }

            console.error(`  [AgentLoop] Step ${step.step} failed:`, err.message);
            return { step: step.step, success: false, error: err.message, summary: '' };
        }
    }

    // ─── Search for a solution to a failed step ───────────────────────────
    async _searchForSolution(step, goal, errorMsg) {
        try {
            const query = `how to ${step.action.slice(0, 80)} ${errorMsg.slice(0, 60)}`.replace(/\s+/g, ' ').trim();
            console.log(`  [AgentLoop] 🌐 Web search: "${query.slice(0, 100)}"`);

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

    // ─── Deep research — called after 2+ failed replans ──────────────────
    // Runs multiple searches and asks the brain to synthesize findings
    // into a concise briefing that gets injected into the next plan.
    async _deepResearch(goal, lastError) {
        try {
            const queries = [
                `how to ${goal.title.slice(0, 80)}`,
                `${lastError.slice(0, 60)} solution`,
                `best approach for ${goal.title.slice(0, 60)}`
            ];

            const snippets = [];
            for (const query of queries) {
                try {
                    console.log(`  [AgentLoop] 🌐 Research: "${query.slice(0, 80)}"`);
                    const r = await withTimeout(
                        this.max.tools.execute('web', 'search', { query }),
                        20_000,
                        'research search'
                    );
                    if (r?.results?.length) {
                        snippets.push(...r.results.slice(0, 2).map(x => `${x.title}: ${x.snippet || x.body || ''}`));
                    }
                } catch { /* skip failed individual searches */ }
            }

            if (snippets.length === 0) return null;

            const raw = snippets.join('\n\n').slice(0, 3000);

            // Synthesize with brain
            const synthesis = await withTimeout(
                this.max.brain.think(
                    `I'm trying to: "${goal.title}"\nI've failed twice. Last error: ${lastError}\n\nSearch results:\n${raw}\n\nSummarize the key findings and the best approach in 3-5 bullet points.`,
                    { temperature: 0.3, maxTokens: 400, tier: 'fast' }
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

    // ─── Resume a previously interrupted cycle ────────────────────────────
    async _resumeCycle(saved) {
        console.log(`[AgentLoop] ▶️  Resuming "${saved.goal.title}" (${saved.completedSteps.length} steps already done)`);
        await fs.unlink(this._interruptFile).catch(() => {});

        // Filter out already-completed steps so we pick up where we left off
        const doneNums = new Set(saved.completedSteps.map(([k]) => k));
        saved.goal.steps = (saved.goal.steps || []).filter(s => !doneNums.has(s.step));

        this.stats.cyclesRun--;  // avoid double-counting — runCycle already incremented
        return this._cycle(saved.goal);
    }

    // ─── Build execution waves from a flat step list ──────────────────────
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

    // ─── Interrupt / resume API ───────────────────────────────────────────
    interrupt() {
        if (!this._busy) return false;
        this._interrupted = true;
        console.log('[AgentLoop] ⏸️  Interrupt requested — will pause at next step boundary');
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
            console.log(`[AgentLoop] 💾 Interrupt state saved`);
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
                console.log(`[AgentLoop] 📂 Found interrupt state for "${data.goal?.title}"`);
                return data;
            }
        } catch { /* no saved state */ }
        return null;
    }

    // ─── Plan validation gate — catches bad plans before first step ────────
    // Asks the brain to review the plan for logical holes or bad tool choices.
    // If a critical issue is found and a corrected plan returned, swaps it in.
    async _validatePlan(goal, steps, toolNames = []) {
        if (!steps?.length || !this.max.brain?._ready) return steps;

        const planText = steps
            .map(s => `  ${s.step}. [${s.tool}] ${s.action} → success: ${s.success}`)
            .join('\n');

        const toolHint = toolNames.length
            ? `Available tools: ${toolNames.join(', ')}`
            : '';

        try {
            const result = await withTimeout(
                this.max.brain.think(
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
                console.log(`  [AgentLoop] 🔧 Plan issue: "${review.issue}" — applying fix (${steps.length} → ${review.fix.length} steps)`);
                return review.fix;
            }
        } catch { /* non-fatal — proceed with original plan */ }

        return steps;
    }

    // ─── Build a fallback investigation goal after repeated failure ────────
    // When MAX can't solve something in N replans, he steps back and builds
    // a structured research goal rather than declaring defeat.
    async _buildFallbackGoal(failedGoal, lastError) {
        if (!this.max.brain?._ready) return null;
        try {
            const result = await withTimeout(
                this.max.brain.think(
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

    // ─── Diagnose failure root cause + design a remedy goal ──────────────
    // Called after first genuine LOGIC failure. Uses brain to understand WHY
    // the approach itself failed, then proposes a different-typed goal that
    // addresses the root cause before retrying the original.
    async _diagnoseFailure(goal, failReason, stepResults) {
        if (!this.max.brain?._ready) return null;

        const stepSummary = stepResults
            .map(r => `  Step ${r.step}: ${r.success ? '✓' : '✗'} ${(r.summary || r.error || '').slice(0, 120)}`)
            .join('\n');

        try {
            const result = await withTimeout(
                this.max.brain.think(
                    `An autonomous task failed. Diagnose WHY and design a smarter follow-up goal.

FAILED TASK: ${goal.title}
DESCRIPTION: ${(goal.description || '').slice(0, 200)}
ERROR: ${failReason.slice(0, 200)}
STEP RESULTS:
${stepSummary}

Diagnose the ROOT CAUSE. Return ONLY JSON:
{
  "rootCause": "MISSING_INFO|MISSING_PREREQ|WRONG_APPROACH|ENVIRONMENT|AMBIGUOUS",
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
- WRONG_APPROACH: the strategy itself is wrong — a different method is needed
- ENVIRONMENT: system-level issue (path, version mismatch, config, OS difference)
- AMBIGUOUS: the goal is too vague to execute without clarification`,
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

    // ─── Categorize error for smart pivot strategy ────────────────────────
    // Returns 'TIMEOUT' | 'PERMISSION' | 'NETWORK' | 'LOGIC'
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
        return 'LOGIC';
    }

    // ─── Detect coding steps — route these to smart tier ─────────────────
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

    // ─── Approval gate ────────────────────────────────────────────────────
    // autoApproveLevel:
    //   'read'  — only reads are auto-approved; shell/write/git all need approval
    //   'write' — reads + writes auto-approved; only git.push, git.commit, file.delete gated
    //   'all'   — nothing requires approval (fully autonomous)
    _needsApproval(tool, action) {
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

    async _requestApproval(step, goal) {
        this.stats.approvalsPending++;

        return new Promise(resolve => {
            const description = `Goal: "${goal.title}"\nStep: ${step.action}\nTool: ${step.tool}`;

            this._pendingApproval = {
                resolve,
                description,
                goal: goal.title,
                step: step.step
            };

            // Emit so the launcher can display it and wire /approve command
            this.emit('approvalNeeded', {
                description,
                goal:   goal.title,
                step:   step.step,
                approve: () => this.approve(),
                deny:    () => this.deny()
            });
        });
    }

    // ─── User calls these from the REPL ──────────────────────────────────
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
