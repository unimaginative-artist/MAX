// ═══════════════════════════════════════════════════════════════════════════
// FileTools.js — read, write, list, search files
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';

export const FileTools = {
    name: 'file',
    description: 'Read, write, list, and search files on disk',

    actions: {
        async read({ filePath, maxLines = 500 }) {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
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
