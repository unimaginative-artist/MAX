// ═══════════════════════════════════════════════════════════════════════════
// ReflectionEngine.js — MAX's fractal meta-brain
//
// A small node that watches how MAX performs, identifies patterns in failures
// and pushback, builds a growing self-model, and generates targeted
// improvement goals. This is what makes the bigger brain better over time.
//
// Three loops:
//   1. Per-turn quick score  — fast LLM rates every exchange (non-blocking)
//   2. Deep reflection       — smart LLM analyzes patterns every N turns
//   3. Prompt patches        — reflection writes small addendums injected
//                              back into every system prompt
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const SELF_MODEL_FILE  = path.join(process.cwd(), '.max', 'self_model.json');
const REFLECT_EVERY_N  = 10;   // deep reflection every N conversation turns
const MAX_RECENT_TURNS = 20;   // rolling window for pattern analysis

export class ReflectionEngine {
    constructor(brain, goalEngine, outcomeTracker, kb = null) {
        this.brain    = brain;
        this.goals    = goalEngine;
        this.outcomes = outcomeTracker;
        this.kb       = kb;

        this._turnCount   = 0;
        this._recentTurns = [];  // rolling window

        this._selfModel = {
            strengths:        [],   // observed strengths
            weaknesses:       [],   // observed failure patterns
            patterns:         [],   // { description, count, lastSeen }
            promptPatches:    [],   // small injections that improve behavior
            lastDeepReflect:  null,
            totalReflections: 0
        };

        this._load();
    }

    // ─── Called after every conversation turn (fire-and-forget) ──────────
    async reflectOnTurn(userMsg, maxResponse, context = {}) {
        this._turnCount++;

        // Store turn in rolling window
        this._recentTurns.push({
            ts:          Date.now(),
            userMsg:     userMsg.slice(0, 300),
            maxResponse: maxResponse.slice(0, 300),
            persona:     context.persona,
            drive:       context.drive
        });
        if (this._recentTurns.length > MAX_RECENT_TURNS) this._recentTurns.shift();

        // Quick quality score — non-blocking, doesn't slow the response
        if (this.brain?._ready && userMsg.length > 20) {
            this._quickScore(userMsg, maxResponse).catch(() => {});
        }

        // Every N turns, run deep reflection in background
        if (this._turnCount % REFLECT_EVERY_N === 0) {
            this._deepReflect().catch(() => {});
        }
    }

    // ─── Quick per-turn quality scoring via fast LLM ──────────────────────
    async _quickScore(userMsg, maxResponse) {
        const prompt = `Rate this AI exchange. Be brutally honest.

USER: ${userMsg.slice(0, 200)}
AI: ${maxResponse.slice(0, 200)}

Return ONLY a JSON object:
{
  "score": 0.0-1.0,
  "issue": "none|verbose|unclear|off-topic|unhelpful|wrong|condescending",
  "note": "one sentence"
}`;

        const result = await this.brain.think(prompt, {
            temperature: 0.1,
            maxTokens:   80,
            tier:        'fast'
        });

        const raw = result.text;
        const match = raw.match(/\{[\s\S]*?\}/);
        if (!match) return;

        let eval_;
        try { eval_ = JSON.parse(match[0]); } catch { return; }

        // Log to OutcomeTracker so pattern analysis has signal
        this.outcomes?.record({
            agent:    'ReflectionEngine',
            action:   'conversation_turn',
            context:  { userMsg: userMsg.slice(0, 100) },
            result:   eval_.note || '',
            success:  eval_.score >= 0.6,
            reward:   eval_.score,
            metadata: { issue: eval_.issue }
        });

        // Note bad turns as patterns
        if (eval_.score < 0.5 && eval_.issue && eval_.issue !== 'none') {
            this._notePattern(`Response quality issue: ${eval_.issue}`, eval_.note);
        }
    }

