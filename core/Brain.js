// ═══════════════════════════════════════════════════════════════════════════
// Brain.js — MAX's tiered LLM router
//
// Tier routing:
//
//   fast  → Ollama local model ONLY (heartbeats, web searches, yes/no, acks)
//            fallback: DeepSeek if Ollama is down
//
//   smart → DeepSeek (deepseek-chat) — ONLY, no fallback
//
//   code  → DeepSeek (deepseek-reasoner) — ONLY, no fallback
//
// Config (config/api-keys.env):
//   OLLAMA_MODEL_FAST=qwen3:1.5b       # fast tier — heartbeats, web search, background
//   DEEPSEEK_API_KEY=...               # smart + code tier
//   DEEPSEEK_MODEL=deepseek-chat       # smart tier model (default)
//   DEEPSEEK_CODE_MODEL=deepseek-reasoner  # code tier model (default)
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export class Brain {
    constructor(config = {}) {
        this.ollamaUrl    = config.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.timeout      = config.timeout     || 240_000;  // smart/code tier — 4 mins
        this.fastTimeout  = config.fastTimeout || 30_000;   // fast tier — 30s max (heartbeats/acks)

        // ── Fast tier config ─────────────────────────────────────────────
        // Local Ollama ONLY — heartbeats, yes/no checks, quick acks, verification
        this._fast = {
            ollamaModel: config.ollamaModelFast
                || process.env.OLLAMA_MODEL_FAST
                || config.ollamaModel
                || process.env.OLLAMA_MODEL
                || 'qwen3:1.5b',
            ready:   false,
            backend: null   // 'ollama' | null
        };

        // ── Smart tier config ────────────────────────────────────────────
        // DeepSeek only — no OpenAI, no Ollama.
        this._smart = {
            deepseekKey:       config.deepseekKey       || process.env.DEEPSEEK_API_KEY,
            deepseekUrl:       config.deepseekUrl       || process.env.DEEPSEEK_BASE_URL  || 'https://api.deepseek.com',
            deepseekModel:     config.deepseekModel     || process.env.DEEPSEEK_MODEL      || 'deepseek-chat',
            deepseekCodeModel: config.deepseekCodeModel || process.env.DEEPSEEK_CODE_MODEL || 'deepseek-reasoner',
            ready:   false,
            backend: null   // 'deepseek' | null
        };

        // Circuit breaker — after N fast-tier timeouts, stop hitting Ollama this session
        this._fastFailures = 0;
        this._fastDisabled = false;

        // Convenience: _ready is true if at least one tier works
        this._ready = false;
    }

    // ─── Initialize — probe all backends ─────────────────────────────────
    async initialize() {
        const ollamaModels = await this._checkOllama();

        // Fast tier — only mark ready if the specific model is actually pulled
        if (ollamaModels) {
            const modelName = this._fast.ollamaModel.split(':')[0].toLowerCase();
            const hasModel  = ollamaModels.some(m => m.toLowerCase().includes(modelName));
            if (hasModel) {
                this._fast.ready   = true;
                this._fast.backend = 'ollama';
                console.log(`[Brain] ⚡ Fast tier  — Ollama / ${this._fast.ollamaModel}`);
            } else {
                console.log(`[Brain] ⚠️  Fast tier  — Ollama running but model "${this._fast.ollamaModel}" not found (run: ollama pull ${this._fast.ollamaModel})`);
            }
        } else {
            console.log('[Brain] ⚠️  Fast tier  — Ollama not running (fast calls will use DeepSeek)');
        }

        // Smart tier — DeepSeek only.
        if (this._validKey(this._smart.deepseekKey)) {
            this._smart.ready   = true;
            this._smart.backend = 'deepseek';
            console.log(`[Brain] 🧠 Smart tier — DeepSeek / ${this._smart.deepseekModel}`);
            console.log(`[Brain] 💻 Code  tier — DeepSeek / ${this._smart.deepseekCodeModel}`);
        } else {
            console.log('[Brain] ⚠️  Smart tier — no API key (add DEEPSEEK_API_KEY to config/api-keys.env)');
        }

        this._ready = this._fast.ready || this._smart.ready;

        if (!this._ready) {
            console.error('[Brain] ❌ No LLM backend found. Start Ollama or set an API key in config/api-keys.env');
        }
    }

    // ─── Core inference ───────────────────────────────────────────────────
    // tier: 'fast' | 'smart' | 'code' — code goes straight to DeepSeek, bypassing local Ollama
    // onToken: optional (token: string) => void callback for streaming output
    async think(prompt, { systemPrompt = '', temperature = 0.7, maxTokens = 2048, tier = 'smart', onToken = null } = {}) {
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
        } else if (tier === 'code') {
            result = await this._runCode(prompt, systemPrompt, temperature, maxTokens, onToken);
        } else {
            result = await this._runSmart(prompt, systemPrompt, temperature, maxTokens, onToken);
        }

        // Return object with text and performance metadata
        return result;
    }

    // ─── Fast tier execution — Ollama only, falls back to DeepSeek ───────
    async _runFast(prompt, systemPrompt, temperature, maxTokens) {
        if (this._fast.ready && this._fast.backend === 'ollama' && !this._fastDisabled) {
            try {
                return await this._ollama(this._fast.ollamaModel, prompt, systemPrompt, temperature, maxTokens, this.fastTimeout);
            } catch (err) {
                this._fastFailures++;
                if (this._fastFailures >= 2) {
                    this._fastDisabled = true;
                    console.warn(`[Brain] ⚡ Fast tier disabled for this session — Ollama unresponsive (using DeepSeek for fast calls)`);
                } else {
                    console.warn(`[Brain] Fast tier (Ollama) error: ${err.message} — falling back to DeepSeek`);
                }
            }
        }
        // Ollama down/disabled — use DeepSeek with capped tokens
        return this._runSmart(prompt, systemPrompt, temperature, Math.min(maxTokens, 512));
    }

    // ─── Code tier — deepseek-reasoner (deep thinking for code) ──────────
    async _runCode(prompt, systemPrompt, temperature, maxTokens, onToken = null) {
        if (this._validKey(this._smart.deepseekKey)) {
            return this._deepseek(prompt, systemPrompt, temperature, maxTokens, this._smart.deepseekCodeModel, onToken);
        }
        throw new Error('Code tier unavailable — add DEEPSEEK_API_KEY to config/api-keys.env');
    }

    // ─── Smart tier execution — DeepSeek only ────────────────────────────
    async _runSmart(prompt, systemPrompt, temperature, maxTokens, onToken = null) {
        if (this._validKey(this._smart.deepseekKey)) {
            return this._deepseek(prompt, systemPrompt, temperature, maxTokens, null, onToken);
        }
        throw new Error('Smart tier unavailable — add DEEPSEEK_API_KEY to config/api-keys.env');
    }

    // ─── Backend implementations ──────────────────────────────────────────
    async _deepseek(prompt, systemPrompt, temperature, maxTokens, modelOverride = null, onToken = null) {
        const start = Date.now();
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });

        const model = modelOverride || this._smart.deepseekModel;
        const useStream = !!onToken;

        const res = await fetch(`${this._smart.deepseekUrl}/chat/completions`, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${this._smart.deepseekKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens: maxTokens,
                stream: useStream
            }),
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`DeepSeek ${res.status}: ${err}`);
        }

        if (useStream) {
            // SSE streaming — fire onToken per chunk, return full text when done
            let fullText = '';
            let totalTokens = 0;
            const decoder = new TextDecoder();
            let partial = '';  // carry-over for chunks split across SSE boundaries

            for await (const chunk of res.body) {
                partial += decoder.decode(chunk, { stream: true });
                const lines = partial.split('\n');
                // Keep the last (potentially incomplete) line as carry-over
                partial = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const raw = line.slice(6).trim();
                    if (raw === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(raw);
                        const token = parsed.choices?.[0]?.delta?.content;
                        if (token) {
                            fullText += token;
                            onToken(token);
                        }
                        if (parsed.usage) totalTokens = parsed.usage.total_tokens || 0;
                    } catch { /* partial JSON chunk — skip */ }
                }
            }

            return {
                text: fullText.trim(),
                metadata: {
                    model,
                    tokens:  totalTokens,
                    latency: Date.now() - start,
                    backend: 'deepseek'
                }
            };
        }

        // Non-streaming path (unchanged)
        const data = await res.json();
        return {
            text: data.choices?.[0]?.message?.content?.trim() || '',
            metadata: {
                model:   data.model,
                tokens:  data.usage?.total_tokens || 0,
                latency: Date.now() - start,
                backend: 'deepseek'
            }
        };
    }

    async _ollama(model, prompt, systemPrompt, temperature, maxTokens, timeoutMs = null) {
        const start = Date.now();

        // Use /api/chat with proper message structure so the model tracks conversation
        // context correctly. /api/generate flattens everything into one blob and small
        // models lose track of conversation state, producing repeated responses.
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

        // Parse flat "USER: .../MAX: ..." history back into structured message objects
        const turns = prompt.split(/\n\n(?=USER:|MAX:)/);
        for (const turn of turns) {
            if (turn.startsWith('USER:')) {
                messages.push({ role: 'user', content: turn.slice(5).trim() });
            } else if (turn.startsWith('MAX:')) {
                messages.push({ role: 'assistant', content: turn.slice(4).trim() });
            } else if (turn.trim()) {
                messages.push({ role: 'user', content: turn.trim() });
            }
        }

        const body = {
            model,
            messages,
            stream:  false,
            options: { temperature, num_predict: maxTokens }
        };
        const res = await fetch(`${this.ollamaUrl}/api/chat`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  AbortSignal.timeout(timeoutMs || this.timeout)
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        const data = await res.json();

        return {
            text: data.message?.content?.trim() || '',
            metadata: {
                model,
                tokens:  data.eval_count || 0,
                latency: Date.now() - start,
                backend: 'ollama'
            }
        };
    }


    // ─── Helpers ──────────────────────────────────────────────────────────
    // Returns array of model name strings if Ollama is reachable, null otherwise
    async _checkOllama() {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            if (!res.ok) return null;
            const data = await res.json();
            return (data.models || []).map(m => m.name || m.model || '');
        } catch {
            return null;
        }
    }

    _validKey(key) {
        return key && key.length > 10 && !key.includes('your-') && !key.includes('here');
    }

    getStatus() {
        return {
            ready: this._ready,
            fast:  { backend: this._fast.backend,  model: this._fast.ollamaModel,     ready: this._fast.ready  },
            smart: { backend: this._smart.backend, model: this._smart.deepseekModel,  ready: this._smart.ready },
            code:  { backend: this._smart.backend, model: this._smart.deepseekCodeModel, ready: this._smart.ready },
        };
    }
}
