// ═══════════════════════════════════════════════════════════════════════════
// ReflectLoop.js — metacognitive self-improvement mode
//
// Runs when MAX has an "improvement" goal. Instead of executing steps,
// MAX looks inward: reviews what has been failing, why, and generates
// specific improvement goals. Also prunes dead/stale goals.
//
// This is what makes MAX smarter over time rather than just more active.
// ═══════════════════════════════════════════════════════════════════════════

const STALE_AFTER_MS     = 7 * 24 * 60 * 60 * 1000;  // 7 days
const MAX_STALE_ATTEMPTS = 5;
const VALID_GOAL_TYPES   = new Set(['task', 'research', 'improvement', 'fix']);

export class ReflectLoop {
    /**
     * Run a reflection/improvement goal.
     * @param {object} goal  GoalEngine goal object
     * @param {object} max   MAX instance
     */
    async run(goal, max) {
        console.log(`\n[ReflectLoop] 🪞 "${goal.title}"`);

        const findings = [];

        // ── 1. Trigger deep reflection if ReflectionEngine is available ───
        if (max.reflection?._deepReflect) {
            try {
                await max.reflection._deepReflect();
                findings.push('Deep reflection completed');
            } catch (err) {
                findings.push(`Reflection engine skipped: ${err.message}`);
            }
        }

        // ── 2. Analyze recent failures → generate improvement goals ───────
        const improvementGoalsAdded = await this._analyzeAndImprove(goal, max);
        if (improvementGoalsAdded > 0) {
            findings.push(`Generated ${improvementGoalsAdded} improvement goal(s)`);
        }

        // ── 3. Prune stale/unresolvable goals ─────────────────────────────
        const pruned = this._pruneStaleGoals(max);
        if (pruned > 0) {
            findings.push(`Pruned ${pruned} stale goal(s)`);
        }

        // ── 4. Long-horizon alignment — inject vision-aligned goals ──────
        if (max.longHorizon) {
            try {
                const visionResult = await max.longHorizon.synthesize(max);
                if (visionResult) findings.push(visionResult);
            } catch { /* non-fatal */ }
        }

        // ── 5. Build self-model insight ───────────────────────────────────
        const insight = await this._buildInsight(max);
        if (insight) {
            findings.push(`Self-model updated: ${insight}`);
            max.memory?.remember(insight, { source: 'reflect_loop', type: 'self_model' }, {
                type:       'reflection',
                importance: 0.6
            }).catch(() => {});
        }

        const summary = findings.join(' | ') || 'Reflection complete, no changes needed';

        console.log(`[ReflectLoop] ✅ ${summary}`);

        max.outcomes?.record({
            agent:   'ReflectLoop',
            action:  'reflect:self-improvement',
            context: { title: goal.title },
            result:  summary,
            success: true,
            reward:  0.5
        });

        return { goal: goal.title, success: true, summary };
    }

    // ── Analyze outcome failures → add targeted improvement goals ─────────
    async _analyzeAndImprove(goal, max) {
        if (!max.brain?._ready || !max.outcomes) return 0;

        const recent = max.outcomes.query?.({ limit: 30 }) || [];
        const failed = recent.filter(o => !o.success).slice(0, 10);

        if (failed.length === 0) return 0;

        const failSummary = failed
            .map(o => `• [${o.action}] ${(o.result || 'unknown failure').slice(0, 100)}`)
            .join('\n');

        const analysis = await max.brain.think(
            `You are MAX's metacognitive system. Analyze these recent failures.\n\n` +
            `FAILURES:\n${failSummary}\n\n` +
            `Identify 1-3 specific, actionable improvement goals. Each should address a root cause.\n\n` +
            `Return ONLY a JSON array:\n` +
            `[{"title": "...", "description": "why + what to change", "type": "improvement"}]\n` +
            `If no clear improvements are needed, return [].`,
            { temperature: 0.3, maxTokens: 500, tier: 'fast' }
        );

        try {
            const match = analysis.text.match(/\[[\s\S]*\]/);
            if (!match) return 0;
            const goals = JSON.parse(match[0]);
            if (!Array.isArray(goals)) return 0;
            let added = 0;
            for (const g of goals.slice(0, 3)) {
                if (!this._validateGoalShape(g)) {
                    console.warn(`[ReflectLoop] ⚠️ Skipped invalid goal shape: ${JSON.stringify(g).slice(0, 80)}`);
                    continue;
                }
                max.goals?.addGoal({
                    title:       g.title.trim().slice(0, 120),
                    description: (g.description || '').slice(0, 500),
                    type:        VALID_GOAL_TYPES.has(g.type) ? g.type : 'improvement',
                    source:      'reflection',
                    priority:    0.35
                });
                added++;
            }
            return added;
        } catch {
            return 0;
        }
    }

    // ── Schema validator for brain-generated goals ────────────────────────
    _validateGoalShape(g) {
        if (!g || typeof g !== 'object' || Array.isArray(g)) return false;
        if (typeof g.title !== 'string') return false;
        if (g.title.trim().length < 4 || g.title.length > 200) return false;
        return true;
    }

    // ── Remove goals that have failed too many times or gone stale ────────
    _pruneStaleGoals(max) {
        if (!max.goals?._active) return 0;

        const now = Date.now();
        let pruned = 0;

        for (const [id, g] of max.goals._active) {
            const isStale    = g.updatedAt && (now - g.updatedAt) > STALE_AFTER_MS;
            const isExhausted = g.attempts > MAX_STALE_ATTEMPTS;

            if (isStale && isExhausted) {
                max.goals._active.delete(id);
                max.goals._failed?.push({
                    ...g,
                    outcome:  `pruned by ReflectLoop — stale after ${g.attempts} attempts`,
                    endedAt:  now
                });
                pruned++;
            }
        }

        if (pruned > 0 && max.goals._save) max.goals._save();
        return pruned;
    }

    // ── Synthesize a one-line self-model update ───────────────────────────
    async _buildInsight(max) {
        if (!max.brain?._ready) return null;

        const selfModel = max.reflection?._selfModel;
        if (!selfModel) return null;

        const weaknesses = (selfModel.weaknesses || []).slice(0, 3).join(', ') || 'none identified';
        const strengths  = (selfModel.strengths  || []).slice(0, 3).join(', ') || 'none identified';

        const result = await max.brain.think(
            `Based on these observations about MAX's performance, write one sentence insight:\n\n` +
            `Strengths: ${strengths}\nWeaknesses: ${weaknesses}\n\n` +
            `One sentence, first person, specific and actionable. No padding.`,
            { temperature: 0.4, maxTokens: 80, tier: 'fast' }
        );

        return result.text.trim();
    }
}
