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
        this._timer = setTimeout(() => this._tick(), this.config.intervalMs);
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
                    const result = await this.max.brain.think(curiosityTask.prompt, {
                        systemPrompt: 'You are MAX, an autonomous AI agent. Think concisely and return useful insights.',
                        maxTokens: 512,
                        tier: 'fast'
                    });
                    this.max?.memory?.remember?.(
                        JSON.stringify({ task: curiosityTask.label, result, ts: Date.now() }),
                        { type: 'curiosity' },
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
        }
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
