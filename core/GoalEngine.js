// ═══════════════════════════════════════════════════════════════════════════
// GoalEngine.js — MAX's self-directed goal system
// MAX generates his own goals from context, curiosity, and outcomes.
// Goals persist to .max/goals.json and survive restarts.
// Inspired by SOMA GoalPlannerArbiter — rewritten clean, no BaseArbiter.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const GOALS_FILE = path.join(process.cwd(), '.max', 'goals.json');

// Priority weights (must sum to 1.0)
const WEIGHTS = { impact: 0.35, urgency: 0.25, feasibility: 0.25, effort: 0.15 };

export class GoalEngine {
    constructor(brain, outcomeTracker, config = {}) {
        this.brain    = brain;
        this.outcomes = outcomeTracker;
        this.config   = {
            maxActive:        config.maxActive        || 10,
            maxHistory:       config.maxHistory       || 50,
            staleDays:        config.staleDays        || 3,
            autoGenerateEvery: config.autoGenerateEvery || '6h',
            ...config
        };

        this._active    = new Map();  // id → goal
        this._completed = [];
        this._failed    = [];

        this.stats = { created: 0, completed: 0, failed: 0, autonomous: 0, userAdded: 0 };
    }

    // ─── Initialize — load from disk ──────────────────────────────────────
    initialize() {
        this._load();
        console.log(`[GoalEngine] ✅ ${this._active.size} active goals`);
    }

    // ─── Add a goal ───────────────────────────────────────────────────────
    // goal: { title, description, type, steps?, source: 'auto'|'user'|'curiosity' }
    addGoal(goal) {
        const id  = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const now = Date.now();

        const entry = {
            id,
            title:       goal.title,
            description: goal.description || '',
            type:        goal.type || 'task',         // task | research | improvement | fix
            source:      goal.source || 'auto',
            steps:       goal.steps || [],            // decomposed steps
            currentStep: 0,
            status:      'pending',                   // pending | active | blocked | done | failed
            priority:    goal.priority ?? this._scorePriority(goal),
            createdAt:   now,
            updatedAt:   now,
            attempts:    0,
            outcome:     null
        };

        if (this._active.size >= this.config.maxActive) {
            this._dropLowestPriority();
        }

        this._active.set(id, entry);
        this.stats.created++;
        if (goal.source === 'auto') this.stats.autonomous++;
        else this.stats.userAdded++;

        this._save();
        console.log(`[GoalEngine] ➕ "${entry.title}" (priority ${entry.priority.toFixed(2)}, ${entry.source})`);
        return id;
    }

    // ─── Get the highest priority pending goal ────────────────────────────
    getNext(driveSystem = null) {
        const candidates = [...this._active.values()].filter(g => g.status === 'pending');
        if (candidates.length === 0) return null;

        // Apply urgency boost from DriveSystem if available
        const scored = candidates.map(g => ({
            ...g,
            effectivePriority: g.priority + (driveSystem?.getUrgencyBoost(g) || 0)
        }));

        scored.sort((a, b) => b.effectivePriority - a.effectivePriority);
        return scored[0];
    }

