// ═══════════════════════════════════════════════════════════════════════════
// Embedder.js — local sentence embeddings via @xenova/transformers
// Ported from SOMA LocalEmbedder.cjs — converted to ESM, graceful fallback
// Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~80MB, runs on CPU)
// ═══════════════════════════════════════════════════════════════════════════

let _pipeline = null;  // module-level cache so model loads once per process

export class Embedder {
    constructor(config = {}) {
        this.modelName = config.modelName || 'Xenova/all-MiniLM-L6-v2';
        this.dimension = 384;
        this._ready    = false;
        this._loading  = false;
        this._loadErr  = null;
    }

    async initialize() {
        if (this._ready)   return true;
        if (this._loadErr) return false;
        if (this._loading) {
            // Wait for the in-progress load
            while (this._loading) await new Promise(r => setTimeout(r, 100));
            return this._ready;
        }

        this._loading = true;
        try {
            // Dynamic import so the whole module doesn't crash if pkg is missing
            const { pipeline } = await import('@xenova/transformers');
            if (!_pipeline) {
                console.log(`[Embedder] Loading ${this.modelName} (first run ~80MB download)...`);
                _pipeline = await pipeline('feature-extraction', this.modelName);
                console.log('[Embedder] ✅ Model ready');
            }
            this._ready   = true;
            this._loading = false;
            return true;
        } catch (err) {
            this._loadErr = err.message;
            this._loading = false;
            console.warn(`[Embedder] ⚠️  Could not load model: ${err.message}`);
            console.warn('[Embedder]    Install: npm install @xenova/transformers');
            console.warn('[Embedder]    Memory will fall back to keyword search');
            return false;
        }
    }

    async embed(text) {
        if (!this._ready) {
            const ok = await this.initialize();
            if (!ok) return null;
        }

        const clean  = text.replace(/\n/g, ' ').trim().slice(0, 512);  // model input limit
        const output = await _pipeline(clean, { pooling: 'mean', normalize: true });
        return Array.from(output.data);  // Float32Array → plain array
    }

    // ── Cosine similarity (both vectors normalized, so = dot product) ──────
    static cosine(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0;
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        return dot;  // Already normalized from pipeline
    }
}