    // ─── Deep reflection — run every N turns in background ────────────────
    async _deepReflect() {
        if (!this.brain?._ready || this._recentTurns.length < 3) return;

        console.log('[ReflectionEngine] 🧠 Running deep self-reflection...');

        const recentSummary = this._recentTurns
            .slice(-10)
            .map(t => `USER: ${t.userMsg.slice(0, 150)}\nMAX: ${t.maxResponse.slice(0, 150)}`)
            .join('\n\n---\n\n');

        const outcomeStats      = this.outcomes?.getSummary() || 'no outcome data';
        const currentWeaknesses = this._selfModel.weaknesses.slice(0, 5).join('; ') || 'none yet';
        const currentStrengths  = this._selfModel.strengths.slice(0, 3).join('; ')  || 'none yet';
        const topPatterns       = this._selfModel.patterns.slice(0, 3)
            .map(p => `"${p.description}" (x${p.count})`).join(', ') || 'none';

        const prompt = `You are MAX's meta-cognitive reflection system. Your job is to make MAX better.

RECENT CONVERSATIONS (last 10 turns):
${recentSummary}

PERFORMANCE DATA:
- Outcome stats: ${outcomeStats}
- Known weaknesses: ${currentWeaknesses}
- Known strengths: ${currentStrengths}
- Recurring patterns: ${topPatterns}

Analyze carefully. What is MAX doing well? What is MAX doing poorly?
What specific behavior change would most improve future responses?

Return ONLY a JSON object:
{
  "strengths": ["specific observed strength"],
  "weaknesses": ["specific failure pattern with example"],
  "newPatterns": ["recurring thing worth tracking"],
  "promptPatch": "one concrete sentence to add to system prompt to fix a weakness, or null",
  "improvementGoal": {
    "title": "specific actionable improvement",
    "description": "what to actually do differently",
    "type": "improvement",
    "priority": 0.1-1.0
  }
}
Return null for improvementGoal if no clear goal is identified.`;

        try {
            const result = await this.brain.think(prompt, {
                temperature: 0.3,
                maxTokens:   600,
                tier:        'fast'
            });

            const raw   = result.text;
            const match = raw.match(/\{[\s\S]*\}/);
            if (!match) return;

            const reflection = JSON.parse(match[0]);
            this._mergeReflection(reflection);

            // Queue improvement goal if one was generated
            if (reflection.improvementGoal?.title) {
                this.goals?.addGoal({
                    ...reflection.improvementGoal,
                    source: 'reflection'
                });
                console.log(`[ReflectionEngine] ➕ Goal: "${reflection.improvementGoal.title}"`);
            }

            this._selfModel.lastDeepReflect  = new Date().toISOString();
            this._selfModel.totalReflections++;
            this._save();

            // Write key insights to knowledge base
            if (this.kb?._ready && (reflection.weaknesses?.length || reflection.strengths?.length)) {
                const parts = [`Reflection #${this._selfModel.totalReflections}:`];
                if (reflection.strengths?.length)  parts.push(`Strengths: ${reflection.strengths.join('; ')}`);
                if (reflection.weaknesses?.length) parts.push(`Areas to improve: ${reflection.weaknesses.join('; ')}`);
                if (reflection.promptPatch)        parts.push(`Behavioral adjustment: ${reflection.promptPatch}`);
                this.kb.remember(parts.join('\n'), { source: 'deep_reflection' }).catch(() => {});
            }

            // Every 3rd deep reflection, run dreaming consolidation
            if (this._selfModel.totalReflections % 3 === 0) {
                this.dream(this.kb).catch(() => {});
            }

            // Record outcome
            this.outcomes?.record({
                agent:    'ReflectionEngine',
                action:   'deep_reflect',
                result:   `Reflection #${this._selfModel.totalReflections}`,
                success:  true,
                tokens:   result.metadata?.tokens || 0,
                duration: result.metadata?.latency || 0
            });

            console.log(`[ReflectionEngine] ✅ Reflection #${this._selfModel.totalReflections} — `
                + `${this._selfModel.weaknesses.length} weaknesses, `
                + `${this._selfModel.promptPatches.length} prompt patches`);

        } catch (err) {
            console.error('[ReflectionEngine] Deep reflect error:', err.message);
        }
    }

