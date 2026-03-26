// ═══════════════════════════════════════════════════════════════════════════
// GoalEngine.js — MAX's self-directed goal system
// MAX generates his own goals from context, curiosity, and outcomes.
// Goals persist to .max/goals.json and survive restarts.
// Inspired by SOMA GoalPlannerArbiter — rewritten clean, no BaseArbiter.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

export class GoalEngine {
    constructor(brain, outcomeTracker, memory = null, config = {}) {
        this.brain    = brain;
        this.outcomes = outcomeTracker;
        this.memory   = memory;   // injected after memory system boots
        
        console.log(`[GoalEngine] Constructor config storageDir: ${config.storageDir}`);
        const storageDir = config.storageDir || path.join(process.cwd(), '.max');
        this.goalsPath   = path.join(storageDir, 'goals.json');

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
        // Deduplicate: if an active goal with the same title already exists, return its id
        const titleLower = (goal.title || '').toLowerCase().trim();
        for (const [id, g] of this._active) {
            if (g.title.toLowerCase().trim() === titleLower) {
                console.log(`[GoalEngine] ⚠️  Duplicate goal ignored: "${goal.title}"`);
                return id;
            }
        }

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
            outcome:     null,
            blockedBy:   goal.blockedBy || []         // dependency graph: goal IDs that must complete first
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
        const candidates = [...this._active.values()].filter(g => {
            if (g.status !== 'pending') return false;
            // Skip if any dependency is still active/pending
            if (g.blockedBy?.length > 0) {
                const stillBlocked = g.blockedBy.some(id => this._active.has(id));
                if (stillBlocked) return false;
            }
            return true;
        });
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
    // context.availableTools — string[] of registered tool names (from AgentLoop)
    async decompose(goal, context = {}) {
        if (!this.brain._ready) return [goal.description || goal.title];

        // Pull relevant memories and past outcomes to inform the plan
        let memoryContext = '';
        if (this.memory) {
            try {
                const relevant = await this.memory.recall(goal.title, { topK: 3 });
                if (relevant.length > 0) {
                    memoryContext = '\n\nRELEVANT PAST EXPERIENCE:\n'
                        + relevant.map(m => `- ${m.content.slice(0, 150)}`).join('\n');
                }
            } catch { /* non-fatal */ }
        }

        let outcomeContext = '';
        if (this.outcomes) {
            try {
                const keyword = goal.title.toLowerCase().split(' ')[0];
                const past = this.outcomes.query({ limit: 10 }).filter(o =>
                    (o.context?.title || o.action || '').toLowerCase().includes(keyword)
                ).slice(0, 4);
                if (past.length > 0) {
                    outcomeContext = '\n\nPAST SIMILAR ATTEMPTS:\n'
                        + past.map(o => `- ${o.success ? '✓' : '✗'} ${o.context?.title || o.action}: ${(o.result || '').slice(0, 100)}`).join('\n');
                }
            } catch { /* non-fatal */ }
        }

        // Tell the planner exactly which tools are available — prevents plans
        // that use non-existent tools and then fail on the first step.
        const toolLine = context.availableTools?.length
            ? `AVAILABLE TOOLS (use only these): ${context.availableTools.join(', ')}`
            : `AVAILABLE TOOLS: file, shell, web, git, api, brain`;

        // Inject proven skill as a starting point if one was found
        const skillBlock = context.skill
            ? `\n\nPROVEN APPROACH (adapt this, don't copy blindly — it worked before for similar goals):\n`
                + context.skill.steps.map(s => `  ${s.step}. [${s.tool}] ${s.action}`).join('\n')
            : '';

        const prompt = `Break this goal into 3-6 concrete, executable steps.

GOAL: ${goal.title}
TYPE: ${goal.type}
${goal.description ? `DETAILS: ${goal.description}\n` : ''}${toolLine}${skillBlock}${memoryContext}${outcomeContext}

MANDATORY Verification (Phase 3 Evolution):
- If type is 'fix' or 'task', the LAST STEP MUST be a verification.
- Use 'lab:run' to run tests, or 'lab:generate' if no test exists for the modified file.
- If it's a shell script or CLI, use 'shell:run' with a REAL command that already exists (e.g. "node -e \"require('./file')\"", "npm test", "git status").
- NEVER invent benchmark scripts, test files, or commands that don't already exist in the project.
- For non-code goals (config, credentials, connections), use 'brain' to summarize what was done instead of a shell command.
- The goal is not finished until you prove it works with output evidence.

Rules:
- Each step must use one of the listed tools
- Actions must be specific and executable (e.g. "run: npm install" not "install dependencies")
- Success criterion must be text that should appear in the output (e.g. "output contains 'git version'" not "exit code 0")
  Use "completed" as the success value for write/create steps where there is no expected output text
- Set dependsOn to step numbers this step requires output from (empty array if independent)
- Independent steps (dependsOn: []) can run in parallel — use this for research, reads, and searches

Tool-specific params (REQUIRED for correct execution):
- file tool:  include "params": {"filePath": "path/to/file.js"} for read/write/replace/delete
              include "action_name": "read" | "write" | "replace" | "list" | "search" | "delete"
- shell tool: include "action_name": "run", "params": {"command": "exact shell command"}
  WINDOWS ONLY — never use Unix commands (ls/find/grep/xargs/head/cat/rm/cp/mv)
  Use: dir, powershell -Command "Get-ChildItem ...", node, npm, git
  NEVER add >/dev/null, >nul, or 2>&1 redirects — run commands plainly
- web tool:   include "params": {"query": "search terms"} for search, or {"url": "..."} for fetch
- git tool:   include "params": {"command": "status"} or similar
- brain tool: no params needed — action is passed directly as a prompt

Return a JSON array of step objects:
[
  {
    "step": 1,
    "action": "human-readable description of what this step does",
    "tool": "tool_name",
    "action_name": "specific_action",
    "params": { "key": "value" },
    "success": "observable criterion",
    "dependsOn": []
  }
]

Return ONLY the JSON array.`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.15, maxTokens: 600, tier: 'smart' });
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

