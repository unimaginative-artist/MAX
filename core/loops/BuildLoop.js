// ═══════════════════════════════════════════════════════════════════════════
// BuildLoop.js — adversarial engineering cycle (real execution)
//
// Phases:
//   1. Research  — grep + read relevant files; inject SOMA context if needed
//   2. Draft     — brain generates a concrete implementation plan
//   3. Debate    — DebateEngine adversarially challenges the plan
//   4. Refine    — if MODIFY, apply verdict conditions to the plan
//   5. Execute   — max.taskThink() → LLM calls file.patch/write/replace for real
//   6. Verify    — git diff evidence + optional verifyCommand
// ═══════════════════════════════════════════════════════════════════════════

import { commandPolicy } from '../CommandPolicyEngine.js';
import fs   from 'fs/promises';
import path from 'path';

// Where SOMA lives — override with SOMA_ROOT env var if you move it
const SOMA_ROOT = process.env.SOMA_ROOT
    || path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'SOMA');

export class BuildLoop {
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
                    agent: 'BuildLoop', action: 'build:rejected',
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

        // ── Phase 4: Execute with real tool calls ─────────────────────────
        const execResult = await this._execute(goal, finalPlan, research, max);
        console.log(`  [BuildLoop] ⚡ Execution complete (${execResult.modifiedFiles?.length ?? 0} files changed)`);

        // ── Phase 5: Verify ───────────────────────────────────────────────
        const verified = await this._verify(goal, execResult, max);
        console.log(`  [BuildLoop] ${verified ? '✅' : '⚠️ '} Verification: ${verified ? 'passed' : 'unclear'}`);

        max.outcomes?.record({
            agent:   'BuildLoop',
            action:  `build:${goal.type}`,
            context: { title: goal.title, plan: finalPlan.slice(0, 120) },
            result:  execResult.summary,
            success: verified,
            reward:  verified ? 0.9 : 0.3
        });

