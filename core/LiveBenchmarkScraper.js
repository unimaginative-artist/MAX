// ═══════════════════════════════════════════════════════════════════════════
// LiveBenchmarkScraper.js — MAX's real‑time grounding engine
// Scrapes GitHub trending, arXiv latest, HN AI threads to know what "best" looks like
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

const GITHUB_TRENDING_URL = 'https://github.com/trending?since=weekly&spoken_language_code=en';
const ARXIV_AI_URL = 'http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=10';
const HN_AI_URL = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&query=ai%20agent&restrictSearchableAttributes=title';

class LiveBenchmarkScraper {
    constructor(max) {
        this.max = max;
        this.lastRun = null;
        this.cache = {
            github: [],
            arxiv: [],
            hackernews: []
        };
    }

    async scrapeAll() {
        console.log('[LiveBenchmarkScraper] 🔍 Starting live benchmark scrape...');
        
        const [github, arxiv, hackernews] = await Promise.allSettled([
            this.scrapeGitHubTrending(),
            this.scrapeArxivLatest(),
            this.scrapeHackerNewsAI()
        ]);

        this.cache.github = github.status === 'fulfilled' ? github.value : [];
        this.cache.arxiv = arxiv.status === 'fulfilled' ? arxiv.value : [];
        this.cache.hackernews = hackernews.status === 'fulfilled' ? hackernews.value : [];
        
        this.lastRun = new Date().toISOString();
        
        console.log(`[LiveBenchmarkScraper] ✅ Scrape complete — ${this.cache.github.length} GitHub, ${this.cache.arxiv.length} arXiv, ${this.cache.hackernews.length} HN`);
        
        // Store in MAX's knowledge graph
        await this.storeInKnowledgeGraph();
        
        return this.cache;
    }

    async scrapeGitHubTrending() {
        try {
            const res = await fetch(GITHUB_TRENDING_URL);
            const html = await res.text();
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            
            const repos = [];
            const articles = doc.querySelectorAll('article');
            
            for (const article of articles) {
                const titleEl = article.querySelector('h2 a');
                const descEl = article.querySelector('p');
                const langEl = article.querySelector('[itemprop="programmingLanguage"]');
                const starsEl = article.querySelector('a[href$="stargazers"]');
                
                if (!titleEl) continue;
                
                const title = titleEl.textContent.trim();
                const url = `https://github.com${titleEl.getAttribute('href')}`;
                const description = descEl ? descEl.textContent.trim() : '';
                const language = langEl ? langEl.textContent.trim() : '';
                const stars = starsEl ? parseInt(starsEl.textContent.trim().replace(',', '')) || 0 : 0;
                
                // Filter for AI/agent repos
                const lowerTitle = title.toLowerCase();
                const lowerDesc = description.toLowerCase();
                if (lowerTitle.includes('agent') || lowerDesc.includes('agent') || 
                    lowerTitle.includes('ai') || lowerDesc.includes('ai') ||
                    lowerTitle.includes('autonomous') || lowerDesc.includes('autonomous')) {
                    repos.push({
                        title,
                        url,
                        description,
                        language,
                        stars,
                        source: 'github_trending',
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            return repos.slice(0, 10); // Top 10 AI repos
        } catch (error) {
            console.error('[LiveBenchmarkScraper] GitHub scrape error:', error.message);
            return [];
        }
    }

    async scrapeArxivLatest() {
        try {
            const res = await fetch(ARXIV_AI_URL);
            const xml = await res.text();
            
            // Simple XML parsing (could use proper parser)
            const entries = [];
            const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
            let match;
            
            while ((match = entryRegex.exec(xml)) !== null) {
                const entry = match[1];
                
                const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
                const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
                const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
                
                if (!titleMatch || !summaryMatch || !idMatch) continue;
                
                const title = titleMatch[1].replace(/\s+/g, ' ').trim();
                const summary = summaryMatch[1].replace(/\s+/g, ' ').trim();
                const id = idMatch[1];
                
                entries.push({
                    title,
                    summary,
                    url: id,
                    source: 'arxiv_ai',
                    timestamp: new Date().toISOString()
                });
            }
            
            return entries.slice(0, 10); // Latest 10
        } catch (error) {
            console.error('[LiveBenchmarkScraper] arXiv scrape error:', error.message);
            return [];
        }
    }

    async scrapeHackerNewsAI() {
        try {
            const res = await fetch(HN_AI_URL);
            const data = await res.json();
            
            const stories = data.hits
                .filter(hit => hit.title && (hit.title.toLowerCase().includes('ai') || hit.title.toLowerCase().includes('agent')))
                .map(hit => ({
                    title: hit.title,
                    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
                    points: hit.points || 0,
                    comments: hit.num_comments || 0,
                    source: 'hackernews',
                    timestamp: hit.created_at
                }))
                .slice(0, 10); // Top 10
            
            return stories;
        } catch (error) {
            console.error('[LiveBenchmarkScraper] HN scrape error:', error.message);
            return [];
        }
    }

    async storeInKnowledgeGraph() {
        if (!this.max?.knowledgeGraph) return;
        
        const allItems = [
            ...this.cache.github.map(item => ({ ...item, type: 'github_repo' })),
            ...this.cache.arxiv.map(item => ({ ...item, type: 'arxiv_paper' })),
            ...this.cache.hackernews.map(item => ({ ...item, type: 'hn_story' }))
        ];
        
        for (const item of allItems) {
            await this.max.knowledgeGraph.addFact({
                subject: 'state_of_the_art',
                predicate: 'benchmark_item',
                object: JSON.stringify(item),
                confidence: 0.8,
                source: 'LiveBenchmarkScraper',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log(`[LiveBenchmarkScraper] 📊 Stored ${allItems.length} benchmark items in knowledge graph`);
    }

    generateGapAnalysis() {
        const topFrameworks = this.cache.github
            .filter(repo => repo.stars > 1000)
            .map(repo => repo.title);
        
        const latestTechniques = this.cache.arxiv
            .map(paper => paper.title)
            .join(' ')
            .toLowerCase();
        
        const gaps = [];
        
        // Check for multi‑agent orchestration
        if (!latestTechniques.includes('multi‑agent') && !latestTechniques.includes('multi agent')) {
            gaps.push('Multi‑agent orchestration (AutoGen/LangGraph style)');
        }
        
        // Check for self‑improvement
        if (!latestTechniques.includes('self‑improvement') && !latestTechniques.includes('self improvement')) {
            gaps.push('Recursive self‑improvement loop');
        }
        
        // Check for emergent tool use
        if (!latestTechniques.includes('emergent tool') && !latestTechniques.includes('tool use')) {
            gaps.push('Emergent tool discovery/sharing');
        }
        
        return {
            topFrameworks,
            gaps,
            lastUpdated: this.lastRun
        };
    }
}

export default LiveBenchmarkScraper;