    // ─── Add a dependency between goals ──────────────────────────────────
    // goalId will not be picked until all blockedByIds are complete
    addDependency(goalId, blockedByIds = []) {
        const goal = this._active.get(goalId);
        if (!goal) return false;
        goal.blockedBy = [...new Set([...(goal.blockedBy || []), ...blockedByIds])];
        this._save();
        console.log(`[GoalEngine] 🔗 "${goal.title}" now blocked by ${blockedByIds.length} goal(s)`);
        return true;
    }

    // ─── Requeue a goal as pending-blocked after diagnosis ───────────────
    // Used by AgentLoop when it diagnoses a root cause and queues a remedy.
    // The original goal re-enters the pending queue, blocked on the remedy.
    // When the remedy completes, complete() auto-unblocks this goal.
    requeue(id, blockedByIds = []) {
        const goal = this._active.get(id);
        if (!goal) return false;
        goal.status    = 'pending';
        goal.steps     = [];        // clear stale steps — will re-decompose when unblocked
        goal.attempts  = (goal.attempts || 0);
        goal.blockedBy = [...new Set([...(goal.blockedBy || []), ...blockedByIds])];
        goal.updatedAt = Date.now();
        this._save();
        console.log(`[GoalEngine] ⏳ "${goal.title}" requeued — blocked pending remedy`);
        return true;
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

        // Unblock any goals that were waiting on this one
        for (const [, g] of this._active) {
            if (g.blockedBy?.includes(id)) {
                g.blockedBy = g.blockedBy.filter(bid => bid !== id);
                if (g.blockedBy.length === 0) {
                    console.log(`[GoalEngine] 🔓 "${g.title}" unblocked`);
                }
            }
        }
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

    // ─── Mark a goal failed — retries up to maxRetries before permanent fail ─
    fail(id, reason = '') {
        const goal = this._active.get(id);
        if (!goal) return false;

        goal.attempts  = (goal.attempts || 0) + 1;
        goal.updatedAt = Date.now();

        const maxRetries = this.config.maxRetries ?? 3;

        // Retry: clear stale steps, give a small urgency bump, re-queue
        if (goal.attempts < maxRetries) {
            goal.status   = 'pending';
            goal.steps    = [];   // force re-decompose with fresh context next cycle
            goal.outcome  = { lastError: reason.slice(0, 200), attempt: goal.attempts };
            goal.priority = Math.min(1.0, (goal.priority || 0.5) + 0.05);
            this._save();
            console.log(`[GoalEngine] 🔄 "${goal.title}" retry ${goal.attempts}/${maxRetries - 1}: ${reason.slice(0, 60)}`);
            return false;  // not yet permanently failed
        }

        // Permanently failed — exhausted retries
        goal.status  = 'failed';
        goal.outcome = { error: reason, attempts: goal.attempts };

        this._active.delete(id);
        this._failed.unshift(goal);

        this.stats.failed++;
        this._save();
        console.log(`[GoalEngine] ❌ "${goal.title}" permanently failed after ${goal.attempts} attempt(s): ${reason.slice(0, 80)}`);

        this.outcomes?.record({
            agent:   'GoalEngine',
            action:  'fail_goal',
            context: { goalType: goal.type, attempts: goal.attempts },
            result:  reason,
            success: false,
            reward:  -0.3
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

        const prompt = `You are MAX, an autonomous engineering AI agent working for Barry.
Barry's current challenge: "${userContext || 'building a fully agentic AI system (SOMA)'}"

Current active goals:
${activeList}

Recent outcomes: ${recentOutcomes || 'none'}

Generate 3 NEW, CONCRETE goals MAX can execute RIGHT NOW using his tools (file, shell, web, git, api, brain).
Goals must be:
- Specific enough to execute with tools — not vague research ideas
- Achievable in one session (30 min or less)
- Actually useful to Barry's project (SOMA/MAX improvement, code quality, automation)
- Different from existing active goals above

Good examples:
- "Audit MAX's AgentLoop for silent failure modes and document them in .max/audit.md"
- "Read SOMA's extended.js and write a summary of what loads and when into .max/soma-notes.md"
- "Check if MAX's Discord auto-respond is wired correctly by reading DiscordTool.js and MAX.js"
- "Scan the MAX codebase for TODO comments and create goals for each"

Bad examples (too vague, can't execute with tools):
- "Investigate system architecture patterns"
- "Research AI capabilities"

Return JSON array ONLY:
[
  {
    "title": "short action-oriented title",
    "description": "exactly what to do and what tool to use",
    "type": "task|research|improvement|fix",
    "priority": 0.1-1.0
  }
]`;

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
            console.log(`[GoalEngine] Attempting to save to: ${this.goalsPath}`);
            const dir = path.dirname(this.goalsPath);
            if (!fs.existsSync(dir)) {
                console.log(`[GoalEngine] Creating directory: ${dir}`);
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = JSON.stringify({
                active:    [...this._active.values()],
                completed: this._completed.slice(0, 20),
                stats:     this.stats
            }, null, 2);
            fs.writeFileSync(this.goalsPath, data);
            console.log(`[GoalEngine] ✅ Saved ${this._active.size} goals to ${this.goalsPath}`);
        } catch (err) { 
            console.error(`[GoalEngine] ❌ CRITICAL: Failed to save goals to ${this.goalsPath}:`, err.message);
        }
    }

    _load() {
        try {
            if (!fs.existsSync(this.goalsPath)) return;
            const data = JSON.parse(fs.readFileSync(this.goalsPath, 'utf8'));
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
