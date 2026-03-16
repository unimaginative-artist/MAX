// ═══════════════════════════════════════════════════════════════════════════
// FrontierResearch.js — MAX's autonomous AI research and SOMA evolution engine
//
// Daily cycle:
//   1. Crawl frontier AI research sources
//   2. Extract key ideas and mechanisms
//   3. Compare against SOMA/MAX capability map
//   4. Identify gaps and generate engineering tasks
//   5. Update plan.md, research.md, frontier_map.md, todo.md, system_report.md
//
// Called by Scheduler (every 24h) or manually via /research REPL command
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const ROOT = process.cwd();

const FILES = {
    plan:     path.join(ROOT, 'plan.md'),
    todo:     path.join(ROOT, 'todo.md'),
    research: path.join(ROOT, 'research.md'),
    frontier: path.join(ROOT, 'frontier_map.md'),
    report:   path.join(ROOT, 'system_report.md'),
};

// ── Research sources MAX crawls ────────────────────────────────────────────
const SOURCES = [
    { name: 'arXiv AI',        query: 'autonomous AI agent planning self-improvement 2025' },
    { name: 'arXiv LLM',       query: 'large language model reasoning memory tool use 2025' },
    { name: 'Papers With Code', query: 'AI agent world model skill learning benchmark 2025' },
];

export class FrontierResearch {
    constructor(brain, tools, goals, kb) {
        this.brain = brain;
        this.tools = tools;
        this.goals = goals;
        this.kb    = kb;
        this._running = false;
    }

    // ── Main cycle ────────────────────────────────────────────────────────
    async runCycle() {
        if (this._running) {
            console.log('[FrontierResearch] ⏩ Cycle already running — skipping');
            return;
        }
        this._running = true;
        console.log('[FrontierResearch] 🔬 Starting research cycle...');

        try {
            const papers   = await this._crawlResearch();
            const analysis = await this._analyzeGaps(papers);
            const tasks    = await this._generateTasks(analysis);

            await this._updateResearchMd(papers);
            await this._updateFrontierMap(analysis);
            await this._updateTodo(tasks);
            await this._updateSystemReport(analysis, tasks);

            console.log(`[FrontierResearch] ✅ Cycle complete — ${papers.length} papers, ${tasks.length} new tasks`);
            return { papers: papers.length, tasks: tasks.length, analysis };
        } catch (err) {
            console.warn('[FrontierResearch] ⚠️  Cycle error:', err.message);
            return null;
        } finally {
            this._running = false;
        }
    }

    // ── Step 1: Crawl research ─────────────────────────────────────────────
    async _crawlResearch() {
        const papers = [];
        for (const source of SOURCES) {
            try {
                const result = await this.tools.execute('web', 'search', { query: source.query });
                if (!result?.results?.length) continue;

                // Ask brain to extract structured findings from raw search results
                const raw = result.results.slice(0, 5).map(r => `${r.title}\n${r.snippet}`).join('\n\n');
                const extracted = await this.brain.think(
                    `You are analyzing AI research results. Extract the most relevant papers/ideas for building autonomous AI systems.\n\nRESULTS:\n${raw}\n\nReturn a JSON array of up to 3 objects: [{title, keyIdeas: [], mechanisms: [], somaRelevance: ""}]`,
                    { temperature: 0.3, maxTokens: 800, tier: 'smart' }
                );

                try {
                    const json = extracted.text.match(/\[[\s\S]*\]/)?.[0];
                    if (json) papers.push(...JSON.parse(json).map(p => ({ ...p, source: source.name })));
                } catch { /* malformed JSON — skip */ }
            } catch (err) {
                console.warn(`[FrontierResearch] Search failed for "${source.name}":`, err.message);
            }
        }
        return papers;
    }

    // ── Step 2: Gap analysis ───────────────────────────────────────────────
    async _analyzeGaps(papers) {
        if (!papers.length) return { gaps: [], opportunities: [] };

        const frontierMd  = this._read(FILES.frontier);
        const planMd      = this._read(FILES.plan);
        const papersBlock = papers.map(p =>
            `### ${p.title} (${p.source})\nKey ideas: ${(p.keyIdeas || []).join(', ')}\nRelevance: ${p.somaRelevance || 'unknown'}`
        ).join('\n\n');

        const result = await this.brain.think(
            `You are MAX, analyzing AI research against the SOMA/MAX system to find capability gaps.

CURRENT FRONTIER MAP:
${frontierMd.slice(0, 2000)}

CURRENT PLAN:
${planMd.slice(0, 1500)}

NEW RESEARCH:
${papersBlock}

Identify the 3 most important capability gaps revealed by this research.
For each gap, propose a specific SOMA/MAX module or improvement.

Return JSON: {
  gaps: [{capability, somaStatus, priority: "critical|high|medium", proposedModule, description}],
  opportunities: [{title, rationale, effort: "low|medium|high"}]
}`,
            { temperature: 0.4, maxTokens: 1200, tier: 'smart' }
        );

        try {
            const json = result.text.match(/\{[\s\S]*\}/)?.[0];
            return json ? JSON.parse(json) : { gaps: [], opportunities: [] };
        } catch {
            return { gaps: [], opportunities: [] };
        }
    }

