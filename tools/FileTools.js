// ═══════════════════════════════════════════════════════════════════════════
// FileTools.js — read, write, list, search files
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path  from 'path';
import vm    from 'vm';

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

        async write({ filePath, content, append = false }) {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            if (append) {
                await fs.appendFile(filePath, content, 'utf8');
            } else {
                await fs.writeFile(filePath, content, 'utf8');
            }

            // Auto-verify syntax — catch broken files immediately
            const syntaxError = verifySyntax(filePath, content);
            if (syntaxError) {
                // Revert the broken write
                await fs.unlink(filePath).catch(() => {});
                return { success: false, path: filePath, error: `Syntax error — file NOT written: ${syntaxError}` };
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
                const syntaxError = verifySyntax(filePath, updated);
                if (syntaxError) {
                    await fs.writeFile(filePath, content, 'utf8');  // revert
                    return { success: false, path: filePath, error: `Syntax error after replace — reverted: ${syntaxError}` };
                }
                return {
                    success: true,
                    path: filePath,
                    replaced: all ? 'all occurrences' : 'first occurrence',
                    delta: newText.length - oldText.length
                };
            }

            // Fuzzy fallback: normalize line endings + trailing whitespace on each line
            // This catches the common case where the LLM generated CRLF vs LF or
            // stripped trailing spaces from a line it read.
            const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
            const normContent  = normalize(content);
            const normOldText  = normalize(oldText);

            if (normContent.includes(normOldText)) {
                const updated = normContent.replace(normOldText, normalize(newText));
                await fs.writeFile(filePath, updated, 'utf8');
                const syntaxError = verifySyntax(filePath, updated);
                if (syntaxError) {
                    await fs.writeFile(filePath, content, 'utf8');  // revert
                    return { success: false, path: filePath, error: `Syntax error after replace — reverted: ${syntaxError}` };
                }
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

        async delete({ filePath }) {
            await fs.unlink(filePath);
            return { success: true, deleted: filePath };
        }
    }
};

// ─── Syntax verifier — called after write/replace ─────────────────────────
// Returns null if OK, or an error string describing the problem.
// Reverts happen in the callers.
function verifySyntax(filePath, content) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
        try { JSON.parse(content); } catch (e) { return e.message; }
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        try { new vm.Script(content); } catch (e) { return e.message; }
    }
    return null;
}
