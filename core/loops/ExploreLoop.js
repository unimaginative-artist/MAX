// ═══════════════════════════════════════════════════════════════════════════
// ExploreLoop.js — read-only investigation mode
//
// When MAX's goal is to understand something rather than change something,
// this loop fires instead of the default execute-steps path.
//
// Policy: NO writes, NO shell commands. Memory + files + web + brain only.
// Output is a synthesis that gets stored in kb + memory for future loops.
// ═══════════════════════════════════════════════════════════════════════════

export class ExploreLoop {
    /**
     * Run an exploration goal.
     * @param {object} goal  GoalEngine goal object
     * @param {object} max   MAX instance (brain, tools, memory, kb)
     */
    async run(goal, max) {
        console.log(`\n[ExploreLoop] 🔭 "${goal.title}"`);

        const context = [];

        // ── 1. Recall relevant memories ──────────────────────────────────
        try {
            const hits = await max.memory?.recall?.(goal.title, { topK: 5 }) || [];
            const relevant = hits.filter(h => (h.score ?? 1) > 0.4).slice(0, 4);
            if (relevant.length > 0) {
                context.push(
                    `RECALLED MEMORIES:\n` +
                    relevant.map(h => (h.content || h.text || '').slice(0, 400)).join('\n---\n')
                );
            }
        } catch { /* non-fatal */ }

        // ── 2. Read files mentioned in goal ──────────────────────────────
        const mentionedPaths = this._extractFilePaths(goal.title + ' ' + (goal.description || ''));
        for (const filePath of mentionedPaths.slice(0, 3)) {
            try {
                const result = await max.tools.execute('file', 'read', { filePath });
                if (result?.content) {
                    context.push(`FILE: ${filePath}\n${result.content.slice(0, 2000)}`);
                }
            } catch { /* file might not exist — skip */ }
        }

        // ── 3. Search web if goal needs external knowledge ────────────────
        if (this._needsWebSearch(goal.title)) {
            try {
                const webResult = await max.tools.execute('web', 'search', { query: goal.title });
                if (webResult) {
                    const text = typeof webResult === 'string'
                        ? webResult
                        : JSON.stringify(webResult);
                    context.push(`WEB RESEARCH:\n${text.slice(0, 2000)}`);
                }
            } catch { /* web offline — skip */ }
        }

        // ── 4. Synthesize all gathered context ────────────────────────────
        const contextBlock = context.length > 0
            ? `GATHERED CONTEXT:\n${context.join('\n\n')}\n\n`
            : '';

        const synthesis = await max.brain.think(
            `Exploration goal: "${goal.title}"\n` +
            (goal.description ? `Details: ${goal.description}\n\n` : '') +
            contextBlock +
            `Synthesize into a clear, actionable finding. What did you discover? What are the key takeaways and implications?`,
            {
                systemPrompt: `You are MAX in Explore mode. Synthesize research into precise, actionable findings. No padding.`,
                temperature:  0.3,
                maxTokens:    800,
                tier:         'fast'
            }
        );

        const summary = synthesis.text;

        // ── 5. Persist finding ────────────────────────────────────────────
        const meta = { source: 'explore_loop', goal: goal.title };
        max.kb?.remember(summary, meta).catch(() => {});
        max.memory?.remember(summary, meta, { type: 'research', importance: 0.7 }).catch(() => {});

        // Push finding to SOMA's memory for bidirectional knowledge sharing
        if (max.soma?.available) {
            max.soma.remember(`MAX explored: "${goal.title}". ${summary.slice(0, 400)}`, meta).catch(() => {});
        }

        console.log(`[ExploreLoop] ✅ Exploration complete — ${summary.length} chars synthesized`);

        return { goal: goal.title, success: true, summary };
    }

    // Extract file-path-like tokens from text (rough heuristic)
    _extractFilePaths(text) {
        const raw = text.match(
            /(?:\.\/|\.\.\/|\/|[A-Za-z]:\\)(?:[\w\-. /\\]+\/)*[\w\-]+\.\w{1,6}/g
        ) || [];
        return [...new Set(raw)].filter(p => !p.startsWith('http'));
    }

    _needsWebSearch(title) {
        const t = title.toLowerCase();
        return ['latest', 'current', 'news', 'documentation', 'docs', 'api reference',
                'library', 'package', 'version', 'release', 'tutorial', 'changelog'
               ].some(k => t.includes(k));
    }
}