    // ─── Note a recurring pattern (increments count if seen before) ───────
    _notePattern(description, detail = '') {
        const existing = this._selfModel.patterns.find(p => p.description === description);
        if (existing) {
            existing.count++;
            existing.lastSeen = Date.now();
            existing.detail   = detail;
        } else {
            this._selfModel.patterns.push({ description, detail, count: 1, lastSeen: Date.now() });
        }
        // Keep top 20 by frequency
        this._selfModel.patterns.sort((a, b) => b.count - a.count);
        if (this._selfModel.patterns.length > 20) this._selfModel.patterns.pop();
    }

    // ─── Merge deep reflection results into the self-model ────────────────
    _mergeReflection(reflection) {
        for (const s of (reflection.strengths || [])) {
            if (s && !this._selfModel.strengths.includes(s)) this._selfModel.strengths.push(s);
        }
        if (this._selfModel.strengths.length > 10) this._selfModel.strengths.shift();

        for (const w of (reflection.weaknesses || [])) {
            if (w && !this._selfModel.weaknesses.includes(w)) this._selfModel.weaknesses.push(w);
        }
        if (this._selfModel.weaknesses.length > 10) this._selfModel.weaknesses.shift();

        for (const p of (reflection.newPatterns || [])) {
            if (p) this._notePattern(p);
        }

        // Prompt patches: add if novel, cap at 5 (oldest dropped)
        if (reflection.promptPatch && !this._selfModel.promptPatches.includes(reflection.promptPatch)) {
            this._selfModel.promptPatches.push(reflection.promptPatch);
            if (this._selfModel.promptPatches.length > 5) this._selfModel.promptPatches.shift();
            console.log(`[ReflectionEngine] 📝 Prompt patch: "${reflection.promptPatch}"`);
        }
    }

    // ─── Inject self-model into system prompt ─────────────────────────────
    // Called from MAX.think() — adds a small block to every system prompt
    getSelfModelContext() {
        const { strengths, weaknesses, promptPatches } = this._selfModel;
        if (strengths.length === 0 && weaknesses.length === 0 && promptPatches.length === 0) return '';

        let ctx = '\n\n## Self-model (learned from reflection)';
        if (strengths.length > 0)     ctx += `\nStrengths: ${strengths.slice(0, 3).join('; ')}`;
        if (weaknesses.length > 0)    ctx += `\nWatch for: ${weaknesses.slice(0, 3).join('; ')}`;
        if (promptPatches.length > 0) ctx += `\nBehavior adjustments: ${promptPatches.join(' ')}`;
        return ctx;
    }

    // ─── Force a deep reflection on demand (/reflect command) ─────────────
    async forceReflect() {
        await this._deepReflect();
        return this.getSummary();
    }

    // ─── Persist / load ───────────────────────────────────────────────────
    _save() {
        try {
            const dir = path.dirname(SELF_MODEL_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SELF_MODEL_FILE, JSON.stringify(this._selfModel, null, 2));
        } catch { /* non-fatal */ }
    }

    _load() {
        try {
            if (fs.existsSync(SELF_MODEL_FILE)) {
                const data = JSON.parse(fs.readFileSync(SELF_MODEL_FILE, 'utf8'));
                this._selfModel = { ...this._selfModel, ...data };
                console.log(`[ReflectionEngine] ✅ Self-model loaded (${this._selfModel.totalReflections} reflections)`);
            }
        } catch { /* start fresh */ }
    }

    getSummary() {
        const { strengths, weaknesses, patterns, promptPatches, totalReflections } = this._selfModel;
        return {
            reflections:   totalReflections,
            strengths:     strengths.slice(0, 3),
            weaknesses:    weaknesses.slice(0, 3),
            patterns:      patterns.slice(0, 3).map(p => `${p.description} (x${p.count})`),
            promptPatches
        };
    }

    getStatus() {
        return {
            turnCount:       this._turnCount,
            lastDeepReflect: this._selfModel.lastDeepReflect,
            totalReflections: this._selfModel.totalReflections,
            strengthsCount:  this._selfModel.strengths.length,
            weaknessesCount: this._selfModel.weaknesses.length,
            patchesCount:    this._selfModel.promptPatches.length
        };
    }