    // ── Step 3: Generate engineering tasks ────────────────────────────────
    async _generateTasks(analysis) {
        if (!analysis.gaps?.length && !analysis.opportunities?.length) return [];

        const prompt = `Based on this capability analysis, generate concrete engineering tasks for SOMA/MAX.

GAPS: ${JSON.stringify(analysis.gaps?.slice(0, 3) || [])}
OPPORTUNITIES: ${JSON.stringify(analysis.opportunities?.slice(0, 3) || [])}

Generate up to 5 actionable tasks. Each must be specific enough to implement.
Return JSON array: [{title, description, priority: "high|medium|low", impact: "high|medium|low", effort: "low|medium|high", confidence: 0.0-1.0}]
Only include tasks with confidence >= 0.6.`;

        const result = await this.brain.think(prompt, { temperature: 0.4, maxTokens: 800, tier: 'smart' });

        try {
            const json = result.text.match(/\[[\s\S]*\]/)?.[0];
            const tasks = json ? JSON.parse(json) : [];
            // Quality filter: only high-confidence, meaningful tasks
            return tasks.filter(t => t.confidence >= 0.6 && t.priority !== 'low');
        } catch {
            return [];
        }
    }

    // ── File updaters ──────────────────────────────────────────────────────
    async _updateResearchMd(papers) {
        if (!papers.length) return;
        const date    = new Date().toISOString().split('T')[0];
        const entries = papers.map(p => `
### [${date}] ${p.title}
**Source:** ${p.source}

**Key Ideas**
${(p.keyIdeas || []).map(i => `- ${i}`).join('\n')}

**Core Mechanisms**
${(p.mechanisms || []).map(m => `- ${m}`).join('\n')}

**Implications for SOMA/MAX**
${p.somaRelevance || 'Pending analysis'}
`).join('\n---\n');

        const current = this._read(FILES.research);
        const updated = current.replace(
            '<!-- MAX appends new entries above this line -->',
            `${entries}\n\n<!-- MAX appends new entries above this line -->`
        );
        fs.writeFileSync(FILES.research, updated);
    }

    async _updateFrontierMap(analysis) {
        if (!analysis.gaps?.length) return;
        const date    = new Date().toISOString().split('T')[0];
        const current = this._read(FILES.frontier);

        // Update last-updated timestamp
        const updated = current.replace(
            /Last updated: .*/,
            `Last updated: ${date}`
        );

        // Append gap analysis summary
        const summary = `\n\n---\n## Gap Analysis — ${date}\n${
            (analysis.gaps || []).map(g =>
                `- **${g.capability}** [${g.priority}]: ${g.description || ''} → Proposed: ${g.proposedModule || 'TBD'}`
            ).join('\n')
        }`;

        fs.writeFileSync(FILES.frontier, updated + summary);
    }

    async _updateTodo(tasks) {
        if (!tasks.length) return;
        const current = this._read(FILES.todo);
        const newItems = tasks.map(t =>
            `- [ ] **[${t.priority}]** ${t.title} *(impact: ${t.impact}, effort: ${t.effort})*`
        ).join('\n');

        const updated = current.replace(
            '## Backlog',
            `## Backlog\n${newItems}`
        );
        fs.writeFileSync(FILES.todo, updated);

        // Also queue high-priority tasks as real MAX goals
        for (const task of tasks.filter(t => t.priority === 'high')) {
            if (this.goals) {
                this.goals.addGoal({
                    title:       task.title,
                    description: task.description,
                    priority:    0.65,
                    source:      'frontier_research',
                    type:        'improvement'
                });
            }
        }
    }

    async _updateSystemReport(analysis, tasks) {
        const date = new Date().toISOString().split('T')[0];
        const report = `# SOMA/MAX System Report
*Generated: ${date}*

---

## Detected Capability Gaps
${(analysis.gaps || []).map(g => `- **${g.capability}** [${g.priority}]: ${g.description || ''}`).join('\n') || '- None detected this cycle'}

## Opportunities Identified
${(analysis.opportunities || []).map(o => `- **${o.title}** (effort: ${o.effort}): ${o.rationale || ''}`).join('\n') || '- None'}

## Engineering Tasks Generated (${tasks.length})
${tasks.map(t => `- [${t.priority}] ${t.title}`).join('\n') || '- None met quality threshold'}

---
*Next cycle runs in 24h*
`;
        fs.writeFileSync(FILES.report, report);
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _read(filePath) {
        try { return fs.readFileSync(filePath, 'utf8'); }
        catch { return ''; }
    }

    // ── Status for /status command ─────────────────────────────────────────
    getStatus() {
        return {
            running:          this._running,
            reportExists:     fs.existsSync(FILES.report),
            lastReport:       this._read(FILES.report).match(/Generated: (.+)/)?.[1] || 'never',
            researchEntries:  (this._read(FILES.research).match(/^### \[/gm) || []).length,
        };
    }
}
