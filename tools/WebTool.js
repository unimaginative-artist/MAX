// ═══════════════════════════════════════════════════════════════════════════
// WebTool.js — web search and page fetch
// Search: DuckDuckGo HTML scraping (actual results, not the limited instant API)
// Fetch: smart HTML→text extraction that preserves structure
// Cache: 10-minute in-memory cache to avoid re-fetching the same pages
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

// 10-minute page cache
const _cache   = new Map();
const CACHE_MS = 10 * 60 * 1000;

function _cached(key, fn) {
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.ts < CACHE_MS) return Promise.resolve(hit.value);
    return fn().then(val => { _cache.set(key, { value: val, ts: Date.now() }); return val; });
}

// Strip HTML down to readable text while preserving useful structure
function _htmlToText(html, maxChars = 8000) {
    return html
        // Remove noise blocks entirely
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        // Preserve structure with newlines
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(h[1-6]|p|li|tr|div|section|article)[^>]*>/gi, '\n')
        // Strip remaining tags
        .replace(/<[^>]+>/g, '')
        // Decode common HTML entities
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(/&nbsp;/g, ' ')
        // Normalize whitespace
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g,    '\n\n')
        .trim()
        .slice(0, maxChars);
}

// Parse DuckDuckGo HTML search results page
function _parseDDGResults(html, maxResults) {
    const results = [];

    // Extract result blocks — DDG wraps each in a <div class="result">
    const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|$)/g) || [];

    for (const block of blocks) {
        if (results.length >= maxResults) break;

        // Title + URL from <a> with class result__a
        const linkMatch  = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        // Snippet from result__snippet
        const snipMatch  = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|a)>/i);

        if (!linkMatch) continue;

        const url     = linkMatch[1];
        const title   = linkMatch[2].replace(/<[^>]+>/g, '').trim();
        const snippet = snipMatch ? snipMatch[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim() : '';

        // Skip DDG internal links
        if (!url.startsWith('http') || url.includes('duckduckgo.com')) continue;

        results.push({ title, snippet, url });
    }

    return results;
}

export const WebTool = {
    name: 'web',
    description: 'The Odyssey Gateway — High-fidelity web search and deep Markdown scraping.',

    actions: {
        async search({ query, maxResults = 6 }) {
            return _cached(`search:${query}`, async () => {
                const encoded = encodeURIComponent(query);

                // ── Odyssey Layer: Priority Search (Brave) ──────────────────
                if (process.env.BRAVE_SEARCH_API_KEY) {
                    try {
                        const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${maxResults}`, {
                            headers: {
                                'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY
                            },
                            signal: AbortSignal.timeout(10000)
                        });
                        if (res.ok) {
                            const data = await res.json();
                            const results = (data.web?.results || []).map(r => ({
                                title:   r.title,
                                snippet: r.description,
                                url:     r.url
                            }));
                            if (results.length > 0) return { success: true, query, source: 'brave', results };
                        }
                    } catch (err) { console.warn(`[Odyssey] Brave search failed: ${err.message}`); }
                }

                // ── Fallback: DuckDuckGo Deep Scrape ────────────────────────
                try {
                    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
                        signal:  AbortSignal.timeout(12000),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept':     'text/html'
                        }
                    });

                    if (res.ok) {
                        const html    = await res.text();
                        const results = _parseDDGResults(html, maxResults);
                        if (results.length > 0) return { success: true, query, source: 'odyssey-ddg', results };
                    }
                } catch { /* fall through */ }

                return { success: false, query, error: 'All search layers failed' };
            });
        },

        async fetch({ url, maxChars = 15000 }) {
            return _cached(`fetch:${url}`, async () => {
                // ── THE ODYSSEY GATEWAY: Jina Reader Protocol ────────────────
                // This protocol converts ANY site (even JS-heavy ones) into clean Markdown.
                // It is the industry standard for production agents.
                try {
                    console.log(`  [Odyssey] 🌀 Deep Scrape: ${url}`);
                    const readerUrl = `https://r.jina.ai/${url}`;
                    const res = await fetch(readerUrl, {
                        signal:  AbortSignal.timeout(20000),
                        headers: {
                            'Accept': 'text/event-stream', // triggers high-fidelity mode
                            'X-No-Cache': 'true'
                        }
                    });

                    if (res.ok) {
                        const markdown = await res.text();
                        return {
                            success: true,
                            url,
                            content: markdown.slice(0, maxChars),
                            method: 'jina-odyssey',
                            length: markdown.length
                        };
                    }
                } catch (err) {
                    console.warn(`[Odyssey] Jina scrape failed: ${err.message}. Falling back...`);
                }

                // ── STANDALONE FALLBACK: Mimic Browser ───────────────────────
                try {
                    const res = await fetch(url, {
                        signal:  AbortSignal.timeout(15000),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,webp,*/*;q=0.8'
                        }
                    });

                    if (!res.ok) return { success: false, url, error: `HTTP ${res.status}` };
                    const raw = await res.text();
                    const text = _htmlToText(raw, maxChars);

                    return { success: true, url, content: text, method: 'browser-mimic' };
                } catch (err) {
                    return { success: false, url, error: err.message };
                }
            });
        },

        // Convenience: search then fetch the top result's content
        async research({ query, maxChars = 6000 }) {
            const searched = await WebTool.actions.search({ query, maxResults: 3 });
            if (!searched.success || searched.results.length === 0) {
                return { success: false, query, error: 'No results found' };
            }

            const top    = searched.results[0];
            const page   = await WebTool.actions.fetch({ url: top.url, maxChars });
            const others = searched.results.slice(1).map(r => `• ${r.title}: ${r.snippet}`).join('\n');

            return {
                success:  true,
                query,
                primary:  { ...top, content: page.content || top.snippet },
                related:  others,
                allUrls:  searched.results.map(r => r.url)
            };
        }
    }
};