    // ─── Decompose a goal into concrete steps via brain ───────────────────
    async decompose(goal) {
        if (!this.brain._ready) return [goal.description || goal.title];

        const prompt = `Break this goal into 3-6 concrete, executable steps:

GOAL: ${goal.title}
${goal.description ? `DETAILS: ${goal.description}` : ''}

Return a JSON array of step objects:
[
  { "step": 1, "action": "specific thing to do", "tool": "file|shell|web|git|api|brain", "success": "how to know it worked" }
]

Return ONLY the JSON array.`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.3, maxTokens: 512, tier: 'fast' });
            const raw    = result.text;
            const match  = raw.match(/\[[\s\S]*\]/);
            if (match) {
                const steps = JSON.parse(match[0]);
                this._active.get(goal.id).steps = steps;
                this._save();
                return steps;
            }
        } catch { /* fall through */ }

        return [{ step: 1, action: goal.description || goal.title, tool: 'brain', success: 'completed' }];
    }

    // ─── Mark a goal complete ─────────────────────────────────────────────
    complete(id, outcome = {}) {
        const goal = this._active.get(id);
        if (!goal) return false;

        goal.status    = 'done';
        goal.outcome   = outcome;
        goal.updatedAt = Date.now();

        this._active.delete(id);
        this._completed.unshift(goal);
        if (this._completed.length > this.config.maxHistory) this._completed.pop();

        this.stats.completed++;
        this._save();
        console.log(`[GoalEngine] ✅ "${goal.title}" completed`);

        // Track outcome
        this.outcomes?.record({
            agent:   'GoalEngine',
            action:  'complete_goal',
            context: { goalType: goal.type, source: goal.source },
            result:  outcome.summary,
            success: true,
            reward:  0.8
        });

        return true;
    }

    // ─── Mark a goal failed ───────────────────────────────────────────────
    fail(id, reason = '') {
        const goal = this._active.get(id);
        if (!goal) return false;

        goal.status    = 'failed';
        goal.outcome   = { error: reason };
        goal.updatedAt = Date.now();

        this._active.delete(id);
        this._failed.unshift(goal);

        this.stats.failed++;
        this._save();
        console.log(`[GoalEngine] ❌ "${goal.title}" failed: ${reason}`);

        this.outcomes?.record({
            agent:   'GoalEngine',
            action:  'fail_goal',
            context: { goalType: goal.type },
            result:  reason,
            success: false,
            reward: -0.3
        });

        return true;
    }

    // ─── Auto-generate goals from context ─────────────────────────────────
    async generateGoals(context = {}) {
        if (!this.brain._ready) return [];

        const activeList = [...this._active.values()].map(g => `- ${g.title}`).join('\n') || 'none';
        const userContext = context.profileContext || '';
        const recentOutcomes = this.outcomes
            ? this.outcomes.query({ limit: 5 }).map(o => `${o.action}: ${o.success ? 'success' : 'fail'}`).join(', ')
            : '';

        const prompt = `You are MAX, an autonomous engineering agent. Generate 3 NEW goals worth pursuing.

Current active goals:
${activeList}

Recent outcomes: ${recentOutcomes || 'none'}
${userContext}

Generate goals that are:
- Concrete and achievable in one session
- Useful for an engineering agent or the user's current project
- Different from existing active goals

Return JSON array:
[
  {
    "title": "short goal title",
    "description": "one sentence of what to actually do",
    "type": "task|research|improvement|fix",
    "priority": 0.1-1.0
  }
]
Return ONLY the JSON array.`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.8, maxTokens: 512, tier: 'fast' });
            const raw    = result.text;
            const match  = raw.match(/\[[\s\S]*\]/);
            if (!match) return [];

            const goals = JSON.parse(match[0]);
            const ids   = [];
            for (const g of goals.slice(0, 3)) {
                if (g.title && this._active.size < this.config.maxActive) {
                    ids.push(this.addGoal({ ...g, source: 'auto' }));
                }
            }
            return ids;
        } catch { return []; }
    }

    // ─── Score goal priority ──────────────────────────────────────────────
    _scorePriority(goal) {
        // Simple heuristic scoring — can be made smarter over time
        let p = 0.5;
        if (goal.type === 'fix')         p += 0.2;
        if (goal.type === 'improvement') p += 0.1;
        if (goal.source === 'user')      p += 0.2;
        if (goal.priority)               p  = goal.priority;
        return Math.min(1.0, p);
    }

    _dropLowestPriority() {
        let lowest = null, lowestP = Infinity;
        for (const [id, g] of this._active) {
            if (g.priority < lowestP && g.source !== 'user') {
                lowest = id; lowestP = g.priority;
            }
        }
        if (lowest) {
            console.log(`[GoalEngine] Dropped low-priority goal to make room`);
            this._active.delete(lowest);
        }
    }

    _save() {
        try {
            const dir = path.dirname(GOALS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(GOALS_FILE, JSON.stringify({
                active:    [...this._active.values()],
                completed: this._completed.slice(0, 20),
                stats:     this.stats
            }, null, 2));
        } catch { /* non-fatal */ }
    }

    _load() {
        try {
            if (!fs.existsSync(GOALS_FILE)) return;
            const data = JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'));
            for (const g of (data.active || [])) this._active.set(g.id, g);
            this._completed = data.completed || [];
            if (data.stats) this.stats = data.stats;
        } catch { /* start fresh */ }
    }

    listActive()    { return [...this._active.values()].sort((a, b) => b.priority - a.priority); }
    listCompleted() { return this._completed; }

    getStatus() {
        return {
            active:    this._active.size,
            completed: this._completed.length,
            failed:    this._failed.length,
            ...this.stats
        };
    }
}
