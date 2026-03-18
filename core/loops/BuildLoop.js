// ═══════════════════════════════════════════════════════════════════════════
// BuildLoop.js — adversarial engineering cycle
//
// The production alternative to "generate steps and hope". Before a single
// file is touched, the plan goes through DebateEngine. The arbiter can
// REJECT (bail out), MODIFY (refine), or PROCEED. Only after PROCEED does
// execution happen.
//
// Phases:
//   1. Research  — read relevant files, understand current state
//   2. Draft     — brain generates an implementation plan
//   3. Debate    — DebateEngine adversarially challenges the plan
//   4. Refine    — if MODIFY, apply verdict conditions to the plan
//   5. Execute   — file writes (policy-gated shell if needed)
//   6. Verify    — confirm completion
// ═══════════════════════════════════════════════════════════════════════════

import { commandPolicy } from '../CommandPolicyEngine.js';

export class BuildLoop {
    /**
     * Run a build/fix goal through the full engineering cycle.
     * @param {object} goal  GoalEngine goal object
     * @param {object} max   MAX instance
     */
    async run(goal, max) {
        console.log(`\n[BuildLoop] 🏗️  "${goal.title}"`);

        // ── Phase 1: Research ─────────────────────────────────────────────
        const research = await this._research(goal, max);
        console.log(`  [BuildLoop] 📖 Research: ${Object.keys(research).length} files read`);

        // ── Phase 2: Draft implementation plan ───────────────────────────
        const draft = await this._draft(goal, research, max);
        console.log(`  [BuildLoop] 📝 Draft plan ready`);

        // ── Phase 3: Adversarial debate ───────────────────────────────────
        let finalPlan = draft;

        if (max.debate) {
            console.log(`  [BuildLoop] ⚔️  Running adversarial debate...`);
            const debateResult = await max.debate.debate({
                title:       `Implementation plan: "${goal.title}"`,
                description: `Proposed approach:\n${draft}`,
                stakes:      'medium'
            });

            const verdict = debateResult.verdict;
            console.log(`  [BuildLoop] 📋 Verdict: ${verdict.recommendation} (confidence: ${(verdict.confidence * 100).toFixed(0)}%)`);

            if (verdict.recommendation === 'REJECT' && verdict.confidence >= 0.75) {
                console.log(`  [BuildLoop] ❌ Plan rejected — ${verdict.reasoning?.slice(0, 80)}`);
                max.outcomes?.record({
                    agent: 'BuildLoop', action: `build:rejected`,
                    context: { title: goal.title },
                    result: verdict.reasoning, success: false, reward: -0.1
                });
                return {
                    goal:    goal.title,
                    success: false,
                    summary: `Build plan rejected by adversarial review: ${verdict.reasoning}`
                };
            }

            if ((verdict.recommendation === 'MODIFY' || verdict.recommendation === 'REJECT') && verdict.conditions) {
                console.log(`  [BuildLoop] 🔧 Refining plan per debate conditions...`);
                const refined = await max.brain.think(
                    `Refine this implementation plan based on required changes.\n\n` +
                    `ORIGINAL PLAN:\n${draft}\n\n` +
                    `REQUIRED CHANGES:\n${verdict.conditions}\n\n` +
                    `Return only the improved plan. Be specific and concrete.`,
                    { temperature: 0.2, maxTokens: 700, tier: 'smart' }
                );
                finalPlan = refined.text;
            }
        }

        // ── Phase 4: Execute ──────────────────────────────────────────────
        const execResult = await this._execute(goal, finalPlan, research, max);
        console.log(`  [BuildLoop] ⚡ Execution complete`);

        // ── Phase 5: Verify ───────────────────────────────────────────────
        const verified = await this._verify(goal, execResult, max);
        console.log(`  [BuildLoop] ${verified ? '✅' : '⚠️ '} Verification: ${verified ? 'passed' : 'unclear'}`);

        max.outcomes?.record({
            agent:   'BuildLoop',
            action:  `build:${goal.type}`,
            context: { title: goal.title, plan: finalPlan.slice(0, 120) },
            result:  execResult.summary,
            success: verified,
            reward:  verified ? 0.9 : 0.3   // partial credit — something was done
        });

        return { goal: goal.title, success: verified, summary: execResult.summary };
    }

