import fs from 'fs/promises';
import path from 'path';

/**
 * SkillEvolutionArbiter.js — The "Meta-Learner" for MAX's skills.
 * 
 * It monitors the OutcomeTracker and SkillLibrary to:
 * 1. Detect recurring sequences of tool calls that aren't yet skills.
 * 2. Suggest "Skill Promotions" for complex but successful procedures.
 * 3. Propose tool refinements when a skill is "brittle" (fails after 1-2 successes).
 */
export class SkillEvolutionArbiter {
    constructor(max) {
        this.max = max;
        this.stats = {
            totalAnalyses: 0,
            promotionsSuggested: 0,
            refinementsSuggested: 0
        };
    }

    /**
     * Scans recent outcomes to find "The Winning Path" for a task.
     */
    async analyzeWinningPaths() {
        if (!this.max.outcomes || !this.max.brain?._ready) return;
        this.stats.totalAnalyses++;

        const recentOutcomes = this.max.outcomes.query({ limit: 50, success: true });
        if (recentOutcomes.length < 5) return;

        console.log(`[SkillEvolution] 🧬 Analyzing ${recentOutcomes.length} successful paths...`);

        const outcomeText = recentOutcomes
            .map(o => `Goal: ${o.context?.title || o.action}\nResult: ${o.result.slice(0, 200)}`)
            .join('\n\n---\n\n');

        const prompt = `You are MAX's Skill Evolution Arbiter. 
Analyze these successful task outcomes and identify any RECURRING or COMPLEX procedures that should be codified as a permanent SKILL.

SUCCESSFUL PATHS:
${outcomeText}

Look for:
- Sequences of 3+ tool calls that achieved a significant goal.
- Procedures that seem "manual" but worked well (e.g., searching docs, then writing a specific config).
- Complex refactor patterns.

Return ONLY a JSON array of skill proposals:
[
  {
    "name": "snake_case_name",
    "trigger": "when to use this",
    "summary": "what it does",
    "priority": 0.1-1.0
  }
]
If nothing worth codifying is found, return "[]".`;

        try {
            const res = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.2 });
            const match = res.text.match(/\[[\s\S]*\]/);
            if (match) {
                const proposals = JSON.parse(match[0]);
                for (const prop of proposals) {
                    if (prop.priority > 0.7) {
                        console.log(`[SkillEvolution] ✨ Proposing Skill Evolution: "${prop.name}"`);
                        this.stats.promotionsSuggested++;
                        // We don't have the full step list here, so we queue a goal for MAX to "codify" it
                        this.max.goals.addGoal({
                            title: `Codify Skill: ${prop.name}`,
                            description: `Codify the successful procedure for "${prop.summary}" into the SkillLibrary. 
Context: ${prop.trigger}. 
Look at recent successful outcomes for "${prop.name}" to extract the winning steps.`,
                            type: 'improvement',
                            priority: prop.priority,
                            source: 'skill_evolution'
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[SkillEvolution] Analysis failed:', err.message);
        }
    }

    getStatus() {
        return { ...this.stats };
    }
}
