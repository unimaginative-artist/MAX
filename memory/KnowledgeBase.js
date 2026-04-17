// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KnowledgeBase.js â€” MAX's RAG layer
//
// Episodic memory (MaxMemory) stores conversations and discoveries.
// KnowledgeBase stores *documents* â€” files, URLs, codebases, notes â€”
// chunked, embedded, and retrievable by semantic + BM25 search.
//
// Pipeline:
//   Ingest â†’ chunk â†’ embed â†’ store
//   Query  â†’ expand â†’ hybrid search â†’ rerank â†’ return with attribution
//
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

import Database from 'better-sqlite3';
import fs       from 'fs';
import path     from 'path';
import crypto   from 'crypto';
import { Embedder } from './Embedder.js';

const CHUNK_SIZE    = 600;   // target chars per chunk (~150 tokens)
const CHUNK_OVERLAP = 100;   // overlap between consecutive chunks
const MIN_CHUNK     = 80;    // discard chunks smaller than this

// File extensions we can ingest as text
const TEXT_EXTS = new Set([
    '.md', '.txt', '.rst', '.csv', '.json', '.yaml', '.yml', '.toml', '.env',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
    '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs',
    '.sh', '.bash', '.zsh', '.fish',
    '.html', '.css', '.scss', '.sql'
]);

export class KnowledgeBase {
    constructor(config = {}) {
        this.dbPath    = config.dbPath || path.join(process.cwd(), '.max', 'knowledge.db');
        this.embedder  = new Embedder();
        this._vectors  = new Map();   // chunkId â†’ float[]
        this._db       = null;
        this._ready    = false;
    }

    async initialize() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this._db = new Database(this.dbPath);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('synchronous = NORMAL');
        this._createSchema();

        await this.embedder.initialize().catch(() => {});
        await this._loadVectors();

