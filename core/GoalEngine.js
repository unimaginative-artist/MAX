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
        this.vector   = config.vector; // VECTOR Systems Architect daemon
        
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
        if (!this.brain._ready) return [{ step: 1, action: goal.description || goal.title, tool: 'brain', success: 'completed' }];

        // 📐 Phase 0: Systems Architecture (VECTOR)
        let architecture = null;
        if (this.vector) {
            const vectorResult = await this.vector.process({
                goal:           goal.title,
                description:    goal.description,
                type:           goal.type,
                successMetrics: goal.successMetrics || ["Completion", "Stability"]
            }, { 
                force: goal.type === 'fix' || goal.priority > 0.8,
                stagnation: goal.attempts > 1
            });

            if (vectorResult && !vectorResult.bypass) {
                architecture = vectorResult.architecture;
                console.log(`[GoalEngine] 📐 Structured architecture synthesized for "${goal.title}"`);
            }
        }

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
                // Match on full goal title words, not just the first word
                const keywords = goal.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                const past = this.outcomes.query({ limit: 20 }).filter(o => {
                    const haystack = (o.context?.goalTitle || o.action || '').toLowerCase();
                    return keywords.some(kw => haystack.includes(kw));
                }).slice(0, 4);

                if (past.length > 0) {
                    outcomeContext = '\n\nPAST SIMILAR ATTEMPTS:\n'
                        + past.map(o => `- ${o.success ? '✓' : '✗'} ${o.context?.goalTitle || o.action}: ${(o.result || '').slice(0, 100)}`).join('\n');
                }

                // If this goal type is struggling, warn the planner to use simpler steps
                const week = 7 * 24 * 3600_000;
                const typeRate = this.outcomes.getSuccessRate('AgentLoop', goal.type, week);
                if (typeRate !== null && typeRate < 0.4) {
                    outcomeContext += `\n\nWARNING: "${goal.type}" goals have only ${(typeRate * 100).toFixed(0)}% success rate recently.`
                        + ` Prefer fewer steps, simpler verification, and avoid shell commands that tend to fail.`;
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

        const archBlock = architecture 
            ? `\n\nSYSTEM ARCHITECTURE (follow this design):\n${JSON.stringify(architecture, null, 2)}`
            : '';

        const prompt = `Break this goal into concrete, executable steps (3-6 steps is typical; use as many as the task genuinely requires, but no more).

GOAL: ${goal.title}
TYPE: ${goal.type}
${goal.description ? `DETAILS: ${goal.description}\n` : ''}${toolLine}${archBlock}${skillBlock}${memoryContext}${outcomeContext}

QUALITY RULES — every step must be completable and produce a verifiable result:
- Every step must produce a concrete, observable artifact: a file written, a command output, a written summary.
- "Explore", "investigate", "research", "figure out" are NOT valid step actions — replace with file:read <specific file>, shell:run <specific command>, or web:search <specific query>.
- Scope matters: if the goal says "look at the codebase", pick the 2-3 most relevant files to read, not everything.
- DO NOT generate steps that only plan more steps or read more files without producing output.
- The goal is COMPLETE when the final step produces its artifact. There is no "I'll continue next time".
- A goal with vague success criteria ("looks good", "seems right") is a bad goal — success must be observable.

MANDATORY Verification:
- If type is 'fix' or 'task', the LAST STEP MUST be a verification.
- Use 'shell:run' with a REAL command (e.g. "node -e \"require('./file')\"", "npm test", "git status").
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

        // Phase 0.5: coordinator analysis -- understand before planning
        let coordinatorBlock = '';
        try {
            const analysis = await this._coordinatorAnalysis(goal, context);
            if (analysis) {
                coordinatorBlock = `\n\nCOORDINATOR ANALYSIS (use this to inform your plan):\n${analysis}`;
                console.log(`[GoalEngine] Coordinator analysis complete for "${goal.title}"`);
            }
        } catch { /* non-fatal */ }

        const fullPrompt = prompt + coordinatorBlock;

        try {
            const result = await this.brain.think(fullPrompt, { temperature: 0.15, maxTokens: 700, tier: 'smart' });
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

    // --- Coordinator analysis: understand the goal before decomposing --------
    // Inspired by Open-Multi-Agent two-phase coordinator pattern.
    // Returns a short structured analysis that the planner uses to generate
    // better, more specific steps.
    async _coordinatorAnalysis(goal, context = {}) {
        if (!this.brain._ready) return null;

        const toolLine = context.availableTools?.length
            ? context.availableTools.join(', ')
            : 'file, shell, web, git, api, brain';

        const analysisPrompt = `You are a coordinator analyzing a task before breaking it into steps.

GOAL: ${goal.title}
TYPE: ${goal.type}
${goal.description ? `DETAILS: ${goal.description}\n` : ''}AVAILABLE TOOLS: ${toolLine}

Answer these 4 questions concisely (1-2 sentences each):
1. WHAT: What is this task actually asking for? What is the concrete deliverable?
2. WHERE: What are the 2-3 most relevant specific files, directories, or systems involved? Be specific — name actual paths if you can infer them.
3. SUCCESS: What does success look like? What specific output, file change, or state proves this is done?
4. PITFALLS: What is the most likely way this fails? (e.g. missing dependency, wrong file path, Windows vs Unix command)

Return as plain text, 4 labeled lines. No JSON. Be concise.`;

        try {
            const result = await this.brain.think(analysisPrompt, { temperature: 0.2, maxTokens: 200, tier: 'fast' });
            return result.text.trim().slice(0, 600);
        } catch {
            return null;
        }
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

        // Reward scales down with replans: 0 replans = 0.9, 1 = 0.75, 2 = 0.6, 3+ = 0.45
        const replans = outcome.replans ?? 0;
        const reward = Math.max(0.45, 0.9 - replans * 0.15);

        this.outcomes?.record({
            agent:   'AgentLoop',
            action:  goal.type,
            context: { goalTitle: goal.title, goalType: goal.type, source: goal.source, replans },
            result:  outcome.summary,
            success: true,
            reward
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
            agent:   'AgentLoop',
            action:  goal.type,
            context: { goalTitle: goal.title, goalType: goal.type, attempts: goal.attempts, source: goal.source },
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

        // Extract recently-failed goal titles so we don't regenerate them
        const recentFailed = this.outcomes
            ? this.outcomes.query({ success: false, limit: 10, since: Date.now() - 7 * 24 * 3600_000 })
                .map(o => o.context?.goalTitle).filter(Boolean).slice(0, 5)
            : [];
        const avoidBlock = recentFailed.length > 0
            ? `\n\nRECENTLY FAILED (do NOT regenerate these or closely similar goals):\n${recentFailed.map(t => `- ${t}`).join('\n')}`
            : '';

        // Find which goal type is struggling so we can deprioritize it
        const week = 7 * 24 * 3600_000;
        const typeRates = ['task', 'fix', 'research', 'improvement'].map(t => {
            const r = this.outcomes?.getSuccessRate('AgentLoop', t, week);
            return r !== null && r < 0.35 ? t : null;
        }).filter(Boolean);
        const weakTypes = typeRates.length > 0
            ? `\n\nSTRUGGLING GOAL TYPES (avoid generating these right now): ${typeRates.join(', ')}`
            : '';

        const prompt = `You are MAX, an autonomous engineering AI agent working for Barry.
Barry's current challenge: "${userContext || 'building a fully agentic AI system (SOMA)'}"

Current active goals:
${activeList}

Recent outcomes: ${recentOutcomes || 'none'}${avoidBlock}${weakTypes}

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
        let p = 0.5;
        if (goal.type === 'fix')         p += 0.2;
        if (goal.type === 'improvement') p += 0.1;
        if (goal.source === 'user')      p += 0.2;
        if (goal.priority)               p  = goal.priority;

        // Outcome-aware adjustment: boost proven types, penalize struggling ones
        if (this.outcomes) {
            const week = 7 * 24 * 3600_000;
            const rate = this.outcomes.getSuccessRate('AgentLoop', goal.type, week);
            if (rate !== null) {
                if (rate > 0.7)      p += 0.1;   // this type succeeds reliably
                else if (rate < 0.3) p -= 0.15;  // this type keeps failing
            }
        }

        return Math.min(1.0, Math.max(0.05, p));
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
        const data = JSON.stringify({
            active:    [...this._active.values()],
            completed: this._completed.slice(0, 20),
            stats:     this.stats
        }, null, 2);
        
        fs.promises.writeFile(this.goalsPath, data).catch(err => {
            console.error(`[GoalEngine] ❌ Failed to save goals:`, err.message);
        });
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
