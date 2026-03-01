// ═══════════════════════════════════════════════════════════════════════════
// FileTools.js — read, write, list, search files
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';

export const FileTools = {
    name: 'file',
    description: 'Read, write, list, and search files on disk',

    actions: {
        async read({ filePath, maxLines = 500, maxBytes = 10 * 1024 * 1024 }) {
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat) return { success: false, error: `File not found: ${filePath}` };

            // For large files: read only first maxBytes to avoid memory exhaustion
            if (stat.size > maxBytes) {
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

            const content = await fs.readFile(filePath, 'utf8');
            const lines   = content.split('\n');
            const truncated = lines.length > maxLines;
            return {
                success:   true,
                path:      filePath,
                content:   truncated ? lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)` : content,
                lines:     lines.length,
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
            return { success: true, path: filePath, bytes: Buffer.byteLength(content) };
        },

        async replace({ filePath, oldText, newText, all = false }) {
            const content = await fs.readFile(filePath, 'utf8').catch(() => null);
            if (content === null) return { success: false, error: `File not found: ${filePath}` };

            if (!content.includes(oldText)) {
                return { success: false, error: "Target text not found in file. Ensure whitespace and indentation match exactly." };
            }

            const updated = all 
                ? content.split(oldText).join(newText)
                : content.replace(oldText, newText);

            await fs.writeFile(filePath, updated, 'utf8');
            return { 
                success: true, 
                path: filePath, 
                replaced: all ? "all occurrences" : "first occurrence",
                delta: newText.length - oldText.length
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

        async delete({ filePath }) {
            await fs.unlink(filePath);
            return { success: true, deleted: filePath };
        }
    }
};
