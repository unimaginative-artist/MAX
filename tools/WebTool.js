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
    description: 'Search the web and fetch page content',

    actions: {
        async search({ query, maxResults = 6 }) {
            return _cached(`search:${query}`, async () => {
                const encoded = encodeURIComponent(query);

                // Try DuckDuckGo HTML (real results, not instant API)
                try {
                    const res = await fetch(
                        `https://html.duckduckgo.com/html/?q=${encoded}&kl=us-en`,
                        {
                            signal:  AbortSignal.timeout(12000),
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (compatible; MAX-Agent/1.0)',
                                'Accept':     'text/html'
                            }
                        }
                    );

                    if (res.ok) {
                        const html    = await res.text();
                        const results = _parseDDGResults(html, maxResults);
                        if (results.length > 0) {
                            return { success: true, query, source: 'duckduckgo', results };
                        }
                    }
                } catch { /* fall through */ }

                // Fallback: DuckDuckGo instant answer API
                try {
                    const res  = await fetch(
                        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
                        { signal: AbortSignal.timeout(8000) }
                    );
                    const data = await res.json();
                    const results = [];

                    if (data.AbstractText) {
                        results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
                    }
                    for (const r of (data.RelatedTopics || []).slice(0, maxResults - results.length)) {
                        if (r.Text && r.FirstURL) {
                            results.push({ title: r.Text.split(' - ')[0] || r.Text, snippet: r.Text, url: r.FirstURL });
                        }
                    }

                    return { success: true, query, source: 'ddg-instant', results: results.slice(0, maxResults) };
                } catch (err) {
                    return { success: false, query, error: err.message, results: [] };
                }
            });
        },

        async fetch({ url, maxChars = 8000 }) {
            return _cached(`fetch:${url}`, async () => {
                try {
                    const res = await fetch(url, {
                        signal:  AbortSignal.timeout(15000),
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; MAX-Agent/1.0)',
                            'Accept':     'text/html,text/plain'
                        }
                    });

                    if (!res.ok) return { success: false, url, error: `HTTP ${res.status}` };

                    const contentType = res.headers.get('content-type') || '';
                    if (!contentType.includes('text')) {
                        return { success: false, url, error: 'Non-text content type' };
                    }

                    const raw  = await res.text();
                    const text = _htmlToText(raw, maxChars);

                    return {
                        success:   true,
                        url,
                        content:   text,
                        truncated: raw.length > maxChars,
                        length:    text.length
                    };
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