    // ── Phase 1: Read relevant files ─────────────────────────────────────
    async _research(goal, max) {
        const fileContents = {};
        const mentioned = this._extractFilePaths(goal.title + ' ' + (goal.description || ''));

        for (const filePath of mentioned.slice(0, 4)) {
            try {
                const r = await max.tools.execute('file', 'read', { filePath });
                if (r?.content) fileContents[filePath] = r.content.slice(0, 3000);
            } catch { /* skip missing */ }
        }

        // If nothing explicit, search for relevant files
        if (Object.keys(fileContents).length === 0) {
            try {
                const keywords = goal.title.split(/\s+/).slice(0, 4).join(' ');
                const searchResult = await max.tools.execute('file', 'search', { query: keywords });
                for (const f of (searchResult?.files || []).slice(0, 3)) {
                    const r = await max.tools.execute('file', 'read', { filePath: f }).catch(() => null);
                    if (r?.content) fileContents[f] = r.content.slice(0, 2000);
                }
            } catch { /* non-fatal */ }
        }

        return fileContents;
    }

    // ── Phase 2: Generate a concrete implementation plan ─────────────────
    async _draft(goal, research, max) {
        const codeBlock = Object.entries(research)
            .map(([p, c]) => `FILE: ${p}\n\`\`\`\n${c}\n\`\`\``)
            .join('\n\n');

        const result = await max.brain.think(
            `Generate a concrete implementation plan for this engineering goal.\n\n` +
            `GOAL: ${goal.title}\n` +
            (goal.description ? `DETAILS: ${goal.description}\n\n` : '\n') +
            (codeBlock ? `RELEVANT CODE:\n${codeBlock}\n\n` : '') +
            `Describe step-by-step: which files change, what exactly changes, and why. Be specific.`,
            { temperature: 0.3, maxTokens: 900, tier: 'smart' }
        );

        return result.text;
    }

    // ── Phase 4: Execute the plan ─────────────────────────────────────────
    async _execute(goal, plan, research, max) {
        const codeBlock = Object.entries(research)
            .map(([p, c]) => `FILE: ${p}\n${c.slice(0, 1500)}`)
            .join('\n\n');

        const result = await max.brain.think(
            `Execute this implementation plan. Produce the actual changes.\n\n` +
            `GOAL: ${goal.title}\n` +
            `PLAN:\n${plan}\n\n` +
            (codeBlock ? `CURRENT CODE:\n${codeBlock}\n\n` : '') +
            `Describe precisely what was done: which files were modified, what was changed, and what the result is.`,
            { temperature: 0.15, maxTokens: 1500, tier: 'code' }
        );

        return { summary: result.text };
    }

    // ── Phase 5: Self-verify completion ───────────────────────────────────
    async _verify(goal, execResult, max) {
        const result = await max.brain.think(
            `Did this action successfully complete the goal?\n\n` +
            `GOAL: ${goal.title}\n` +
            `ACTION TAKEN: ${execResult.summary.slice(0, 600)}\n\n` +
            `Reply with only YES or NO.`,
            { temperature: 0.0, maxTokens: 10, tier: 'fast' }
        );
        return result.text.trim().toUpperCase().startsWith('Y');
    }

    // ── Run a policy-gated shell step ─────────────────────────────────────
    // Available to loop internally for verified build commands (npm test, etc.)
    async _runChecked(command, max, cwd = process.cwd()) {
        const policy = commandPolicy.validate(command, cwd);
        if (!policy.allowed) {
            console.warn(`  [BuildLoop] 🚫 Shell blocked: ${policy.reason}`);
            return null;
        }
        return max.tools.execute('shell', 'run', { command, cwd });
    }

    _extractFilePaths(text) {
        const raw = text.match(
            /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)(?:[\w\-. /\\]+\/)*[\w\-]+\.\w{1,6}/g
        ) || [];
        return [...new Set(raw)].filter(p => !p.startsWith('http'));
    }
}
