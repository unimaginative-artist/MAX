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

        this._running        = false;
        this._busy           = false;
        this._pendingApproval = null;  // { resolve, reject, description }

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
            const result = await this._cycle();
            return result;
        } catch (err) {
            console.error('[AgentLoop] Cycle error:', err.message);
            return null;
        } finally {
            this._busy = false;
        }
    }

    async _cycle() {
        const goals   = this.max.goals;
        const profile = this.max.profile;
        const drive   = this.max.drive;

        // ── 1. Pick next goal ─────────────────────────────────────────────
        // Priority: GoalEngine goals > tasks.md active tasks > curiosity
        let goal = goals?.getNext(drive);

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
        if (!goal.steps || goal.steps.length === 0) {
            if (goals?.decompose) {
                goal.steps = await goals.decompose(goal);
            } else {
                goal.steps = [{ step: 1, action: goal.description || goal.title, tool: 'brain', success: 'completed' }];
            }
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
            let failed = false;
            let failReason = '';

            for (const step of goal.steps.slice(0, this.config.maxStepsPerGoal)) {
                const result = await this._executeStep(step, goal);
                stepResults.push(result);

                if (!result.success) {
                    failed = true;
                    failReason = `Step ${step.step} failed: ${result.error}`;
                    break;
                }

                drive?.onTaskExecuted();
                this.stats.stepsExecuted++;
            }

            if (!failed) {
                goalSuccess = true;
                goalSummary = stepResults.map(r => r.summary || '').filter(Boolean).join(' → ');
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
                break;
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
            goal.steps = goals?.decompose
                ? await goals.decompose(goal)
                : [{ step: 1, action: goal.description, tool: 'brain', success: 'completed' }];

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

        // ── 5. Update goal state ──────────────────────────────────────────
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
    async _executeStep(step, goal) {
        const action   = step.action;
        const toolName = step.tool || 'brain';

        console.log(`  [AgentLoop] Step ${step.step}: ${action.slice(0, 70)} [${toolName}]`);

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
                const resObj = await withTimeout(
                    this.max.brain.think(
                        `Complete this step concisely:\n\nGOAL: ${goal.title}\nSTEP: ${action}`,
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
                const [tName, tAction] = toolName.includes('.') ? toolName.split('.') : [toolName, 'run'];
                const tool = this.max.tools.get(tName);

                if (tool) {
                    const toolResult = await withTimeout(
                        this.max.tools.execute(tName, tAction, {
                            command:  action,  // for shell
                            filePath: step.path || step.file,
                            content:  step.content,
                            query:    action,  // for web
                            cwd:      process.cwd()
                        }),
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
        const codingTools = ['file.write', 'file.edit', 'shell', 'coderunner', 'lab'];
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
    _needsApproval(tool, action) {
        if (this.config.autoApproveLevel === 'all') return false;
        if (this.config.autoApproveLevel === 'write' && tool === 'file' && action.includes('read')) return false;

        const destructive = REQUIRES_APPROVAL.some(r => {
            if (r.includes('.')) {
                const [t, a] = r.split('.');
                return tool === t;
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