    // ─── Reflect on task execution patterns (not just chat quality) ───────
    // Analyzes AgentLoop outcome history for recurring failure patterns
    // and generates improvement goals to address them.
    async reflectOnTaskOutcomes() {
        if (!this.brain?._ready || !this.outcomes) return;

        const taskOutcomes = this.outcomes.query({ limit: 40 })
            .filter(o => o.agent === 'AgentLoop' || o.action?.startsWith('goal:'));

        if (taskOutcomes.length < 5) return;

        const failRate  = taskOutcomes.filter(o => !o.success).length / taskOutcomes.length;
        const summary   = taskOutcomes
            .map(o => `${o.success ? '✓' : '✗'} ${o.context?.title || o.action}: ${(o.result || '').slice(0, 100)}`)
            .join('\n');

        const prompt = `You are MAX's task execution analyzer. Study these outcomes and find patterns.

TASK OUTCOMES (${taskOutcomes.length} total, ${(failRate * 100).toFixed(0)}% failure rate):
${summary}

Identify:
1. What categories of tasks consistently fail and why?
2. What execution patterns lead to success?
3. What single change would most reduce failures?

Return ONLY a JSON object:
{
  "failurePatterns": ["specific pattern with evidence"],
  "successPatterns": ["what reliably works"],
  "improvementGoal": {
    "title": "specific actionable improvement title",
    "description": "exactly what to change in the execution strategy",
    "type": "improvement",
    "priority": 0.1-1.0
  }
}`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.3, maxTokens: 500, tier: 'fast' });
            const match  = result.text.match(/\{[\s\S]*\}/);
            if (!match) return;

            const analysis = JSON.parse(match[0]);

            for (const p of (analysis.failurePatterns || [])) {
                if (p) this._notePattern(`Task: ${p}`);
            }

            if (analysis.improvementGoal?.title) {
                this.goals?.addGoal({ ...analysis.improvementGoal, source: 'task_reflection' });
                console.log(`[ReflectionEngine] ➕ Task improvement goal: "${analysis.improvementGoal.title}"`);
            }

            this._selfModel.totalReflections++;
            this._save();
            console.log(`[ReflectionEngine] 📊 Task reflection complete — ${(failRate * 100).toFixed(0)}% failure rate analyzed`);
        } catch (err) {
            console.error('[ReflectionEngine] Task reflect error:', err.message);
        }
    }

    // ─── Dreaming: long-term consolidation of outcomes into KB ────────────
    // Called during low-activity periods or on /reflect
    async dream(kb = null) {
        if (!this.brain?._ready || !this.outcomes) return null;

        console.log('[ReflectionEngine] 🌙 Dreaming... consolidating outcomes');

        const recentOutcomes = this.outcomes.query({ limit: 20 });
        if (recentOutcomes.length === 0) return null;

        const outcomeSummary = recentOutcomes
            .map(o => `${o.action}: ${o.success ? 'SUCCESS' : 'FAIL'} — ${o.result.slice(0, 150)}`)
            .join('\n\n---\n\n');

        const prompt = `Review these recent outcomes and distill 3-5 high-level "Engineering Lessons" worth remembering.
Focus on: what failed and why, what patterns actually work, specific project quirks discovered.

OUTCOMES:
${outcomeSummary}

Return ONLY a JSON array of strings:
["Lesson 1: When doing X, always check Y because...", "Lesson 2: ..."]`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.3, tier: 'fast' });
            const raw = result.text;
            const match = raw.match(/\[[\s\S]*?\]/);
            if (!match) return null;

            const lessons = JSON.parse(match[0]);
            let stored = 0;

            if (kb && lessons.length > 0) {
                for (const lesson of lessons) {
                    await kb.remember(lesson, { source: 'dreaming_consolidation' });
                    stored++;
                }
            }

            // Record outcome
            this.outcomes?.record({
                agent:    'ReflectionEngine',
                action:   'dream',
                result:   `Consolidated ${stored} lessons`,
                success:  true,
                tokens:   result.metadata?.tokens || 0,
                duration: result.metadata?.latency || 0
            });

            console.log(`[ReflectionEngine] 💤 Consolidated ${stored} lessons into knowledge base`);
            return lessons;
        } catch (err) {
            console.error('[ReflectionEngine] Dream error:', err.message);
            return null;
        }
    }
}
