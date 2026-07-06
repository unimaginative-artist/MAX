// ═══════════════════════════════════════════════════════════════════════════
// SemanticIndex.js — whole-workspace vector search (Cursor-style codebase awareness)
//
// On boot: scans every source file in the workspace and ingests into the KB.
// On file change: Sentinel calls indexFile() to keep the index fresh.
// At chat time: MAX._buildStateContext() calls search() to inject the top-K
// most relevant code chunks into the system context automatically.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';

const INDEXABLE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.md']);
const SKIP_DIRS      = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'worktrees', '.max']);
const MAX_FILE_BYTES = 80_000; // skip files > 80KB — too large to be useful as context
const BOOT_DELAY_MS  = 10_000; // wait 10s after boot so startup isn't slowed down

export class SemanticIndex {
    constructor(max) {
        this.max       = max;
        this.root      = process.cwd();
        this._indexing = false;
        this._ready    = false;
    }

    initialize() {
        // Non-blocking — scan after boot settles
        setTimeout(() => this._scanWorkspace(), BOOT_DELAY_MS);
        console.log('[SemanticIndex] 🗂️  Workspace indexer starting in 10s...');
    }

    // Called by Sentinel whenever a source file changes
    async indexFile(absPath) {
        if (!this._isIndexable(absPath) || !this.max.kb?._ready) return;
        try {
            const { size } = await fs.stat(absPath);
            if (size > MAX_FILE_BYTES) return;
            await this.max.kb.ingest(absPath, { metadata: { workspace: true } });
        } catch { /* non-fatal */ }
    }

    // Called by MAX._buildStateContext() on every chat turn
    // Returns a formatted context string to inject into the system prompt
    async search(query, topK = 5) {
        if (!this._ready || !this.max.kb?._ready || !query?.trim()) return '';
        try {
            const results = await this.max.kb.query(query, { topK: topK * 3 });

            // Filter to files that live inside the workspace root
            const workspaceHits = results
                .filter(r => r.source_path && r.source_path.startsWith(this.root))
                .slice(0, topK);

            if (workspaceHits.length === 0) return '';

            const lang = (p) => {
                const ext = path.extname(p).slice(1);
                return ext === 'mjs' ? 'js' : ext || 'text';
            };

            const sections = workspaceHits.map(r => {
                const rel = path.relative(this.root, r.source_path).replace(/\\/g, '/');
                return `**${rel}**\n\`\`\`${lang(r.source_path)}\n${r.content.trim()}\n\`\`\``;
            });

            return `\n\n## Codebase Context\n*Relevant workspace code — auto-retrieved by semantic search:*\n\n${sections.join('\n\n')}`;
        } catch { return ''; }
    }

    // ── Private ────────────────────────────────────────────────────────────

    async _scanWorkspace() {
        if (this._indexing || !this.max.kb?._ready) return;
        this._indexing = true;
        console.log('[SemanticIndex] 🔍 Scanning workspace for source files...');

        try {
            const files = await this._getWorkspaceFiles(this.root);
            let indexed = 0, skipped = 0;

            for (const f of files) {
                try {
                    const { size } = await fs.stat(f);
                    if (size > MAX_FILE_BYTES) { skipped++; continue; }
                    const result = await this.max.kb.ingest(f, { metadata: { workspace: true } });
                    if (result?.message === 'Content already indexed') skipped++;
                    else indexed++;
                } catch { skipped++; }

                // Yield every 5 files so the event loop stays responsive
                if ((indexed + skipped) % 5 === 0) await new Promise(r => setImmediate(r));
            }

            this._ready = true;
            console.log(`[SemanticIndex] ✅ Workspace indexed — ${indexed} new, ${skipped} cached (${files.length} total files)`);
        } catch (err) {
            console.warn('[SemanticIndex] ⚠️ Scan error:', err.message);
        }

        this._indexing = false;
    }

    async _getWorkspaceFiles(dir, depth = 0) {
        if (depth > 5) return [];
        let files = [];
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch { return []; }

        for (const e of entries) {
            if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                const sub = await this._getWorkspaceFiles(full, depth + 1);
                files = files.concat(sub);
            } else if (e.isFile() && INDEXABLE_EXTS.has(path.extname(e.name).toLowerCase())) {
                files.push(full);
            }
        }
        return files;
    }

    _isIndexable(absPath) {
        const ext = path.extname(absPath).toLowerCase();
        if (!INDEXABLE_EXTS.has(ext)) return false;
        const rel = path.relative(this.root, absPath);
        return !rel.split(path.sep).some(seg => SKIP_DIRS.has(seg) || seg.startsWith('.'));
    }
}
