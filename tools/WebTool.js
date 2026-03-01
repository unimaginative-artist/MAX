// ═══════════════════════════════════════════════════════════════════════════
// WebTool.js — web search and page fetch
// Search via DuckDuckGo (no API key needed) + raw page fetch
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export const WebTool = {
    name: 'web',
    description: 'Search the web and fetch page content',

    actions: {
        async search({ query, maxResults = 5 }) {
            // DuckDuckGo instant answer API — no key needed
            const encoded = encodeURIComponent(query);
            const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

            try {
                const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

                return { success: true, query, results: results.slice(0, maxResults) };
            } catch (err) {
                return { success: false, query, error: err.message };
            }
        },

        async fetch({ url, maxChars = 8000 }) {
            try {
                const res = await fetch(url, {
                    signal: AbortSignal.timeout(15000),
                    headers: { 'User-Agent': 'MAX-Agent/0.1' }
                });

                if (!res.ok) return { success: false, url, error: `HTTP ${res.status}` };

                const contentType = res.headers.get('content-type') || '';
                if (!contentType.includes('text')) {
                    return { success: false, url, error: 'Not a text response' };
                }

                const raw = await res.text();
                // Strip HTML tags for readability
                const text = raw
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s{3,}/g, '\n\n')
                    .trim();

                return {
                    success:   true,
                    url,
                    content:   text.slice(0, maxChars),
                    truncated: text.length > maxChars,
                    length:    text.length
                };
            } catch (err) {
                return { success: false, url, error: err.message };
            }
        }
    }
};
