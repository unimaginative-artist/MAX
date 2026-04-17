// Choko's Scout Tool — her core capability as MAX's field agent
// Sparkle hunts (code audit), KB queries, health reports, and swarm relay.

import fs   from 'fs';
import path from 'path';

export default {
    name: 'scout',
    description: `Choko's specialized scouting tools for deep research and code auditing.
Actions:
  sparkle    → audit a file or directory for bugs, debt, and improvements: TOOL:scout:sparkle:{"target":"core/Brain.js"}
  kb_search  → search Choko's personal knowledge base: TOOL:scout:kb_search:{"query":"streaming implementation"}
  remember   → save a discovery to Choko's KB: TOOL:scout:remember:{"content":"Found that X causes Y"}
  health     → generate a health report of the codebase: TOOL:scout:health:{"dir":"core"}
  relay      → format a discovery as a Treat for MAX's review: TOOL:scout:relay:{"title":"Bug found","detail":"..."}`,

    actions: {
        sparkle: async ({ target }, choko) => {
            const fullPath = path.resolve(process.cwd(), target);
            if (!fs.existsSync(fullPath)) return { success: false, error: `Path not found: ${target}` };

            const stat = fs.statSync(fullPath);
            const files = stat.isDirectory()
                ? fs.readdirSync(fullPath).filter(f => /\.(js|mjs|ts)$/.test(f)).map(f => path.join(fullPath, f))
                : [fullPath];

            const findings = [];

            for (const file of files.slice(0, 8)) {
                try {
                    const src = fs.readFileSync(file, 'utf8');
                    const lines = src.split('\n');
                    const fileFindings = [];

                    // Dust Bunnies: common issues
                    lines.forEach((line, i) => {
                        const ln = i + 1;
                        if (/catch\s*\(\w*\)\s*\{\s*\}/.test(line))          fileFindings.push(`L${ln}: Empty catch block — errors silently swallowed`);
                        if (/console\.log/.test(line) && !/debug/i.test(line)) fileFindings.push(`L${ln}: Bare console.log — consider removing or using logger`);
                        if (/TODO|FIXME|HACK|XXX/.test(line))                  fileFindings.push(`L${ln}: ${line.trim()}`);
                        if (/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\)/.test(line))   fileFindings.push(`L${ln}: Silent .catch(() => {}) — failure masked`);
                        if (line.length > 200)                                  fileFindings.push(`L${ln}: Line length ${line.length} — consider breaking up`);
                    });

                    // Structural checks
                    const asyncWithoutAwait = src.match(/async\s+\w+\s*\([^)]*\)\s*\{[^}]*[^a]wait/g);
                    if (asyncWithoutAwait?.length > 3) fileFindings.push(`⚠️  ${asyncWithoutAwait.length} async functions may be missing awaits`);

                    if (fileFindings.length > 0) {
                        findings.push({ file: path.basename(file), issues: fileFindings.slice(0, 10) });
                    }
                } catch { /* skip unreadable */ }
            }

            const sparkleCount = files.length - findings.length;
            return {
                success: true,
                scanned: files.length,
                sparkles: sparkleCount,
                dustBunnies: findings.length,
                findings: findings.slice(0, 5)
            };
        },

        kb_search: async ({ query }, choko) => {
            if (!choko?.kb) return { success: false, error: 'KB not available' };
            const results = await choko.kb.query(query, { topK: 5 });
            return {
                success: true,
                query,
                results: results.map(r => ({ content: r.content?.slice(0, 300), score: r.score }))
            };
        },

        remember: async ({ content, tag = 'discovery' }, choko) => {
            if (!choko?.kb) return { success: false, error: 'KB not available' };
            await choko.kb.remember(content, { tag, source: 'choko_scout' });
            await choko.recordJournal(`Remembered: ${content.slice(0, 60)}`, '✨ Sparkly find!');
            return { success: true, message: 'Saved to Choko\'s knowledge base!' };
        },

        health: async ({ dir = '.' }, choko) => {
            const target = path.resolve(process.cwd(), dir);
            if (!fs.existsSync(target)) return { success: false, error: `Dir not found: ${dir}` };

            const files = fs.readdirSync(target).filter(f => /\.(js|mjs|ts)$/.test(f));
            let totalLines = 0, totalFiles = files.length, largeFiles = [], emptyFiles = [];

            for (const f of files) {
                try {
                    const src = fs.readFileSync(path.join(target, f), 'utf8');
                    const lines = src.split('\n').length;
                    totalLines += lines;
                    if (lines > 500) largeFiles.push({ file: f, lines });
                    if (lines < 5)   emptyFiles.push(f);
                } catch { /* skip */ }
            }

            return {
                success: true,
                dir,
                totalFiles,
                totalLines,
                avgLinesPerFile: Math.round(totalLines / (totalFiles || 1)),
                largeFiles: largeFiles.sort((a, b) => b.lines - a.lines).slice(0, 5),
                emptyFiles
            };
        },

        relay: async ({ title, detail, priority = 'medium' }, choko) => {
            const treat = {
                from:      'Choko',
                title,
                detail,
                priority,
                timestamp: new Date().toISOString(),
                emoji:     '🍫✨'
            };

            // Write to shared relay file for MAX to pick up
            const relayPath = path.join(process.cwd(), '.max', 'choko_relay.json');
            let relays = [];
            try { relays = JSON.parse(fs.readFileSync(relayPath, 'utf8')); } catch {}
            relays.push(treat);
            fs.writeFileSync(relayPath, JSON.stringify(relays.slice(-20), null, 2));

            await choko?.recordJournal(`Relayed treat to MAX: "${title}"`, '🎁 Delivered!');
            return { success: true, message: `Treat delivered to MAX! 🍫`, treat };
        }
    }
};