        return { goal: goal.title, success: verified, summary: execResult.summary };
    }

    // ── Phase 1: Research — grep + read relevant files ────────────────────
    async _research(goal, max) {
        const fileContents = {};
        const goalText = goal.title + ' ' + (goal.description || '');

        // Grep for keywords — finds real files rather than guessing paths
        const keywords = goalText
            .split(/\s+/)
            .filter(w => w.length > 4 && /^[a-zA-Z]/.test(w))
            .slice(0, 4)
            .join('|');

        if (keywords) {
            try {
                const grepResult = await max.tools.execute('file', 'grep', {
                    pattern:    keywords,
                    filePattern: '.js',
                    maxResults: 20,
                    ignoreCase: true
                });
                const files = [...new Set((grepResult?.matches || []).map(m => m.file))].slice(0, 5);
                for (const f of files) {
                    const r = await max.tools.execute('file', 'read', { filePath: f, maxLines: 200 }).catch(() => null);
                    if (r?.content) fileContents[f] = r.content.slice(0, 3000);
                }
            } catch { /* non-fatal */ }
        }

        // Also read any explicitly mentioned file paths
        for (const filePath of this._extractFilePaths(goalText).slice(0, 4)) {
            if (fileContents[filePath]) continue;
            const r = await max.tools.execute('file', 'read', { filePath }).catch(() => null);
            if (r?.content) fileContents[filePath] = r.content.slice(0, 3000);
        }

        // SOMA context: if working on SOMA code, inject CLAUDE.md architecture
        const isSomaTask = goalText.toLowerCase().includes('soma')
            || Object.keys(fileContents).some(f => f.toLowerCase().includes('soma'));

        if (isSomaTask) {
            try {
                const claudeMd = await fs.readFile(path.join(SOMA_ROOT, 'CLAUDE.md'), 'utf8');
                fileContents['SOMA/CLAUDE.md'] = claudeMd.slice(0, 4000);
                console.log(`  [BuildLoop] 🧠 SOMA context loaded`);
            } catch { /* SOMA not mounted or CLAUDE.md missing */ }
        }

        return fileContents;
    }

    // ── Phase 2: Generate a concrete implementation plan ─────────────────
    async _draft(goal, research, max) {
        const codeBlock = Object.entries(research)
            .filter(([k]) => k !== 'SOMA/CLAUDE.md')
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

    // ── Phase 4: Execute — MAX actually calls tools to implement the plan ─
    // This is the critical phase. Uses taskThink() so the LLM runs in the
    // full agentic loop and calls file.grep/read/patch/write for real.
    // brain.think() would just describe what to do — taskThink() does it.
    async _execute(goal, plan, research, max) {
        const goalText = goal.title + ' ' + (goal.description || '');
        const isSomaTask = goalText.toLowerCase().includes('soma')
            || Object.keys(research).some(f => f.toLowerCase().includes('soma'));

        const codeContext = Object.entries(research)
            .filter(([k]) => k !== 'SOMA/CLAUDE.md')
            .map(([p, c]) => `FILE: ${p}\n${c.slice(0, 1500)}`)
            .join('\n\n');

        const somaNote = isSomaTask
            ? `\n\nSOMA files are at ${SOMA_ROOT}. Use absolute paths for all SOMA edits.` +
              (research['SOMA/CLAUDE.md']
                  ? `\n\nSOMA ARCHITECTURE (summary):\n${research['SOMA/CLAUDE.md'].slice(0, 1500)}`
                  : '')
            : '';

        const prompt =
            `You are executing an engineering task. Use your tools to implement the changes — ` +
            `DO NOT describe what you would do, actually DO it with TOOL: calls.\n\n` +
            `GOAL: ${goal.title}\n` +
            (goal.description ? `DETAILS: ${goal.description}\n\n` : '\n') +
            `APPROVED PLAN:\n${plan}\n\n` +
            (codeContext ? `CURRENT CODE:\n${codeContext}\n\n` : '') +
            somaNote + '\n\n' +
            `STRATEGY: grep to find exact text → read specific lines → patch to change.\n` +
            `When finished, output: "DONE: [one paragraph describing exactly what was changed and where]"`;

        console.log(`  [BuildLoop] 🤖 Executing via taskThink (agentic tool loop)...`);
        const result = await max.taskThink(prompt, { temperature: 0.15, maxTokens: 8192, tier: 'code' });

        // Extract which files were modified from tool calls
        const modifiedFiles = [...new Set(
            (result.toolCallsMade || [])
                .filter(t => /TOOL:file:(write|replace|patch)/.test(t))
                .map(t => { const m = t.match(/"filePath"\s*:\s*"([^"]+)"/); return m?.[1]; })
                .filter(Boolean)
        )];

        // Notify SOMA if we touched SOMA files and SOMA is online
        const somaFiles = modifiedFiles.filter(f => f.toLowerCase().includes('soma'));
        if (somaFiles.length > 0 && max.soma?.available) {
            for (const f of somaFiles) {
                console.log(`  [BuildLoop] 📡 Notifying SOMA: ${path.basename(f)} changed`);
                await max.soma.notifyFileChanged(f).catch(() => {});
            }
        }

        return { summary: result.text, modifiedFiles };
    }

    // ── Phase 5: Verify — check git diff + optional verifyCommand ─────────
    async _verify(goal, execResult, max) {
        // Nothing modified → fail fast (unless summary says it was already correct)
        if (execResult.modifiedFiles?.length === 0) {
            const alreadyDone = /already|no change|nothing to|up.to.date/i.test(execResult.summary || '');
            if (!alreadyDone) return false;
        }

        // If goal has an explicit shell verify command, run it
        if (goal.verifyCommand) {
            const r = await this._runChecked(goal.verifyCommand, max);
            if (r !== null) return r.success;
        }

        // Git diff — real evidence of what actually changed
        let diffEvidence = '';
        try {
            const r = await max.tools.execute('shell', 'run', { command: 'git diff --stat HEAD', timeoutMs: 10_000 });
            if (r?.stdout) diffEvidence = r.stdout.slice(0, 400);
        } catch { /* non-fatal */ }

        const result = await max.brain.think(
            `Did this action successfully complete the goal?\n\n` +
            `GOAL: ${goal.title}\n` +
            `ACTION TAKEN: ${(execResult.summary || '').slice(0, 600)}\n` +
            (diffEvidence ? `GIT DIFF:\n${diffEvidence}\n` : '') +
            `\nReply with only YES or NO.`,
            { temperature: 0.0, maxTokens: 10, tier: 'fast' }
        );
        return result.text.trim().toUpperCase().startsWith('Y');
    }

    // ── Policy-gated shell ────────────────────────────────────────────────
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
