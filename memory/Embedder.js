// ═══════════════════════════════════════════════════════════════════════════
// Embedder.js — local sentence embeddings via @xenova/transformers
// Ported from SOMA LocalEmbedder.cjs — converted to ESM, graceful fallback
// Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~80MB, runs on CPU)
// ═══════════════════════════════════════════════════════════════════════════

import { Worker, isMainThread, parentPort } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _worker = null;
let _pendingTasks = new Map();
let _taskId = 0;

let _pipeline = null; // For the worker thread itself

export class Embedder {
    constructor(config = {}) {
        this.modelName = config.modelName || 'Xenova/all-MiniLM-L6-v2';
        this.dimension = 384;
        this._ready    = false;
        this._initPromise = null;
    }

    async initialize() {
        if (this._ready) return true;
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            try {
                if (isMainThread) {
                    // We are in the main thread: spawn the background worker
                    const workerPath = join(__dirname, '..', 'core', 'HeavyWorker.js');
                    _worker = new Worker(workerPath);

                    _worker.on('message', (msg) => {
                        const task = _pendingTasks.get(msg.id);
                        if (!task) return;

                        if (msg.type === 'success' || msg.type === 'pong') {
                            task.resolve(msg.result);
                        } else {
                            task.reject(new Error(msg.error));
                        }
                        _pendingTasks.delete(msg.id);
                    });

                    _worker.on('error', (err) => {
                        console.error('[Embedder] Worker thread error:', err);
                    });

                    // Verify worker is alive
                    await this._runTask('ping', {});
                    console.log('[Embedder] ✅ Background worker online');
                    this._ready = true;
                    return true;
                } else {
                    // We are inside the worker thread: load the actual model natively
                    const { pipeline, env } = await import('@xenova/transformers');
                    env.allowLocalModels = true;
                    
                    console.log(`[Embedder Worker] Loading ${this.modelName}...`);
                    _pipeline = await pipeline('feature-extraction', this.modelName);
                    console.log('[Embedder Worker] ✅ Model ready in background');
                    this._ready = true;
                    return true;
                }
            } catch (err) {
                console.error(`[Embedder] ⚠️ Initialization failed: ${err.message}`);
                return false;
            }
        })();

        return this._initPromise;
    }

    async _runTask(type, payload) {
        if (!isMainThread) throw new Error("Cannot run background tasks from within a worker.");
        const id = _taskId++;
        return new Promise((resolve, reject) => {
            _pendingTasks.set(id, { resolve, reject });
            _worker.postMessage({ id, type, payload });
        });
    }

    async embed(text) {
        if (!this._ready) {
            const ok = await this.initialize();
            if (!ok) return null;
        }

        try {
            if (isMainThread) {
                // Offload to worker
                return await this._runTask('embed', { text });
            } else {
                // Actually compute the embedding inside the worker
                const clean  = text.replace(/\n/g, ' ').trim().slice(0, 512);
                const output = await _pipeline(clean, { pooling: 'mean', normalize: true });
                return Array.from(output.data);
            }
        } catch (err) {
            console.warn(`[Embedder] ⚠️ Embedding failed: ${err.message}`);
            return null;
        }
    }

    static cosine(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot;
    }
}

