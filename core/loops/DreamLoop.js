// ═══════════════════════════════════════════════════════════════════════════
// DreamLoop.js — background optimization and indexing
//
// This loop runs when MAX is idle. It doesn't execute user goals.
// Instead, it "dreams" about the codebase:
//   1. Re-indexes files to keep the RepoGraph/Vector memory fresh.
//   2. Searches for "code smells" (TODOs, FIXMEs, large files, complexity).
//   3. Optimizes internal prompts based on recent success/failure patterns.
//   4. Updates the WorldModel with fresh architectural insights.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';

export class DreamLoop {
    static id = 'dream';
    static signals = ['dream', 'optimize self', 'background maintenance', 'clean up', 're-index'];
    static description = 'Background maintenance and codebase optimization. Runs when idle to keep MAX sharp.';

    /**
     * Run a dreaming/maintenance cycle.
     * @param {object} goal  The idle goal or maintenance task
     * @param {object} max   MAX instance
     * @param {object} agentLoop AgentLoop instance
     */
    async run(goal, max, agentLoop = null) {
        console.log(`\n[DreamLoop] 🌙 Dreaming...`);
        
        const findings = [];

        // ── 1. Re-index codebase ──────────────────────────────────────────
        agentLoop?.emit('progress', { goal: 'Dreaming', step: 1, total: 4, action: 'Refreshing codebase index' });
        try {
            if (max.indexer) {
                const stats = await max.indexer.indexAll?.() || { files: 0 };
                findings.push(`Re-indexed ${stats.files} files`);
            }
        } catch (err) {
            findings.push(`Indexing failed: ${err.message}`);
        }

        // ── 2. Scan for "Code Smells" ──────────────────────────────────────
        agentLoop?.emit('progress', { goal: 'Dreaming', step: 2, total: 4, action: 'Scanning for code smells' });
        try {
            const result = await max.tools.execute('shell', 'run', { 
                command: 'powershell -Command "Get-ChildItem -Recurse -Include *.js,*.mjs,*.cjs,*.md | Select-String -Pattern \'TODO|FIXME|HACK|XXX\' | Select-Object -First 20"' 
            });
            if (result.stdout) {
                const count = result.stdout.split('\n').filter(l => l.trim()).length;
                findings.push(`Found ${count} technical debt markers`);
            }
        } catch { /* non-fatal */ }

        // ── 3. Optimize internal state ─────────────────────────────────────
        agentLoop?.emit('progress', { goal: 'Dreaming', step: 3, total: 5, action: 'Refining world model and curiosity' });
        try {
            if (max.world?.refreshArchitecture) {
                await max.world.refreshArchitecture();
                findings.push('Architectural map updated');
            }
            if (max.curiosity?.refreshKnowledgeGaps) {
                await max.curiosity.refreshKnowledgeGaps(max);
                findings.push('Knowledge gaps refreshed');
            }
        } catch { /* skip */ }

        // ── 4. Sentinel Health Scan ───────────────────────────────────────
        agentLoop?.emit('progress', { goal: 'Dreaming', step: 4, total: 5, action: 'Running Sentinel health scan' });
        try {
            const sentinel = max.agentLoop?._loops?.['sentinel'];
            if (sentinel) {
                const healthRes = await sentinel.run({ title: 'Background Scan' }, max, agentLoop);
                findings.push(healthRes.summary);
            }
        } catch (err) {
            findings.push(`Sentinel failed: ${err.message}`);
        }

        // ── 5. Generative "Dreaming" — synthesis ───────────────────────────
        agentLoop?.emit('progress', { goal: 'Dreaming', step: 5, total: 5, action: 'Synthesizing insights' });
        let dreamInsight = 'I focused on maintaining system integrity.';
        if (max.brain?._ready) {
            const recentOutcomes = max.outcomes?.query?.({ limit: 5 }) || [];
            const prompt = `You are MAX. You are currently in "Dream" mode (idle background processing).
Recent activity: ${JSON.stringify(recentOutcomes.map(o => o.action + ': ' + (o.success ? '✓' : '✗')))}
Maintenance findings: ${findings.join(', ')}

In 1-2 sentences, what is one "dream" or deep architectural insight you have about this project? 
Be specific, technical, and slightly "Max Headroom" in style.`;

            const res = await max.brain.think(prompt, { tier: 'fast', temperature: 0.9, maxTokens: 150 });
            dreamInsight = res.text.trim();
        }

        const summary = findings.join(' | ');
        console.log(`[DreamLoop] ✅ Dream complete: ${dreamInsight}`);

        // Persist the dream to memory
        max.memory?.remember(dreamInsight, { source: 'dream_loop', findings: summary }, {
            type: 'reflection',
            importance: 0.4
        }).catch(() => {});

        // Emit insight
        agentLoop?.emit('insight', {
            source: 'agent',
            label:  '🌙 Dream synthesized',
            result: dreamInsight
        });

        return { goal: 'Dreaming', success: true, summary };
    }
}
