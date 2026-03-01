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

export class AgentLoop extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max    = max;
        this.config = {
            maxStepsPerGoal:  config.maxStepsPerGoal  || 6,
            stepTimeoutMs:    config.stepTimeoutMs    || 60_000,
            requireApproval:  config.requireApproval  ?? true,   // gate destructive actions
            autoApproveLevel: config.autoApproveLevel || 'read', // 'read'|'write'|'all'
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

        // ── 3. Execute steps ──────────────────────────────────────────────
        const stepResults = [];
        let   goalSuccess = true;
        let   goalSummary = '';

        for (const step of goal.steps.slice(0, this.config.maxStepsPerGoal)) {
            const result = await this._executeStep(step, goal);
            stepResults.push(result);

            if (!result.success) {
                goalSuccess = false;
                goalSummary = `Failed at step ${step.step}: ${result.error}`;
                break;
            }

            drive?.onTaskExecuted();
            this.stats.stepsExecuted++;
        }

        if (goalSuccess) {
            goalSummary = stepResults.map(r => r.summary || '').filter(Boolean).join(' → ');
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

            if (toolName === 'brain') {
                // Think through this step
                result = await this.max.brain.think(
                    `Complete this step concisely:\n\nGOAL: ${goal.title}\nSTEP: ${action}`,
                    {
                        systemPrompt: `You are MAX completing an autonomous task step. Be concrete and brief.`,
                        temperature:  0.4,
                        maxTokens:    512,
                        tier:         'fast'
                    }
                );
            } else {
                // Parse tool and action from step.tool (format: "tool" or "tool.action")
                const [tName, tAction] = toolName.includes('.') ? toolName.split('.') : [toolName, 'run'];
                const tool = this.max.tools.get(tName);

                if (tool) {
                    const toolResult = await this.max.tools.execute(tName, tAction, {
                        command:  action,  // for shell
                        filePath: step.path || step.file,
                        content:  step.content,
                        query:    action,  // for web
                        cwd:      process.cwd()
                    });
                    result = JSON.stringify(toolResult).slice(0, 500);
                } else {
                    // Unknown tool — fall back to brain
                    result = await this.max.brain.think(
                        `Complete this step: ${action}`,
                        { temperature: 0.4, maxTokens: 512, tier: 'fast' }
                    );
                }
            }

            const summary = typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200);
            return { step: step.step, success: true, result, summary };

        } catch (err) {
            console.error(`  [AgentLoop] Step ${step.step} error:`, err.message);
            return { step: step.step, success: false, error: err.message, summary: '' };
        }
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
