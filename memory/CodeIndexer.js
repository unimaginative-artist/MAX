
import fs from 'fs/promises';
import path from 'path';

/**
 * CodeIndexer — Background worker that semantically chunks and indexes the codebase.
 * It uses the KnowledgeBase for storage and Embedder for semantic search.
 */
export class CodeIndexer {
    constructor(max) {
        this.max = max;
        this.kb  = max.kb;
        this._isIndexing = false;
        this._ignoreDirs = new Set(['node_modules', '.git', '.max', 'dist', 'build', 'out']);
        this._extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.go', '.md']);
    }

    /**
     * Start a background crawl and index of the entire workspace.
     */
    async startIndexing(rootDir = process.cwd()) {
        if (this._isIndexing) return;
        this._isIndexing = true;

        console.log(`[CodeIndexer] 👁️  Starting God's Eye codebase indexing in ${rootDir}...`);
        const startTime = Date.now();

        try {
            const files = await this._crawl(rootDir);
            console.log(`[CodeIndexer] 📁 Found ${files.length} source files. Semantic indexing in progress...`);

            let count = 0;
            for (const file of files) {
                await this._indexFile(file);
                count++;
                if (count % 5 === 0) {
                    // Non-blocking yield to keep the main loop smooth
                    await new Promise(r => setTimeout(r, 10));
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[CodeIndexer] ✅ Codebase fully indexed in ${duration}s (${count} files).`);
        } catch (err) {
            console.error(`[CodeIndexer] ❌ Indexing failed: ${err.message}`);
        } finally {
            this._isIndexing = false;
        }
    }

    async _crawl(dir) {
        let results = [];
        const list = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of list) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!this._ignoreDirs.has(entry.name) && !entry.name.startsWith('.')) {
                    results = results.concat(await this._crawl(fullPath));
                }
            } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (this._extensions.has(ext)) {
                    results.push(fullPath);
                }
            }
        }
        return results;
    }

    async _indexFile(filePath) {
        const relPath = path.relative(process.cwd(), filePath);
        
        // Ensure we aren't indexing ignored files (e.g. from Sentinel trigger)
        const parts = relPath.split(/[\\\/]/);
        if (parts.some(p => this._ignoreDirs.has(p) || p.startsWith('.'))) {
            return;
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            if (!content.trim()) return;

            // ─── Phase 1: RepoGraph Extraction ───
            if (this.max.graph) {
                this.max.graph.addNode(relPath, { type: 'file', name: path.basename(relPath) });
                
                // Simple regex for ESM imports
                const importMatches = content.matchAll(/from\s+['"](.+?)['"]/g);
                for (const match of importMatches) {
                    let target = match[1];
                    if (target.startsWith('.')) {
                        // Normalize the path
                        let targetPath = path.join(path.dirname(relPath), target);
                        if (!targetPath.endsWith('.js')) targetPath += '.js';
                        this.max.graph.addEdge(relPath, targetPath, 'imports');
                    }
                }
            }

            // ─── Phase 2: Semantic Code Chunking ───
            // Instead of random slices, we split by high-level semantic markers
            // (classes, functions, large export blocks)
            const chunks = this._semanticSplit(content);

            // Directly ingest into KB with specialized metadata
            // We bypass the generic KB.ingest to use our better chunks
            await this.kb._ingestText(content, relPath, 'code', filePath, {
                isCode: true,
                language: path.extname(filePath).slice(1),
                semanticChunks: chunks.length
            });

        } catch (err) { /* skip individual file errors */ }
    }

    /**
     * Splits code into semantic blocks based on class and function definitions.
     */
    _semanticSplit(code) {
        const chunks = [];
        const lines  = code.split('\n');
        
        let currentChunk = [];
        let inBlock = false;

        for (const line of lines) {
            // Very basic heuristic for start of a significant block
            // (Works for JS, Python, Go, etc.)
            const isBlockStart = /^(export\s+)?(class|function|async\s+function|def|type|func)\s+/.test(line.trim());

            if (isBlockStart && currentChunk.length > 10) {
                // End current chunk and start new one
                chunks.push(currentChunk.join('\n'));
                currentChunk = [];
            }

            currentChunk.push(line);

            // Hard limit per chunk to avoid blowing context
            if (currentChunk.length > 100) {
                chunks.push(currentChunk.join('\n'));
                currentChunk = [];
            }
        }

        if (currentChunk.length > 0) chunks.push(currentChunk.join('\n'));
        return chunks.filter(c => c.trim().length > 50);
    }
}
