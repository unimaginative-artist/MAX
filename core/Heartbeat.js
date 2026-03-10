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

        // ── AgentLoop gets priority when tension is high ──────────────────
        // Tension above 40% = MAX is feeling the urge to DO something
        const tensionHigh = driveStatus && driveStatus.tension > 0.4;

        if (tensionHigh && this.max?.agentLoop) {
            console.log(`[Heartbeat] ⚡ Tension ${(driveStatus.tension * 100).toFixed(0)}% — running AgentLoop`);
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

            drive?.onTaskExecuted();
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
                } catch (err) {
                    console.error('[Heartbeat] Brain error during curiosity task:', err.message);
                }
            }
        } else {
            drive?.onIdleTick();
            this.emit('idle');

            // ── Proactive surfacing (~15% of idle ticks) ──
            if (Math.random() < 0.15) {
                this._proactiveSurface().catch(() => {});
            }

            // ── Occasional Dreaming (~5% of idle ticks) ──
            if (this.max?.reflection && Math.random() < 0.05) {
                this.max.reflection.dream(this.max.kb).catch(() => {});
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
