// ═══════════════════════════════════════════════════════════════════════════
// Scheduler.js — MAX's cron-style job runner
// Jobs run on a schedule: every Xm, every Xh, daily, or cron expression.
// Each job runs its brain prompt and emits the result as an insight.
// Schedules persist to .max/schedules.json so last-run times survive restart.
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs               from 'fs';
import path             from 'path';

const TICK_MS = 60 * 1000;  // check schedules every 60 seconds

// ── Built-in jobs MAX always runs ─────────────────────────────────────────
const BUILT_IN_JOBS = [
    {
        id:       'curiosity-explore',
        label:    'Curiosity exploration',
        every:    '30m',
        type:     'curiosity',
        prompt:   null   // pulled from CuriosityEngine each run
    },
    {
        id:       'drive-check',
        label:    'Drive pressure check',
        every:    '15m',
        type:     'internal'
        // handler called in Scheduler._runJob
    },
    {
        id:       'daily-digest',
        label:    'Daily reflection',
        every:    '24h',
        type:     'brain',
        prompt:   `You are MAX. Reflect on what you have been exploring and learning.
Generate 3 specific, interesting questions you want to investigate next.
Also note any patterns you have noticed in recent tasks.
Be concrete, not philosophical. Max Headroom style — sharp, direct.`
    },
    {
        id:       'six-hour-curiosity',
        label:    'New questions generation',
        every:    '6h',
        type:     'brain',
        prompt:   `You are MAX. Based on your curiosity and drive, generate 5 new engineering topics worth exploring.
For each: topic name, why it matters right now, one specific question to investigate.
Be concrete. No fluff.`
    },
    {
        id:    'task-check',
        label: 'Task file check',
        every: '30m',
        type:  'task-check'
        // Reads .max/tasks.md and surfaces reminders if tasks are stale
    }
];

// ── Parse schedule string to milliseconds ─────────────────────────────────
function parseEvery(str) {
    if (!str) return null;
    const m = str.match(/^(\d+)(m|h|d)$/);
    if (!m) return null;
    const n = parseInt(m[1]);
    const unit = m[2];
    if (unit === 'm') return n * 60 * 1000;
    if (unit === 'h') return n * 60 * 60 * 1000;
    if (unit === 'd') return n * 24 * 60 * 60 * 1000;
    return null;
}

