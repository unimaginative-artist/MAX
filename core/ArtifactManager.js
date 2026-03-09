// ═══════════════════════════════════════════════════════════════════════════
// ArtifactManager — Stores large outputs outside the LLM context window.
//
// Prevents context bloat: code blocks, file reads, and tool results over
// 5000 chars are stored here and replaced with a pointer in chat history.
//
// MAX can interact with his own artifacts via TOOL:artifacts:get/list/open/delete.
// Artifacts persist to .max/artifacts/ across restarts.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { EventEmitter } from 'events';

export class ArtifactManager extends EventEmitter {
    constructor(max) {
        super();
        this.max       = max;
        this.artifacts = new Map();   // id → artifact
        this._counter  = 0;
        this._dir      = path.join(process.cwd(), '.max', 'artifacts');
    }

    // ─── Must be called on boot to restore persisted artifacts ────────────
    async init() {
        await fs.mkdir(this._dir, { recursive: true });
        await this._loadFromDisk();
    }

    // ─── Store a large block — returns a pointer string for chat context ──
    store(name, content, type = 'code') {
        const id       = `art_${++this._counter}_${Date.now().toString(36)}`;
        const artifact = {
            id,
            name,
            content,
            type,
            lineCount: content.split('\n').length,
            byteSize:  Buffer.byteLength(content, 'utf8'),
            timestamp: Date.now()
        };

        this.artifacts.set(id, artifact);
        this.emit('artifact:created', { id, name, type, lineCount: artifact.lineCount });
        this._saveToDisk(artifact).catch(() => {});

        // Pointer tells MAX exactly how to retrieve it — no guessing
        return `[ARTIFACT:${id} | "${name}" | ${artifact.lineCount} lines | retrieve: TOOL:artifacts:get:{"id":"${id}"}]`;
    }

    // ─── Retrieve artifact ────────────────────────────────────────────────
    get(id) {
        return this.artifacts.get(id) || null;
    }

    // ─── List all artifacts ───────────────────────────────────────────────
    list() {
        return [...this.artifacts.values()]
            .sort((a, b) => b.timestamp - a.timestamp)
            .map(a => ({
                id:        a.id,
                name:      a.name,
                type:      a.type,
                lineCount: a.lineCount,
                byteSize:  a.byteSize,
                timestamp: new Date(a.timestamp).toISOString()
            }));
    }

    // ─── Open an artifact in the system default editor ────────────────────
    async open(id) {
        const art = this.artifacts.get(id);
        if (!art) return { success: false, error: `Artifact ${id} not found` };

        const ext     = art.type === 'json' ? '.json' : art.name.match(/\.\w+$/) ? '' : '.js';
        const tmpPath = path.join(this._dir, `${art.id}${ext}`);

        try {
            await fs.writeFile(tmpPath, art.content, 'utf8');
            // Windows: start opens in default editor; cross-platform fallback
            const cmd = process.platform === 'win32'
                ? `start "" "${tmpPath}"`
                : process.platform === 'darwin'
                    ? `open "${tmpPath}"`
                    : `xdg-open "${tmpPath}"`;
            exec(cmd);
            console.log(`[ArtifactManager] 📂 Opened "${art.name}" in editor`);
            return { success: true, message: `Opened "${art.name}" in editor`, path: tmpPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ─── Delete an artifact ───────────────────────────────────────────────
    delete(id) {
        const art = this.artifacts.get(id);
        if (!art) return { success: false, error: `Artifact ${id} not found` };
        this.artifacts.delete(id);
        fs.unlink(path.join(this._dir, `${id}.json`)).catch(() => {});
        console.log(`[ArtifactManager] 🗑️  Deleted "${art.name}"`);
        return { success: true, message: `Deleted "${art.name}"` };
    }

    // ─── Tool interface — MAX uses these via TOOL:artifacts:* ─────────────
    asTool() {
        return {
            name:        'artifacts',
            description: `Manage large code/text blocks stored outside context.
Actions:
  list   → see all stored artifacts (id, name, size)
  get    → retrieve full content of an artifact: TOOL:artifacts:get:{"id":"art_X"}
  open   → open an artifact in your editor: TOOL:artifacts:open:{"id":"art_X"}
  delete → remove an artifact: TOOL:artifacts:delete:{"id":"art_X"}`,
            actions: {
                list:   async ()        => ({ success: true, artifacts: this.list(), count: this.artifacts.size }),
                get:    async ({ id })  => {
                    const art = this.get(id);
                    if (!art) return { success: false, error: `Artifact ${id} not found. Use TOOL:artifacts:list to see available artifacts.` };
                    console.log(`[ArtifactManager] 📥 Retrieved "${art.name}" into context`);
                    return { success: true, id: art.id, name: art.name, type: art.type, lineCount: art.lineCount, content: art.content };
                },
                open:   async ({ id })  => await this.open(id),
                delete: async ({ id })  => this.delete(id)
            }
        };
    }

    // ─── Dehydrate context: replace oversized turns with pointers ─────────
    dehydrate(history) {
        return history.map(turn => {
            if (turn.content.length > 1000
                && (turn.content.includes('"content":') || turn.content.includes('import '))) {
                const pointer = this.store('Extracted Context', turn.content, 'text');
                return { ...turn, content: `[Content too large — extracted to artifact. ${pointer}]` };
            }
            return turn;
        });
    }

    // ─── Persist / load ───────────────────────────────────────────────────
    async _saveToDisk(artifact) {
        const file = path.join(this._dir, `${artifact.id}.json`);
        await fs.writeFile(file, JSON.stringify(artifact, null, 2), 'utf8');
    }

    async _loadFromDisk() {
        try {
            const files = (await fs.readdir(this._dir)).filter(f => f.endsWith('.json'));
            for (const f of files) {
                try {
                    const data = JSON.parse(await fs.readFile(path.join(this._dir, f), 'utf8'));
                    if (data.id && data.content) {
                        this.artifacts.set(data.id, data);
                        // Track highest counter so new IDs don't collide
                        const n = parseInt(data.id.split('_')[1]);
                        if (!isNaN(n)) this._counter = Math.max(this._counter, n);
                    }
                } catch { /* skip corrupt files */ }
            }
            if (this.artifacts.size > 0) {
                console.log(`[ArtifactManager] ✅ Loaded ${this.artifacts.size} artifacts from disk`);
            }
        } catch { /* fresh start, dir may not exist yet */ }
    }

    getStatus() {
        return {
            count:    this.artifacts.size,
            totalKB:  Math.round([...this.artifacts.values()].reduce((s, a) => s + (a.byteSize || 0), 0) / 1024)
        };
    }
}
