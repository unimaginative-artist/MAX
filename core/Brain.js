// ═══════════════════════════════════════════════════════════════════════════
// Brain.js — MAX's tiered LLM router
//
// Two tiers, each with its own fallback chain:
//
//   fast  → small local Ollama model (OLLAMA_MODEL_FAST)
//            fallback: smart tier (so nothing is ever silent)
//
//   smart → large Ollama model (OLLAMA_MODEL_SMART)
//            → Gemini (GEMINI_API_KEY)
//            → OpenAI-compatible (OPENAI_API_KEY)
//            fallback: fast tier
//
// Usage: brain.think(prompt, { tier: 'fast' | 'smart' })
//        tier defaults to 'smart' — existing callers unchanged
//
// Config (config/api-keys.env):
//   OLLAMA_MODEL_FAST=gemma3:4b        # background tasks
//   OLLAMA_MODEL_SMART=llama3.1:8b     # deep reasoning (optional — falls to Gemini)
//   GEMINI_API_KEY=...                 # smart tier
//   OPENAI_API_KEY=...                 # smart tier
//   OPENAI_MODEL=gpt-4o                # smart tier model override
//   OPENAI_BASE_URL=...                # optional — for local OpenAI-compatible servers
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export class Brain {
    constructor(config = {}) {
        this.ollamaUrl    = config.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.timeout      = config.timeout     || 240_000;  // smart tier — 4 mins
        this.fastTimeout  = config.fastTimeout || 180_000;  // fast tier — 3 mins

        // ── Fast tier config ─────────────────────────────────────────────
        // Small local model — low latency, used for background tasks
        this._fast = {
            ollamaModel: config.ollamaModelFast
                || process.env.OLLAMA_MODEL_FAST
                || config.ollamaModel
                || process.env.OLLAMA_MODEL
                || 'qwen3:8b',
            ready:   false,
            backend: null   // 'ollama' | null
        };

        // ── Smart tier config ────────────────────────────────────────────
        // Best available model — used for user chat, reasoning, swarm, debate
        this._smart = {
            ollamaModel: config.ollamaModelSmart
                || process.env.OLLAMA_MODEL_SMART
                || null,   // null = skip Ollama for smart tier, go straight to API
            geminiKey:   config.geminiKey  || process.env.GEMINI_API_KEY,
            geminiModel: config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview',
            openaiKey:   config.openaiKey  || process.env.OPENAI_API_KEY,
            openaiUrl:   config.openaiUrl  || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            openaiModel: config.openaiModel || process.env.OPENAI_MODEL   || 'gpt-4o',
            ready:   false,
            backend: null   // 'ollama' | 'gemini' | 'openai' | null
        };

        // Convenience: _ready is true if at least one tier works
        this._ready = false;
    }

    // ─── Initialize — probe all backends ─────────────────────────────────
    async initialize() {
        const ollamaOk = await this._checkOllama();

        // Fast tier
        if (ollamaOk) {
            this._fast.ready   = true;
            this._fast.backend = 'ollama';
            console.log(`[Brain] ⚡ Fast tier  — Ollama / ${this._fast.ollamaModel}`);
        } else {
            console.log('[Brain] ⚠️  Fast tier  — Ollama unavailable (will use smart as fallback)');
        }

        // Smart tier — try in order: Ollama large → Gemini → OpenAI
        if (this._smart.ollamaModel && ollamaOk) {
            this._smart.ready   = true;
            this._smart.backend = 'ollama';
            console.log(`[Brain] 🧠 Smart tier — Ollama / ${this._smart.ollamaModel}`);
        } else if (this._validKey(this._smart.geminiKey)) {
            this._smart.ready   = true;
            this._smart.backend = 'gemini';
            console.log(`[Brain] 🧠 Smart tier — Gemini / ${this._smart.geminiModel}`);
        } else if (this._validKey(this._smart.openaiKey)) {
            this._smart.ready   = true;
            this._smart.backend = 'openai';
            console.log(`[Brain] 🧠 Smart tier — OpenAI-compatible / ${this._smart.openaiModel}`);
        } else if (ollamaOk) {
            // No API keys — fall back smart to the same Ollama model as fast
            this._smart.ready        = true;
            this._smart.backend      = 'ollama';
            this._smart.ollamaModel  = this._fast.ollamaModel;
            console.log(`[Brain] 🧠 Smart tier — Ollama / ${this._smart.ollamaModel} (same as fast — add API key to upgrade)`);
        } else {
            console.log('[Brain] ⚠️  Smart tier — no backend available');
        }

        this._ready = this._fast.ready || this._smart.ready;

        if (!this._ready) {
            console.error('[Brain] ❌ No LLM backend found. Start Ollama or set an API key in config/api-keys.env');
        }
    }

    // ─── Core inference ───────────────────────────────────────────────────
    // tier: 'fast' (background/heartbeat) | 'smart' (user chat/reasoning) — default smart
    async think(prompt, { systemPrompt = '', temperature = 0.7, maxTokens = 2048, tier = 'smart' } = {}) {
        if (!this._ready) throw new Error('Brain not initialized — call initialize() first');

        // Hard token budget guard — prevents context overflow errors.
        // Rough estimate: 1 token ≈ 4 chars. Reserve maxTokens for completion.
        // If we're over budget, truncate prompt from the FRONT (drop oldest turns).
        const CONTEXT_LIMIT = 100_000;  // conservative ceiling across all backends
        const charBudget    = (CONTEXT_LIMIT - maxTokens) * 4;
        const sysLen        = systemPrompt.length;
        const promptBudget  = Math.max(charBudget - sysLen, 10_000);

        if (prompt.length > promptBudget) {
            const truncated = prompt.slice(-promptBudget);
            // Try to start at a clean turn boundary so we don't cut mid-sentence
            const boundary  = truncated.indexOf('\n\nUSER:');
            prompt = boundary > 0 ? truncated.slice(boundary) : truncated;
            console.warn(`[Brain] ✂️  Prompt truncated to fit context window (budget: ${Math.round(promptBudget / 1000)}K chars)`);
        }

        let result;
        if (tier === 'fast') {
            result = await this._runFast(prompt, systemPrompt, temperature, maxTokens);
        } else {
            result = await this._runSmart(prompt, systemPrompt, temperature, maxTokens);
        }

        // Return object with text and performance metadata
        return result;
    }

    // ─── Fast tier execution ──────────────────────────────────────────────
    async _runFast(prompt, systemPrompt, temperature, maxTokens) {
        if (this._fast.ready && this._fast.backend === 'ollama') {
            try {
                return await this._ollama(this._fast.ollamaModel, prompt, systemPrompt, temperature, maxTokens, this.fastTimeout);
            } catch (err) {
                console.warn(`[Brain] Fast tier error: ${err.message} — falling back to smart`);
                // skipOllama=true: Ollama just failed, don't try it again in smart's fallback chain
                return this._runSmart(prompt, systemPrompt, temperature, Math.min(maxTokens, 512), true);
            }
        }
        return this._runSmart(prompt, systemPrompt, temperature, Math.min(maxTokens, 512));
    }

    // ─── Smart tier execution ─────────────────────────────────────────────
    // skipOllama: true when called as fallback from _runFast (Ollama already failed)
    async _runSmart(prompt, systemPrompt, temperature, maxTokens, skipOllama = false) {
        const t = this._smart;

        if (!skipOllama && t.ready && t.backend === 'ollama' && t.ollamaModel) {
            try {
                return await this._ollama(t.ollamaModel, prompt, systemPrompt, temperature, maxTokens);
            } catch (err) {
                console.warn(`[Brain] Smart Ollama error: ${err.message} — trying next`);
            }
        }

        if (this._validKey(t.geminiKey)) {
            try {
                return await this._gemini(prompt, systemPrompt, temperature, maxTokens);
            } catch (err) {
                console.warn(`[Brain] Gemini error: ${err.message} — trying next`);
            }
        }

        if (this._validKey(t.openaiKey)) {
            try {
                return await this._openai(prompt, systemPrompt, temperature, maxTokens);
            } catch (err) {
                console.warn(`[Brain] OpenAI error: ${err.message} — trying fast fallback`);
            }
        }

        // Last resort: fast Ollama — but only if it hasn't already failed this request
        if (!skipOllama && this._fast.ready) {
            return this._ollama(this._fast.ollamaModel, prompt, systemPrompt, temperature, Math.min(maxTokens, 512));
        }

        throw new Error('All LLM backends failed');
    }

    // ─── Backend implementations ──────────────────────────────────────────
    async _ollama(model, prompt, systemPrompt, temperature, maxTokens, timeoutMs = null) {
        const start = Date.now();
        const body = {
            model,
            prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
            stream:  false,
            options: { temperature, num_predict: maxTokens }
        };
        const res = await fetch(`${this.ollamaUrl}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(timeoutMs || this.timeout)
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        const data = await res.json();
        
        return {
            text: data.response?.trim() || '',
            metadata: {
                model,
                tokens:  data.eval_count || 0,
                latency: Date.now() - start,
                backend: 'ollama'
            }
        };
    }

    async _gemini(prompt, systemPrompt, temperature, maxTokens) {
        const start = Date.now();
        const combined = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        const body = {
            contents: [{ parts: [{ text: combined }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens }
        };
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._smart.geminiModel}:generateContent?key=${this._smart.geminiKey}`;
        const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(this.timeout)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Gemini ${res.status}: ${err}`);
        }
        const data = await res.json();
        return {
            text: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '',
            metadata: {
                model:   this._smart.geminiModel,
                tokens:  0, // Gemini API doesn't return usage in simple form here
                latency: Date.now() - start,
                backend: 'gemini'
            }
        };
    }

    async _openai(prompt, systemPrompt, temperature, maxTokens) {
        const start = Date.now();
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });

        const res = await fetch(`${this._smart.openaiUrl}/chat/completions`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${this._smart.openaiKey}`
            },
            body:   JSON.stringify({ model: this._smart.openaiModel, messages, temperature, max_tokens: maxTokens }),
            signal: AbortSignal.timeout(this.timeout)
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI ${res.status}: ${err}`);
        }
        const data = await res.json();
        return {
            text: data.choices?.[0]?.message?.content?.trim() || '',
            metadata: {
                model:   data.model,
                tokens:  data.usage?.total_tokens || 0,
                latency: Date.now() - start,
                backend: 'openai'
            }
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────
    async _checkOllama() {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    _validKey(key) {
        return key && key.length > 10 && !key.includes('your-') && !key.includes('here');
    }

    getStatus() {
        return {
            ready:       this._ready,
            fast:  { backend: this._fast.backend,  model: this._fast.ollamaModel,  ready: this._fast.ready  },
            smart: { backend: this._smart.backend, model: this._smart.ollamaModel || (this._smart.backend === 'openai' ? this._smart.openaiModel : this._smart.geminiModel), ready: this._smart.ready }
        };
    }
}