        const { sources, chunks } = this._counts();
        console.log(`[KnowledgeBase] ✅ ${sources} sources | ${chunks} chunks | embedder: ${this.embedder._ready ? 'ready' : 'keyword-only'}`);
        this._ready = true;
    }


    _createSchema() {
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS kb_sources (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                type        TEXT NOT NULL DEFAULT 'file',
                source_path TEXT,
                ingested_at INTEGER NOT NULL,
                chunk_count INTEGER DEFAULT 0,
                metadata    TEXT DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS kb_chunks (
                id          TEXT PRIMARY KEY,
                source_id   TEXT NOT NULL,
                content     TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                ingested_at INTEGER NOT NULL,
                FOREIGN KEY (source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_chunk_source ON kb_chunks(source_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
                id UNINDEXED,
                content,
                tokenize='porter unicode61'
            );
        `);
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // INGESTION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // Lightweight shortcut for storing a plain-text insight (used by ReflectionEngine, AgentLoop)
    async remember(text, metadata = {}) {
        if (!text?.trim()) return;
        const name = metadata.source ? `${metadata.source}_${Date.now()}` : `memory_${Date.now()}`;
        return this.ingest(text, { name, metadata });
    }

    // ingest() is the main entry point â€” handles file, directory, URL, or raw text
    async ingest(source, { name = null, metadata = {} } = {}) {
        if (!this._ready) throw new Error('KnowledgeBase not initialized');

        let type, text, resolvedName;

        if (source.startsWith('http://') || source.startsWith('https://')) {
            // URL ingestion
            type = 'url';
            resolvedName = name || source;
            text = await this._fetchUrl(source);
        } else if (fs.existsSync(source)) {
            const stat = fs.statSync(source);
            if (stat.isDirectory()) {
                return this._ingestDirectory(source, name, metadata);
            }
            type = 'file';
            resolvedName = name || path.basename(source);
            text = this._readFile(source);
        } else {
            // Raw text
            type = 'text';
            resolvedName = name || `text_${Date.now()}`;
            text = source;
        }

        if (!text?.trim()) return { success: false, error: 'No content extracted' };

        return this._ingestText(text, resolvedName, type, source, metadata);
    }

    async _ingestDirectory(dirPath, name, metadata) {
        const results = [];
        const walk    = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                    walk(full);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (TEXT_EXTS.has(ext)) results.push(full);
                }
            }
        };
        walk(dirPath);

        console.log(`[KnowledgeBase] ðŸ“‚ Ingesting ${results.length} files from ${dirPath}`);
        let ingested = 0, skipped = 0;
        for (const file of results) {
            try {
                const text = this._readFile(file);
                if (text?.trim()) {
                    const relPath = path.relative(dirPath, file);
                    await this._ingestText(text, relPath, 'file', file, { ...metadata, dir: dirPath });
                    ingested++;
                } else { skipped++; }
            } catch { skipped++; }
        }

        return { success: true, type: 'directory', ingested, skipped, total: results.length };
    }

    async _ingestText(text, name, type, sourcePath, metadata) {
        // 🔱 POSEIDON SAFETY: Content Hash Deduplication
        const hash = crypto.createHash('md5').update(text).digest('hex');
        const duplicate = this._db.prepare('SELECT id FROM kb_sources WHERE metadata LIKE ?').get('%' + hash + '%');
        if (duplicate) return { success: true, message: 'Content already indexed', sourceId: duplicate.id };
        metadata.content_hash = hash;
        // Remove existing source by same path to avoid duplicates
        const existing = this._db.prepare('SELECT id FROM kb_sources WHERE source_path = ?').get(sourcePath);
        if (existing) await this.remove(existing.id);

        const sourceId  = crypto.randomUUID();
        const now       = Date.now();
        const chunks    = this._chunk(text);

        // Store source
        this._db.prepare(`
            INSERT INTO kb_sources (id, name, type, source_path, ingested_at, chunk_count, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(sourceId, name, type, sourcePath, now, chunks.length, JSON.stringify(metadata));

        // Store chunks + FTS
        const insertChunk = this._db.prepare(
            'INSERT INTO kb_chunks (id, source_id, content, chunk_index, ingested_at) VALUES (?, ?, ?, ?, ?)'
        );
        const insertFts = this._db.prepare('INSERT INTO kb_fts (id, content) VALUES (?, ?)');

        const insertMany = this._db.transaction((chunks) => {
            for (const { id, content, index } of chunks) {
                insertChunk.run(id, sourceId, content, index, now);
                insertFts.run(id, content);
            }
        });

        const chunkRows = chunks.map((content, index) => ({
            id: crypto.randomUUID(),
            content,
            index
        }));
        insertMany(chunkRows);

        // Embed all chunks (async, non-blocking for large ingestions)
        this._embedChunks(chunkRows).catch(() => {});

        console.log(`[KnowledgeBase] âœ… Ingested "${name}" â†’ ${chunks.length} chunks`);
        return { success: true, sourceId, name, type, chunks: chunks.length };
    }

    // â”€â”€â”€ Smart chunking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Respects paragraph and code block boundaries before falling back to
    // character-level splitting. Adds overlap between consecutive chunks.
    _chunk(text) {
        const chunks = [];

        // First split by double newline (paragraph / code block boundaries)
        const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length >= MIN_CHUNK);

        let buffer = '';
        for (const para of paragraphs) {
            if (buffer.length + para.length + 2 <= CHUNK_SIZE) {
                buffer = buffer ? `${buffer}\n\n${para}` : para;
            } else {
                if (buffer) chunks.push(buffer);

                // Para itself is too large â€” split on sentence boundaries
                if (para.length > CHUNK_SIZE) {
                    const sentences = para.match(/[^.!?]+[.!?\n]+/g) || [para];
                    let sub = '';
                    for (const sent of sentences) {
                        if (sub.length + sent.length > CHUNK_SIZE) {
                            if (sub) chunks.push(sub.trim());
                            // Overlap: carry last CHUNK_OVERLAP chars into next chunk
                            sub = sub.slice(-CHUNK_OVERLAP) + sent;
                        } else {
                            sub += sent;
                        }
                    }
                    buffer = sub.trim();
                } else {
                    // Start fresh with overlap from previous buffer
                    const overlap = buffer.slice(-CHUNK_OVERLAP);
                    buffer = overlap ? `${overlap}\n\n${para}` : para;
                }
            }
        }
        if (buffer.trim().length >= MIN_CHUNK) chunks.push(buffer.trim());

        return chunks.filter(c => c.length >= MIN_CHUNK);
    }

    async _embedChunks(chunkRows) {
        if (!this.embedder._ready) return;
        for (const { id, content } of chunkRows) {
            try {
                const vec = await this.embedder.embed(content);
                if (vec) this._vectors.set(id, vec);
            } catch { /* non-fatal */ }
        }
        this._saveVectors();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // RETRIEVAL
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    // query() is the RAG retrieval step
    // queryExpansion: if brain is provided, generate 2 query variants for better recall
    async query(question, { topK = 6, brain = null } = {}) {
        if (!this._ready || !question?.trim()) return [];

        // Query expansion â€” generate alternative phrasings with fast LLM
        const queries = [question];
        if (brain?._ready) {
            try {
                const expanded = await brain.think(
                    `Generate 2 alternative search queries for this question. Return ONLY a JSON array of strings.\nQuestion: ${question}`,
                    { temperature: 0.4, maxTokens: 100, tier: 'fast' }
                );
                const match = expanded.match(/\[[\s\S]*?\]/);
                if (match) {
                    const variants = JSON.parse(match[0]);
                    queries.push(...variants.slice(0, 2).filter(q => typeof q === 'string'));
                }
            } catch { /* expansion failed â€” use original only */ }
        }

        // Run all queries, union results by chunk ID
        const scoreMap = new Map();  // chunkId â†’ best combined score

        for (const q of queries) {
            const [bm25, vecScores] = await Promise.all([
                this._bm25(q, topK * 2),
                this._vectorScores(q)
            ]);

            // Collect all candidate chunk IDs
            const candidates = new Set([...bm25.map(r => r.id), ...vecScores.keys()]);
            const bm25Map    = new Map(bm25.map(r => [r.id, r.bm25]));

            for (const id of candidates) {
                const vec   = vecScores.get(id)  || 0;
                const bm25s = bm25Map.get(id)    || 0;
                const combined = this.embedder._ready
                    ? 0.55 * vec + 0.45 * bm25s
                    : bm25s;

                const current = scoreMap.get(id) || { score: 0 };
                if (combined > current.score) scoreMap.set(id, { score: combined, vec, bm25: bm25s });
            }
        }

        if (scoreMap.size === 0) return [];

        // Sort by score, take topK
        const ranked = [...scoreMap.entries()]
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, topK);

        // Hydrate from DB with source attribution
        const ids  = ranked.map(([id]) => id);
        const rows = this._hydrateChunks(ids);

        return rows.map(row => ({
            ...row,
            score:    scoreMap.get(row.id)?.score || 0,
            vecScore: scoreMap.get(row.id)?.vec   || 0,
            bm25:     scoreMap.get(row.id)?.bm25  || 0
        })).sort((a, b) => b.score - a.score);
    }

    _bm25(query, limit) {
        try {
            const q = query.trim().replace(/['"*]/g, ' ').trim();
            if (!q) return [];
            const rows = this._db.prepare(`
                SELECT c.id, c.content, c.source_id, s.name as source_name,
                       (-bm25(kb_fts)) as raw_bm25
                FROM kb_fts
                JOIN kb_chunks c ON kb_fts.id = c.id
                JOIN kb_sources s ON c.source_id = s.id
                WHERE kb_fts MATCH ?
                ORDER BY raw_bm25 DESC
                LIMIT ?
            `).all(q, limit);

            if (!rows.length) return [];
            const maxScore = Math.max(...rows.map(r => r.raw_bm25), 1);
            return rows.map(r => ({ ...r, bm25: r.raw_bm25 / maxScore }));
        } catch { return []; }
    }

    async _vectorScores(query) {
        const scores = new Map();
        if (!this.embedder._ready || this._vectors.size === 0) return scores;
        try {
            const qVec = await this.embedder.embed(query);
            if (!qVec) return scores;

            let count = 0;
            const BATCH_SIZE = 500;

            for (const [id, vec] of this._vectors) {
                const s = Embedder.cosine(qVec, vec);
                if (s > 0.25) scores.set(id, s);

                count++;
                if (count % BATCH_SIZE === 0) {
                    // Non-blocking yield: let the event loop process other events
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
        } catch { /* non-fatal */ }
        return scores;
    }

    _hydrateChunks(ids) {
        if (!ids.length) return [];
        const placeholders = ids.map(() => '?').join(',');
        return this._db.prepare(`
            SELECT c.id, c.content, c.chunk_index, c.source_id,
                   s.name as source_name, s.type as source_type, s.source_path
            FROM kb_chunks c
            JOIN kb_sources s ON c.source_id = s.id
            WHERE c.id IN (${placeholders})
        `).all(...ids);
    }

    // â”€â”€â”€ Build context block for system prompt injection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Called by MAX.think() â€” returns formatted retrieved chunks
    formatForPrompt(chunks, maxChars = 3000) {
        if (!chunks.length) return '';

        let used = 0;
        const parts = ['\n\n## Knowledge Base â€” retrieved context'];

        for (const chunk of chunks) {
            const source  = chunk.source_name || 'unknown';
            const snippet = chunk.content.slice(0, 800);
            const block   = `\n### From: ${source}\n${snippet}`;
            if (used + block.length > maxChars) break;
            parts.push(block);
            used += block.length;
        }

        return parts.join('');
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // MANAGEMENT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    async remove(sourceId) {
        // Get chunk IDs first so we can clean vectors
        const chunks = this._db.prepare('SELECT id FROM kb_chunks WHERE source_id = ?').all(sourceId);
        for (const { id } of chunks) {
            this._vectors.delete(id);
            this._db.prepare('DELETE FROM kb_fts WHERE id = ?').run(id);
        }
        this._db.prepare('DELETE FROM kb_chunks WHERE source_id = ?').run(sourceId);
        this._db.prepare('DELETE FROM kb_sources WHERE id = ?').run(sourceId);
        this._saveVectors();
    }

    listSources() {
        return this._db.prepare(
            'SELECT id, name, type, source_path, ingested_at, chunk_count FROM kb_sources ORDER BY ingested_at DESC'
        ).all().map(r => ({
            ...r,
            ingested_at: new Date(r.ingested_at).toLocaleDateString()
        }));
    }

    // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    _readFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (!TEXT_EXTS.has(ext)) return null;
        try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
    }

    async _fetchUrl(url) {
        try {
            const fetch = (await import('node-fetch')).default;
            const res   = await fetch(url, {
                signal:  AbortSignal.timeout(15000),
                headers: { 'User-Agent': 'MAX-Agent/1.0' }
            });
            if (!res.ok) return null;
            const html = await res.text();
            return html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s{3,}/g, '\n\n')
                .trim();
        } catch { return null; }
    }

    _saveVectors() {
        try {
            const vecPath = this.dbPath.replace('.db', '_vectors.json');
            const obj = {};
            for (const [id, vec] of this._vectors) obj[id] = vec;
            fs.writeFileSync(vecPath, JSON.stringify(obj));
        } catch { /* non-fatal */ }
    }

    async _loadVectors() {
        try {
            const vecPath = this.dbPath.replace('.db', '_vectors.json');
            if (!fs.existsSync(vecPath)) return;
            const raw = await fs.promises.readFile(vecPath, 'utf8');
            const data = JSON.parse(raw);

            let count = 0;
            for (const [id, vec] of Object.entries(data)) {
                this._vectors.set(id, vec);
                count++;
                if (count % 1000 === 0) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
            console.log(`[KnowledgeBase] Loaded ${this._vectors.size} chunk vectors`);
        } catch { /* start fresh */ }
    }

    _counts() {
        return {
            sources: this._db.prepare('SELECT COUNT(*) as c FROM kb_sources').get()?.c || 0,
            chunks:  this._db.prepare('SELECT COUNT(*) as c FROM kb_chunks').get()?.c  || 0
        };
    }

    getStatus() {
        const { sources, chunks } = this._counts();
        return { ready: this._ready, sources, chunks, vectors: this._vectors.size };
    }
}

