// ═══════════════════════════════════════════════════════════════════════════
// FileTools.js — read, write, list, search files
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path  from 'path';
import { execSync } from 'child_process';

export const FileTools = {
    name: 'file',
    description: 'Read, write, list, and search files on disk',

    actions: {
        async read({ filePath, maxLines = 500, maxBytes = 10 * 1024 * 1024, startLine = null, endLine = null }) {
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat) return { success: false, error: `File not found: ${filePath}` };

            // For large files without line-range request: read only first maxBytes
            if (stat.size > maxBytes && startLine === null && endLine === null) {
                const fd  = await fs.open(filePath, 'r');
                const buf = Buffer.alloc(maxBytes);
                const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
                await fd.close();
                const partial = buf.slice(0, bytesRead).toString('utf8');
                const lines   = partial.split('\n').slice(0, maxLines);
                return {
                    success:   true,
                    path:      filePath,
                    content:   lines.join('\n') + `\n... (file truncated — ${(stat.size / 1024 / 1024).toFixed(1)}MB exceeds ${maxBytes / 1024 / 1024}MB limit)`,
                    lines:     lines.length,
                    truncated: true,
                    sizeMB:    (stat.size / 1024 / 1024).toFixed(1)
                };
            }

            const content  = await fs.readFile(filePath, 'utf8');
            const allLines = content.split('\n');

            // Line-range subset — returns only the requested window
            if (startLine !== null || endLine !== null) {
                const from = Math.max(0, (startLine || 1) - 1);
                const to   = endLine ? Math.min(endLine, allLines.length) : allLines.length;
                return {
                    success:   true,
                    path:      filePath,
                    content:   allLines.slice(from, to).join('\n'),
                    totalLines: allLines.length,
                    startLine: from + 1,
                    endLine:   to,
                    truncated: false
                };
            }

            const truncated = allLines.length > maxLines;
            return {
                success:   true,
                path:      filePath,
                content:   truncated ? allLines.slice(0, maxLines).join('\n') + `\n... (${allLines.length - maxLines} more lines)` : content,
                lines:     allLines.length,
                truncated
            };
        },

        async write({ filePath, content, append = false, aegisOverride = false }) {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });

            // ── AEGIS Guard: block full-rewrites that silently delete routes/functions ──
            // Only runs on non-append writes to existing files with >100 lines.
            // Use replace or patch for surgical edits on large files instead.
            if (!append && !aegisOverride) {
                const original = await fs.readFile(filePath, 'utf8').catch(() => null);
                if (original !== null && original.split('\n').length >= 100) {
                    const before = _aegisExtractSignatures(original);
                    const after  = _aegisExtractSignatures(content);
                    const missing = [...before].filter(sig => !after.has(sig));
                    if (missing.length > 0) {
                        return {
                            success: false,
                            path: filePath,
                            error: `[AEGIS] Write blocked — would delete ${missing.length} signature(s):\n` +
                                   missing.map(s => `  • ${s}`).join('\n') +
                                   `\n\nUse file:replace or file:patch for surgical edits on large files. ` +
                                   `Pass aegisOverride:true only if deletion is intentional.`
                        };
                    }
                }
            }

            if (append) {
                await fs.appendFile(filePath, content, 'utf8');
            } else {
                await fs.writeFile(filePath, content, 'utf8');
            }

            return { success: true, path: filePath, bytes: Buffer.byteLength(content) };
        },

        async replace({ filePath, oldText, newText, all = false }) {
            const content = await fs.readFile(filePath, 'utf8').catch(() => null);
            if (content === null) return { success: false, error: `File not found: ${filePath}` };

            // Exact match first
            if (content.includes(oldText)) {
                const updated = all
                    ? content.split(oldText).join(newText)
                    : content.replace(oldText, newText);
                await fs.writeFile(filePath, updated, 'utf8');
                return {
                    success: true,
                    path: filePath,
                    replaced: all ? 'all occurrences' : 'first occurrence',
                    delta: newText.length - oldText.length
                };
            }

            // Fuzzy fallback: normalize line endings + trailing whitespace on each line
            const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
            const normContent  = normalize(content);
            const normOldText  = normalize(oldText);

            if (normContent.includes(normOldText)) {
                const updated = normContent.replace(normOldText, normalize(newText));
                await fs.writeFile(filePath, updated, 'utf8');
                return {
                    success: true,
                    path: filePath,
                    replaced: 'first occurrence (normalized whitespace)',
                    delta: newText.length - oldText.length
                };
            }

            // Return a helpful snippet so the LLM can correct its oldText
            const lines     = content.split('\n');
            const firstLine = oldText.split('\n')[0].trim();
            const nearby    = lines
                .map((l, i) => ({ i, l }))
                .filter(({ l }) => l.includes(firstLine.slice(0, 30)))
                .slice(0, 3)
                .map(({ i, l }) => `  line ${i + 1}: ${l.slice(0, 120)}`);

            const hint = nearby.length > 0
                ? `\nNearest matches:\n${nearby.join('\n')}`
                : '\nNo similar lines found — verify the file path and content.';

            return {
                success: false,
                error: `Target text not found in ${filePath}. Check that whitespace/indentation matches exactly.${hint}`
            };
        },

        async patch({ filePath, blocks }) {
            // Blocks: Array of { find: string, replace: string }
            let content = await fs.readFile(filePath, 'utf8').catch(() => null);
            if (content === null) return { success: false, error: `File not found: ${filePath}` };

            let changes = 0;
            const applied = [];
            
            for (const block of blocks) {
                if (content.includes(block.find)) {
                    content = content.replace(block.find, block.replace);
                    changes++;
                    applied.push(block.find.split('\n')[0].trim());
                }
            }

            if (changes > 0) {
                await fs.writeFile(filePath, content, 'utf8');
                return { 
                    success: true, 
                    path: filePath, 
                    patchesApplied: changes,
                    blocks: applied 
                };
            }

            return { success: false, error: 'No blocks matched. Check your search context.' };
        },

        async list({ dir = '.', pattern = null, recursive = false }) {
            async function walk(d, depth = 0) {
                const entries = await fs.readdir(d, { withFileTypes: true });
                const results = [];
                for (const e of entries) {
                    const fullPath = path.join(d, e.name);
                    if (e.isDirectory()) {
                        if (recursive && depth < 3) {
                            results.push(...await walk(fullPath, depth + 1));
                        }
                    } else {
                        if (!pattern || e.name.includes(pattern)) {
                            results.push(fullPath);
                        }
                    }
                }
                return results;
            }
            const files = await walk(dir);
            return { success: true, dir, files: files.slice(0, 200), total: files.length };
        },

        async search({ dir = '.', query, filePattern = null }) {
            const results = [];
            async function walk(d) {
                const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    const fullPath = path.join(d, e.name);
                    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
                        await walk(fullPath);
                    } else if (e.isFile()) {
                        if (filePattern && !fullPath.endsWith(filePattern)) continue;
                        try {
                            // Skip large files in search — they'd flood results and eat memory
                            const fileStat = await fs.stat(fullPath).catch(() => null);
                            if (!fileStat || fileStat.size > 5 * 1024 * 1024) continue;
                            const content = await fs.readFile(fullPath, 'utf8');
                            const lines = content.split('\n');
                            lines.forEach((line, i) => {
                                if (line.toLowerCase().includes(query.toLowerCase())) {
                                    results.push({ file: fullPath, line: i + 1, text: line.trim() });
                                }
                            });
                        } catch { /* binary or unreadable — skip */ }
                    }
                }
            }
            await walk(dir);
            return { success: true, query, matches: results.slice(0, 100), total: results.length };
        },

        async grep({ dir = '.', pattern, filePattern = null, maxResults = 150, ignoreCase = false }) {
            if (!pattern) return { success: false, error: 'pattern is required' };
            let regex;
            try {
                regex = new RegExp(pattern, ignoreCase ? 'i' : '');
            } catch (e) {
                return { success: false, error: `Invalid regex: ${e.message}` };
            }

            const results = [];

            async function walk(d) {
                if (results.length >= maxResults) return;
                const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
                for (const e of entries) {
                    if (results.length >= maxResults) break;
                    const fullPath = path.join(d, e.name);
                    if (e.isDirectory()) {
                        if (!e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '.max') {
                            await walk(fullPath);
                        }
                    } else if (e.isFile()) {
                        if (filePattern) {
                            // filePattern can be an extension (.js) or substring (Brain)
                            const matches = filePattern.startsWith('.')
                                ? e.name.endsWith(filePattern)
                                : fullPath.includes(filePattern);
                            if (!matches) continue;
                        }
                        try {
                            const fileStat = await fs.stat(fullPath).catch(() => null);
                            if (!fileStat || fileStat.size > 2 * 1024 * 1024) continue;
                            const content = await fs.readFile(fullPath, 'utf8');
                            const lines = content.split('\n');
                            lines.forEach((line, i) => {
                                if (results.length < maxResults && regex.test(line)) {
                                    results.push({ file: fullPath, line: i + 1, text: line.trim().slice(0, 200) });
                                }
                            });
                        } catch { /* binary or unreadable — skip */ }
                    }
                }
            }

            await walk(dir);
            return { success: true, pattern, matches: results, total: results.length };
        },

        // ── patch ─────────────────────────────────────────────────────────
        // Anchor-based surgical editing — designed for LLM use.
        // Much easier to generate correctly than unified diff.
        //
        // Each hunk specifies:
        //   anchor    — substring to locate the insertion point
        //   position  — 'after' (default) | 'before' | 'replace' | 'append'
        //   content   — new code to insert / replacement text
        //   range     — for 'replace': lines to remove starting at anchor (default 1)
        //
        // Example:
        //   TOOL:file:patch:{"filePath":"extended.js","hunks":[
        //     {"anchor":"import { DiscoverySwarm }","position":"after",
        //      "content":"import { ProactiveCouncil } from './ProactiveCouncil.js';"}
        //   ]}
        async patch({ filePath, hunks = [], createIfMissing = false }) {
            if (!Array.isArray(hunks) || hunks.length === 0) {
                return { success: false, error: 'hunks must be a non-empty array' };
            }

            let content = await fs.readFile(filePath, 'utf8').catch(async (err) => {
                if (err.code === 'ENOENT' && createIfMissing) {
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    return '';
                }
                return null;
            });
            if (content === null) return { success: false, error: `File not found: ${filePath}` };

            let lines        = content.split('\n');
            const hunkResults = [];

            for (let h = 0; h < hunks.length; h++) {
                const { anchor, position = 'after', content: newContent = '', range = 1 } = hunks[h];

                // append — no anchor needed
                if (position === 'append') {
                    lines.push(...(newContent === '' ? [''] : newContent.split('\n')));
                    hunkResults.push({ hunk: h, applied: true, position: 'append' });
                    continue;
                }

                if (!anchor) {
                    hunkResults.push({ hunk: h, applied: false, error: 'anchor required for non-append positions' });
                    continue;
                }

                // Find anchor — exact substring first, then trimmed
                let anchorIdx = lines.findIndex(l => l.includes(anchor));
                if (anchorIdx === -1) anchorIdx = lines.findIndex(l => l.trim() === anchor.trim());

                if (anchorIdx === -1) {
                    hunkResults.push({
                        hunk: h, applied: false,
                        error: `Anchor not found: "${anchor.slice(0, 80)}". Use file:grep to locate exact content.`,
                    });
                    continue;
                }

                const newLines = newContent === '' ? [] : newContent.split('\n');

                if (position === 'after')        lines.splice(anchorIdx + 1, 0, ...newLines);
                else if (position === 'before')  lines.splice(anchorIdx, 0, ...newLines);
                else if (position === 'replace') lines.splice(anchorIdx, Math.max(1, range), ...newLines);
                else {
                    hunkResults.push({ hunk: h, applied: false, error: `Unknown position: ${position}` });
                    continue;
                }

                hunkResults.push({ hunk: h, applied: true, anchorLine: anchorIdx + 1, position });
            }

            const applied = hunkResults.filter(r => r.applied).length;
            const failed  = hunkResults.filter(r => !r.applied).length;

            const updated = lines.join('\n');
            await fs.writeFile(filePath, updated, 'utf8');

            const syntaxError = verifySyntax(filePath, updated);
            if (syntaxError) {
                await fs.writeFile(filePath, content, 'utf8');  // revert
                return { success: false, path: filePath, error: `Syntax error after patch — reverted: ${syntaxError}`, hunkResults };
            }

            return {
                success:      failed === 0,
                path:         filePath,
                totalLines:   lines.length,
                hunksApplied: applied,
                hunksFailed:  failed,
                hunksTotal:   hunks.length,
                hunkResults,
                warning:      failed > 0 ? `${failed} hunk(s) failed — file written with successful hunks only` : undefined,
            };
        },

        async delete({ filePath }) {
            await fs.unlink(filePath);
            return { success: true, deleted: filePath };
        }
    }
};

