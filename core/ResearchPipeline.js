// ═══════════════════════════════════════════════════════════════════════════
// ResearchPipeline.js — Deep web research that accumulates into MAX's KB
//
// Flow: query → parallel page fetch → brain extraction → KB storage → synthesis
//
// Unlike one-shot web searches (which are used and discarded), every run of
// the pipeline stores extracted facts permanently in the KnowledgeBase so
// future conversations benefit automatically.
//
// Exposed as TOOL:research:run and TOOL:research:quick
// Also auto-called by AgentLoop when it needs to research before replanning.
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

export class ResearchPipeline extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max    = max;
        this.config = {
            maxPages:         config.maxPages         || 4,
            maxCharsPerPage:  config.maxCharsPerPage  || 6000,
            maxFactsPerPage:  config.maxFactsPerPage  || 8,
            storeInKB:        config.storeInKB        !== false,
            ...config
        };
        this.stats = { runs: 0, factsStored: 0, pagesRead: 0 };
    }

    // ─── Full research run — returns synthesis + stores in KB ─────────────
    async research(query, options = {}) {
        const maxPages        = options.maxPages        || this.config.maxPages;
        const storeInKB       = options.storeInKB       ?? this.config.storeInKB;
        const contextNote     = options.context         || '';  // extra context for extraction prompt

        console.log(`\n[Research] 🔍 Researching: "${query}" (up to ${maxPages} pages)`);
        this.stats.runs++;
        this.emit('start', { query });

        // ── 1. Search ──────────────────────────────────────────────────────
        let searchResults = [];
        try {
            const searched = await this.max.tools.execute('web', 'search', {
                query,
                maxResults: maxPages + 2  // fetch extras in case some pages fail
            });
            if (searched.success) searchResults = searched.results || [];
        } catch (err) {
            console.warn(`[Research] Search failed: ${err.message}`);
            return { success: false, query, error: err.message };
        }

        if (searchResults.length === 0) {
            return { success: false, query, error: 'No search results found' };
        }

        console.log(`[Research] 📄 Found ${searchResults.length} results — fetching top ${Math.min(maxPages, searchResults.length)}`);

        // ── 2. Fetch pages in parallel ─────────────────────────────────────
        const pagePromises = searchResults.slice(0, maxPages).map(async (r) => {
            try {
                const fetched = await this.max.tools.execute('web', 'fetch', {
                    url:      r.url,
                    maxChars: this.config.maxCharsPerPage
                });
                return fetched.success
                    ? { url: r.url, title: r.title, content: fetched.content }
                    : { url: r.url, title: r.title, content: r.snippet };  // fallback to snippet
            } catch {
                return { url: r.url, title: r.title, content: r.snippet };
            }
        });

        const pages = (await Promise.all(pagePromises)).filter(p => p.content?.length > 50);
        this.stats.pagesRead += pages.length;
        console.log(`[Research] 📚 Successfully read ${pages.length} page(s)`);

        // ── 3. Extract facts from each page via brain ──────────────────────
        const extractedFacts = [];
        const extractPromises = pages.map(async (page) => {
            const extractPrompt = `Extract the most important, concrete facts from this web page about: "${query}"
${contextNote ? `Context: ${contextNote}\n` : ''}
SOURCE: ${page.title} (${page.url})
CONTENT:
${page.content.slice(0, 4000)}

Return a JSON array of facts (max ${this.config.maxFactsPerPage}):
[
  { "fact": "concrete, specific statement", "confidence": 0.0-1.0, "source": "${page.url}" }
]

Only include facts directly relevant to "${query}". Skip navigation text, ads, boilerplate.
Return ONLY the JSON array.`;

            try {
                const result = await this.max.agentBrain.think(extractPrompt, {
                    tier:        'fast',
                    temperature: 0.1,
                    maxTokens:   500
                });
                const match = result.text.match(/\[[\s\S]*?\]/);
                if (match) {
                    const facts = JSON.parse(match[0]);
                    return facts.filter(f => f.fact && f.confidence > 0.4);
                }
            } catch { /* non-fatal — skip this page */ }
            return [];
        });

        const allPageFacts = await Promise.all(extractPromises);
        for (const pageFacts of allPageFacts) extractedFacts.push(...pageFacts);

        if (extractedFacts.length === 0) {
            console.warn(`[Research] ⚠️  No facts extracted — returning raw snippets`);
            const fallback = searchResults.slice(0, 3).map(r => r.snippet).join('\n');
            return { success: true, query, synthesis: fallback, facts: [], sources: [] };
        }

        // Deduplicate facts by content similarity (simple: check for identical starts)
        const uniqueFacts = extractedFacts.filter((f, i) =>
            !extractedFacts.slice(0, i).some(prev => prev.fact.slice(0, 60) === f.fact.slice(0, 60))
        );

        // Sort by confidence descending
        uniqueFacts.sort((a, b) => b.confidence - a.confidence);

        console.log(`[Research] 💡 Extracted ${uniqueFacts.length} unique facts`);

        // ── 4. Synthesize into a coherent summary ──────────────────────────
        const factsBlock = uniqueFacts.slice(0, 20).map(f => `• ${f.fact}`).join('\n');
        const sources    = [...new Set(uniqueFacts.map(f => f.source).filter(Boolean))];

        const synthPrompt = `Synthesize these research findings about "${query}" into 3-5 clear paragraphs.
Be concrete and specific. Include numbers, names, and technical details where present.
Avoid vague generalities.

FACTS:
${factsBlock}

Write the synthesis now:`;

        let synthesis = factsBlock;  // fallback: just return the facts
        try {
            const synthResult = await this.max.agentBrain.think(synthPrompt, {
                tier:        'smart',
                temperature: 0.3,
                maxTokens:   800
            });
            synthesis = synthResult.text;
        } catch (err) {
            console.warn(`[Research] Synthesis failed: ${err.message} — using raw facts`);
        }

        // ── 5. Store in KnowledgeBase ──────────────────────────────────────
        if (storeInKB && this.max.kb?._ready) {
            const kbEntry = `## Research: ${query}\n\n${synthesis}\n\nSources: ${sources.slice(0, 3).join(', ')}`;
            await this.max.kb.remember(kbEntry, {
                source:    'research_pipeline',
                query,
                factCount: uniqueFacts.length,
                timestamp: new Date().toISOString()
            }).catch(() => {});

            this.stats.factsStored += uniqueFacts.length;
            console.log(`[Research] 💾 Stored ${uniqueFacts.length} facts in KB`);
        }

        this.emit('done', { query, factCount: uniqueFacts.length, sources });

        return {
            success:   true,
            query,
            synthesis,
            facts:     uniqueFacts.slice(0, 15),
            sources,
            pagesRead: pages.length
        };
    }

    // ─── Quick research: search + top result only, no KB storage ──────────
    async quick(query) {
        return this.research(query, { maxPages: 1, storeInKB: false });
    }

    getStatus() {
        return { ...this.stats };
    }
}
