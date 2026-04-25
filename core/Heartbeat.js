// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Heartbeat.js â€” MAX's autonomous pulse
// Runs background cycles: curiosity tasks, self-monitoring, goal execution
// Simplified from SOMA AutonomousHeartbeat â€” no SOMA framework deps
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import { EventEmitter } from 'events';

export class Heartbeat extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;

        this.config = {
            minIntervalMs:         15 * 1000,      // 15s (Sustainable fast)
            maxIntervalMs:         120 * 1000,     // 120s (Idle)
            momentumWindowMs:      2 * 60 * 1000,  // 2m window to stay fast
            maxConsecutiveFailures: 5,
            enabled:               false,
            ...config
        };

        this._timer    = null;
        this._running  = false;
        this._busy     = false;
        this._failures = 0;
        this._lastSuccessAt = 0;

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
        this._lastSuccessAt = 0;
        this._schedule();
        console.log(`[Heartbeat] ðŸ’“ Started (Tension-Scaling: ${this.config.minIntervalMs/1000}sâ€“${this.config.maxIntervalMs/1000}s)`);
        this.emit('started');
    }

    _schedule() {
        if (!this._running) return;

        const drive = this.max?.drive?.getStatus?.();
        const tension = drive?.tension || 0;

        // Base tension scaling
        let interval = this.config.maxIntervalMs - (tension * (this.config.maxIntervalMs - this.config.minIntervalMs));

        // Momentum factor: stay fast after success
        const timeSinceSuccess = Date.now() - this._lastSuccessAt;
        if (timeSinceSuccess < this.config.momentumWindowMs) {
            interval = Math.min(interval, 10 * 1000);
        }

        // Work-pending factor: speed up if goals are waiting
        const hasPendingGoals = this.max?.goals?.getNext(this.max?.drive) != null;
        if (hasPendingGoals) {
            interval = Math.min(interval, 15 * 1000);
        }

        this._timer = setTimeout(() => this._tick().catch(err => console.error('[Heartbeat] tick error:', err.message)), interval);
    }

    async _tick() {
        if (this._busy) { this._schedule(); return; }
        this._busy = true;
        this.stats.cycles++;
        this.stats.lastRun = new Date().toISOString();

        try {
            const executed = await this._runCycle();
            if (executed) {
                this._lastSuccessAt = Date.now();
                this._failures = 0;
            }
        } catch (err) {
            this._failures++;
            this.stats.failures++;
            console.error(`[Heartbeat] âŒ Cycle error (${this._failures}/${this.config.maxConsecutiveFailures}):`, err.message);

            if (this._failures >= this.config.maxConsecutiveFailures) {
                this.stop();
                return;
            }
        } finally {
            this._busy = false;
            this._schedule();
        }
    }

    async _runCycle() {
        if (this.max?._chatBusy) {
            return false;
        }

        const drive = this.max?.drive;
        drive?.onIdleTick();
        const driveStatus = drive?.getStatus?.();

        // â”€â”€ AgentLoop: run when tension is high OR goals are waiting â”€â”€â”€â”€â”€
        const tensionHigh     = driveStatus && driveStatus.tension > 0.4;
        const hasPendingGoals = this.max?.goals?.getNext(this.max?.drive) != null;

        if ((tensionHigh || hasPendingGoals) && this.max?.agentLoop) {
            console.log(`[Heartbeat] âš¡ ${hasPendingGoals ? 'Goals pending' : `Tension ${(driveStatus.tension * 100).toFixed(0)}%`} â€” running AgentLoop`);
            try {
                const result = await this.max.agentLoop.runCycle();
                if (result) {
                    this.stats.tasksExecuted++;
                    this.stats.lastTask = `goal:${result.goal}`;
                    return true;
                }
            } catch (err) {
                console.error('[Heartbeat] AgentLoop error:', err.message);
            }
        }

        // â”€â”€ Otherwise run a curiosity task â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const curiosityTask = this.max?.curiosity?.getNextTask?.();

        if (curiosityTask) {
            console.log(`[Heartbeat] ðŸ” Curiosity task: ${curiosityTask.label}`);
            this.stats.lastTask = curiosityTask.label;
            this.stats.tasksExecuted++;

            // NOTE: Intentionally NOT calling drive.onTaskExecuted() for curiosity.
            // Curiosity is background enrichment, not primary goal work. 
            // We want tension to build until a real Goal is executed.
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
                        label:  `ðŸ” Explored: ${curiosityTask.label}`,
                        result: typeof result === 'string' ? result : JSON.stringify(result)
                    });

                    // Curiosity â†’ Goal pipeline
                    if (this.max?.goals && this.max.curiosity?.signalsGoal?.(result)) {
                        const goalTitle = `Investigate: ${curiosityTask.label}`;
                        const alreadyQueued = this.max.goals.listActive()
                            .some(g => g.title.toLowerCase().includes(curiosityTask.label.toLowerCase().slice(0, 25)));
                        if (!alreadyQueued) {
                            this.max.goals.addGoal({
                                title:       goalTitle,
                                description: `Curiosity surfaced: ${result.slice(0, 200)}`,
                                type:        'research',
                                priority:    0.55,
                                source:      'curiosity'
                            });
                            console.log(`[Heartbeat] ðŸŽ¯ Curiosity â†’ goal: "${goalTitle}"`);
                        }
                    }
                    return true;
                } catch (err) {
                    console.error('[Heartbeat] Brain error during curiosity task:', err.message);
                }
            }
        } else {
            this.emit('idle');

            // Goal generation & background cycles
            if (this.max?.goals) {
                const hasGoals = this.max.goals.getNext() != null;
                if (!hasGoals || Math.random() < 0.20) {
                    this.max.goals.generateGoals({
                        profileContext: this.max.profile?.buildContextBlock()
                    }).catch(() => {});
                }
            }

            if (Math.random() < 0.15) {
                this._proactiveSurface().catch(() => {});
            }

            if (this.max?.reflection && Math.random() < 0.05) {
                this.max.reflection.dream(this.max.kb).catch(() => {});
            }

            if (this.max?.soma?.available && this.max?.goals && Math.random() < 0.20) {
                this.max.soma.syncCuriosityGoals(this.max.goals).catch(() => {});
            }
        }
        return false;
    }

    // â”€â”€â”€ Proactive surfacing â€” volunteer important signals during idle â”€â”€â”€â”€â”€
    async _proactiveSurface() {
        const insights = [];

        // 1. Stale goals â€” goals that haven't been touched in 7+ days
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
                insights.push(`Low action success rate: ${(rate * 100).toFixed(0)}% across ${stats.total} tracked actions â€” consider /reflect`);
            }
        }

        // 4. Memory size growing large
        const memStats = this.max.memory?.getStats?.();
        if (memStats && memStats.totalMemories > 500) {
            insights.push(`Memory at ${memStats.totalMemories} entries â€” run /reflect to consolidate`);
        }

        if (insights.length === 0) return;

        this.emit('insight', {
            source: 'proactive',
            label:  'ðŸ“Š Things worth your attention',
            result: 'â€¢ ' + insights.join('\nâ€¢ ')
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