// ─── AEGIS: extract structural signatures (routes, functions, classes, exports) ──
// Used to detect when a full-rewrite would silently delete load-bearing code.
function _aegisExtractSignatures(content) {
    const sigs = new Set();
    // HTTP route registrations
    for (const m of content.matchAll(/\.\s*(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
        sigs.add(`route:${m[1].toUpperCase()}:${m[2]}`);
    }
    // Named function declarations
    for (const m of content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
        sigs.add(`fn:${m[1]}`);
    }
    // Class declarations
    for (const m of content.matchAll(/\bclass\s+(\w+)/g)) {
        sigs.add(`class:${m[1]}`);
    }
    // Top-level exports
    for (const m of content.matchAll(/^export\s+(?:default\s+)?(?:async\s+function|function|class|const)\s+(\w+)/gm)) {
        sigs.add(`export:${m[1]}`);
    }
    return sigs;
}

// ─── Syntax verifier — called after write/replace ─────────────────────────
// Returns null if OK, or an error string describing the problem.
// Reverts happen in the callers.
function verifySyntax(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
        try { JSON.parse(content); } catch (e) { return e.message; }
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        try {
            // node --check is the only reliable way to verify ESM syntax
            execSync(`node --check "${filePath}"`, { stdio: 'ignore' });
        } catch (e) {
            return `Syntax check failed: ${e.message}`;
        }
    }
    return null;
}
