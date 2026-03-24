// ═══════════════════════════════════════════════════════════════════════════
// Heartbeat.js — MAX's autonomous pulse
// Runs background cycles: curiosity tasks, self-monitoring, goal execution
// Simplified from SOMA AutonomousHeartbeat — no SOMA framework deps
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

export class Heartbeat extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;   // reference to MAX instance

        this.config = {
            intervalMs:            2 * 60 * 1000,  // 2 min default
            maxConsecutiveFailures: 5,
            enabled:               false,
            ...config
        };

        this._timer    = null;
        this._running  = false;
        this._busy     = false;
        this._failures = 0;

        this.stats = {
            cycles:        0,
            tasksExecuted: 0,
            failures:      0,
            lastRun:       null,
            lastTask:      null
        };
    }

    start() {
        if (this._running) return;
        this._running = true;
        this.config.enabled = true;
        this._schedule();
        console.log(`[Heartbeat] 💓 Started — interval ${this.config.intervalMs / 1000}s`);
        this.emit('started');
    }

    stop() {
        if (this._timer) clearTimeout(this._timer);
        this._running = false;
        this.config.enabled = false;
        console.log('[Heartbeat] 💔 Stopped');
        this.emit('stopped');
    }

    _schedule() {
        if (!this._running) return;

        // Dynamic interval based on drive tension
        // 100% tension = 30s pulse
        // 0% tension = 5m pulse
        const drive = this.max?.drive?.getStatus?.();
        const tension = drive?.tension || 0;

        const minInterval = 30 * 1000;
        const maxInterval = 5 * 60 * 1000;
        const interval = maxInterval - (tension * (maxInterval - minInterval));

        this._timer = setTimeout(() => this._tick().catch(err => console.error('[Heartbeat] tick error:', err.message)), interval);
    }

    async _tick() {
        if (this._busy) { this._schedule(); return; }
        this._busy = true;
        this.stats.cycles++;
        this.stats.lastRun = new Date().toISOString();

        try {
            await this._runCycle();
            this._failures = 0;
        } catch (err) {
            this._failures++;
            this.stats.failures++;
            console.error(`[Heartbeat] ❌ Cycle error (${this._failures}/${this.config.maxConsecutiveFailures}):`, err.message);

            if (this._failures >= this.config.maxConsecutiveFailures) {
                console.error('[Heartbeat] Too many failures — stopping');
                this.stop();
                return;
            }
        } finally {
            this._busy = false;
            this._schedule();
        }
    }

    async _runCycle() {
        // ── Don't compete with active chat for the brain ──────────────────
        // If the user is mid-conversation, skip this background cycle entirely.
        // Prevents AgentLoop brain calls from timing out and interrupting input.
        if (this.max?._chatBusy) {
            console.log(`[Heartbeat] 💬 Chat active — skipping background cycle`);
            return;
        }

        const drive = this.max?.drive;
        const driveStatus = drive?.getStatus?.();

        // ── AgentLoop: run when tension is high OR goals are waiting ─────
        // Tension > 40% = urgency signal. Pending goals = always worth running.
        const tensionHigh     = driveStatus && driveStatus.tension > 0.4;
        const hasPendingGoals = this.max?.goals?.getNext(this.max?.drive) != null;

        if ((tensionHigh || hasPendingGoals) && this.max?.agentLoop) {
            console.log(`[Heartbeat] ⚡ ${hasPendingGoals ? 'Goals pending' : `Tension ${(driveStatus.tension * 100).toFixed(0)}%`} — running AgentLoop`);
            try {
                const result = await this.max.agentLoop.runCycle();
                if (result) {
                    this.stats.tasksExecuted++;
                    this.stats.lastTask = `goal:${result.goal}`;
                }
            } catch (err) {
                console.error('[Heartbeat] AgentLoop error:', err.message);
            }
            return; // AgentLoop ran — skip curiosity this tick
        }

        // ── Otherwise run a curiosity task ────────────────────────────────
        const curiosityTask = this.max?.curiosity?.getNextTask?.();

        if (curiosityTask) {
            console.log(`[Heartbeat] 🔍 Curiosity task: ${curiosityTask.label}`);
            this.stats.lastTask = curiosityTask.label;
            this.stats.tasksExecuted++;

            // NOTE: intentionally NOT calling drive.onTaskExecuted() here.
            // Curiosity is background enrichment, not real work. If we reset
            // tension on every curiosity tick it never reaches 40% and AgentLoop
            // never fires. Tension should only drop when AgentLoop does real work.
            this.emit('task', curiosityTask);

            if (this.max?.brain?._ready && curiosityTask.prompt) {
                try {
                    const resultObj = await this.max.brain.think(curiosityTask.prompt, {
                        systemPrompt: 'You are MAX, an autonomous AI agent. Think concisely and return useful insights.',
                        maxTokens: 512,
                        tier: 'fast'
                    });
                    const result = resultObj.text;
                    await this.max?.memory?.remember?.(
                        `Curiosity: "${curiosityTask.label}": ${result.slice(0, 200)}`,
                        {},
                        { type: 'curiosity', importance: 0.5 }
                    );
                    this.emit('insight', {
                        source: 'curiosity',
                        label:  `🔍 Explored: ${curiosityTask.label}`,
                        result: typeof result === 'string' ? result : JSON.stringify(result)
                    });

                    // ── Curiosity → Goal pipeline ─────────────────────────
                    // If the insight surfaces something actionable, convert it
                    // to a GoalEngine goal so MAX actively investigates it.
                    if (this.max?.goals && this.max.curiosity?.signalsGoal?.(result)) {
                        const goalTitle = `Investigate: ${curiosityTask.label}`;
                        const alreadyQueued = this.max.goals.listActive()
                            .some(g => g.title.toLowerCase().includes(
                                curiosityTask.label.toLowerCase().slice(0, 25)
                            ));
                        if (!alreadyQueued) {
                            this.max.goals.addGoal({
                                title:       goalTitle,
                                description: `Curiosity surfaced this: ${result.slice(0, 200)}`,
                                type:        'research',
                                priority:    0.55,
                                source:      'curiosity'
                            });
                            console.log(`[Heartbeat] 🎯 Curiosity → goal: "${goalTitle}"`);
                        }
                    }

                } catch (err) {
                    console.error('[Heartbeat] Brain error during curiosity task:', err.message);
                }
            }
        } else {
            drive?.onIdleTick();
            this.emit('idle');

            // ── Auto-generate goals — always if queue is empty, else 20% chance ──
            // Old: 10% random chance on idle only = goals almost never generated.
            // New: guaranteed generation when queue is empty so MAX always has work.
            if (this.max?.goals) {
                const hasGoals = this.max.goals.getNext() != null;
                if (!hasGoals || Math.random() < 0.20) {
                    this.max.goals.generateGoals({
                        profileContext: this.max.profile?.buildContextBlock()
                    }).catch(() => {});
                }
            }

            // ── Proactive surfacing (~15% of idle ticks) ──
            if (Math.random() < 0.15) {
                this._proactiveSurface().catch(() => {});
            }

            // ── Occasional Dreaming (~5% of idle ticks) ──
            if (this.max?.reflection && Math.random() < 0.05) {
                this.max.reflection.dream(this.max.kb).catch(() => {});
            }

            // ── SOMA curiosity goal sync (~20% of idle ticks) ─────────────
            // Pull curiosity goals SOMA generated and inject them as MAX goals.
            // This is how SOMA steers MAX's exploration during idle time.
            if (this.max?.soma?.available && this.max?.goals && Math.random() < 0.20) {
                this.max.soma.syncCuriosityGoals(this.max.goals).catch(() => {});
            }
        }
    }

    // ─── Proactive surfacing — volunteer important signals during idle ─────
    async _proactiveSurface() {
        const insights = [];

        // 1. Stale goals — goals that haven't been touched in 7+ days
        const goals  = this.max.goals?.listActive() || [];
        const staleMs = 7 * 24 * 60 * 60 * 1000;
        const stale  = goals.filter(g => Date.now() - (g.updatedAt || g.createdAt) > staleMs);
        if (stale.length > 0) {
            insights.push(`${stale.length} goal(s) stale >7 days: ${stale.slice(0, 3).map(g => `"${g.title}"`).join(', ')}`);
        }

        // 2. Goals created but never attempted
        const unstarted = goals.filter(g => {
            const daysOld = (Date.now() - g.createdAt) / (24 * 60 * 60 * 1000);
            return daysOld > 3 && (g.attempts || 0) === 0 && g.status === 'pending';
        });
        if (unstarted.length > 0) {
            insights.push(`${unstarted.length} goal(s) queued 3+ days but never attempted`);
        }

        // 3. High failure rate in recent outcomes
        const stats = this.max.outcomes?.getStats?.();
        if (stats && stats.total >= 10) {
            const rate = stats.success / stats.total;
            if (rate < 0.4) {
                insights.push(`Low action success rate: ${(rate * 100).toFixed(0)}% across ${stats.total} tracked actions — consider /reflect`);
            }
        }

        // 4. Memory size growing large
        const memStats = this.max.memory?.getStats?.();
        if (memStats && memStats.totalMemories > 500) {
            insights.push(`Memory at ${memStats.totalMemories} entries — run /reflect to consolidate`);
        }

        if (insights.length === 0) return;

        this.emit('insight', {
            source: 'proactive',
            label:  '📊 Things worth your attention',
            result: '• ' + insights.join('\n• ')
        });
    }

    getStatus() {
        return {
            running:   this._running,
            busy:      this._busy,
            failures:  this._failures,
            ...this.stats
        };
    }
}