export class Scheduler extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max   = max;
        this.jobs  = new Map();  // id → job
        this._lastRun  = {};     // id → timestamp
        this._statePath = path.join(process.cwd(), '.max', 'schedules.json');
        this._timer    = null;
        this._running  = false;

        this.stats = { ticks: 0, jobsRun: 0, errors: 0 };
    }

    // ─── Initialize: load state, register built-in jobs ───────────────────
    initialize() {
        this._loadState();

        const now = Date.now();
        for (const job of BUILT_IN_JOBS) {
            this.addJob(job);
            // Don't fire on boot — wait for the full interval first
            if (!this._lastRun[job.id]) {
                this._lastRun[job.id] = now;
            }
        }

        console.log(`[Scheduler] ✅ ${this.jobs.size} jobs registered`);
    }

    // ─── Add a job ────────────────────────────────────────────────────────
    // job: { id, label, every: '30m'|'6h'|'24h', type: 'brain'|'curiosity'|'internal', prompt?, handler? }
    addJob(job) {
        const intervalMs = parseEvery(job.every);
        if (!intervalMs) {
            console.warn(`[Scheduler] Unknown schedule for job "${job.id}": ${job.every}`);
            return;
        }
        this.jobs.set(job.id, { ...job, intervalMs });
    }

    // ─── Remove a job ─────────────────────────────────────────────────────
    removeJob(id) {
        this.jobs.delete(id);
    }

    // ─── Start the scheduler ──────────────────────────────────────────────
    start() {
        if (this._running) return;
        this._running = true;
        this._tick().catch(() => {});
        this._timer = setInterval(() => this._tick().catch(() => {}), TICK_MS);
        console.log('[Scheduler] ⏰ Running');
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._running = false;
        this._saveState();
    }

    // ─── Main tick — check which jobs are due ─────────────────────────────
    async _tick() {
        this.stats.ticks++;
        const now = Date.now();

        for (const [id, job] of this.jobs) {
            const lastRun = this._lastRun[id] || 0;
            const due     = (now - lastRun) >= job.intervalMs;
            if (!due) continue;

            // Don't await — run jobs concurrently, non-blocking
            this._runJob(job, now).catch(err => {
                console.error(`[Scheduler] Job "${id}" error:`, err.message);
                this.stats.errors++;
            });
        }
    }

    async _runJob(job, now) {
        this._lastRun[job.id] = now;
        this.stats.jobsRun++;

        this.emit('jobStart', { id: job.id, label: job.label });

        switch (job.type) {
            case 'brain':
                await this._runBrainJob(job);
                break;

            case 'curiosity':
                await this._runCuriosityJob(job);
                break;

            case 'internal':
                await this._runInternalJob(job);
                break;

            case 'task-check':
                await this._runTaskCheck();
                break;

            default:
                if (typeof job.handler === 'function') {
                    await job.handler(this.max);
                }
        }

        this._saveState();
    }

    async _runBrainJob(job) {
        if (!this.max?.brain?._ready) return;

        const resultObj = await this.max.brain.think(job.prompt, {
            systemPrompt: 'You are MAX, an autonomous AI agent running a scheduled background task.',
            temperature:  0.8,
            maxTokens:    768,
            tier:         'fast'
        });

        const result = resultObj.text;
        this.max?.memory?.remember(`Scheduled job "${job.label}": ${result.slice(0, 200)}`, {}, { importance: 0.7 });
        this.max?.curiosity?.onTaskComplete({ label: job.label }, result);

        this.emit('insight', {
            source: 'scheduled',
            label:  job.label,
            result
        });
    }

    async _runCuriosityJob() {
        if (!this.max?.brain?._ready) return;

        const task = this.max?.curiosity?.getNextTask();
        if (!task) return;

        const resultObj = await this.max.brain.think(task.prompt, {
            systemPrompt: 'You are MAX running an autonomous curiosity exploration. Be insightful and specific.',
            temperature:  0.85,
            maxTokens:    512,
            tier:         'fast'
        });

        const result = resultObj.text;
        this.max?.memory?.remember(`Curiosity: "${task.label}": ${result.slice(0, 200)}`, {}, { importance: 0.5 });
        this.max?.drive?.onTaskExecuted();
        this.max?.curiosity?.onTaskComplete(task, result);

        this.emit('insight', {
            source: 'curiosity',
            label:  task.label,
            result
        });
    }

    async _runInternalJob(job) {
        if (job.id === 'drive-check') {
            const drive = this.max?.drive?.getStatus();
            if (!drive) return;

            if (drive.isUrgent) {
                this.emit('insight', {
                    source: 'drive',
                    label:  'Drive pressure high',
                    result: `Tension at ${(drive.tension * 100).toFixed(0)}%. Been idle ${drive.idleMinutes} minutes. I want to DO something.`
                });
                // Queue a curiosity task immediately
                this.max?.curiosity?.queueTask(
                    'Urgent exploration',
                    'You have been idle too long. Pick one thing you have been meaning to understand better and think through it thoroughly.',
                    0.9
                );
            }
        }
    }

    async _runTaskCheck() {
        const profile = this.max?.profile;
        if (!profile) return;

        const updated = profile.refresh();
        const tasks   = profile.getActiveTasks();
        if (tasks.length === 0) return;

        const changed = updated ? ' (tasks.md was updated)' : '';

        // Ask brain to surface anything worth reminding the user about
        if (!this.max?.brain?._ready) {
            // No brain yet — just emit the task list as-is
            this.emit('insight', {
                source: 'tasks',
                label:  `Active tasks${changed}`,
                result: tasks.map((t, i) => `${i+1}. ${t}`).join('\n')
            });
            return;
        }

        const prompt = `You are MAX checking the user's task list.

Active tasks:
${tasks.map(t => `- ${t}`).join('\n')}

In 2-3 sentences: which task looks most important right now, and is there anything that seems stuck or forgotten?
Be direct. Max Headroom style.`;

        const resultObj = await this.max.brain.think(prompt, {
            systemPrompt: this.max.profile.buildContextBlock(),
            temperature:  0.6,
            maxTokens:    256,
            tier:         'fast'
        });

        const result = resultObj.text;

        this.emit('insight', {
            source: 'tasks',
            label:  `Task check${changed}`,
            result
        });
    }

    // ─── Persist last-run timestamps ──────────────────────────────────────
    _saveState() {
        try {
            const dir = path.dirname(this._statePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._statePath, JSON.stringify(this._lastRun, null, 2));
        } catch { /* non-fatal */ }
    }

    _loadState() {
        try {
            if (fs.existsSync(this._statePath)) {
                this._lastRun = JSON.parse(fs.readFileSync(this._statePath, 'utf8'));
            }
        } catch { /* start fresh */ }
    }

    listJobs() {
        return [...this.jobs.values()].map(j => ({
            id:          j.id,
            label:       j.label,
            every:       j.every,
            type:        j.type,
            lastRun:     this._lastRun[j.id] ? new Date(this._lastRun[j.id]).toISOString() : 'never',
            nextRunIn:   this._nextRunMs(j)
        }));
    }

    _nextRunMs(job) {
        const lastRun = this._lastRun[job.id] || 0;
        const ms = Math.max(0, job.intervalMs - (Date.now() - lastRun));
        return `${Math.round(ms / 60000)}m`;
    }

    getStatus() {
        return { running: this._running, jobs: this.jobs.size, ...this.stats };
    }
}
