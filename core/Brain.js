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
//   OLLAMA_MODEL_FAST=gemma3:4b         # fast tier — heartbeats, web search, background
//   DEEPSEEK_API_KEY=...               # smart + code tier
//   DEEPSEEK_MODEL=deepseek-chat       # smart tier model (default)
//   DEEPSEEK_CODE_MODEL=deepseek-reasoner  # code tier model (default)
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EconomicsEngine } from './EconomicsEngine.js';

// Load config/api-keys.env directly so Brain works regardless of how MAX is launched
const _brainDir = dirname(fileURLToPath(import.meta.url));
const _envPath  = join(_brainDir, '..', 'config', 'api-keys.env');
if (existsSync(_envPath)) {
    for (const line of readFileSync(_envPath, 'utf8').replace(/\r/g, '').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) {
            const eq = t.indexOf('=');
            if (eq > 0) {
                const k = t.slice(0, eq).trim();
                const v = t.slice(eq + 1).trim();
                if (k && v && !process.env[k]) process.env[k] = v;
            }
        }
    }
}

export class Brain {
    constructor(max, config = {}) {
        this.max          = max;
        this.config       = config;
        this.ollamaUrl    = config.ollamaUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.smartTimeout = config.smartTimeout || 120_000;  // 2 min for chat/reasoning
        this.codeTimeout  = config.codeTimeout  || 900_000;  // 15 min for large code generation
        this.timeout      = this.codeTimeout;                // legacy alias used by _deepseek default
        this.fastTimeout  = config.fastTimeout  || 90_000;

        // ── Fast tier config ─────────────────────────────────────────────
        // Local Ollama ONLY — heartbeats, yes/no checks, quick acks, verification
        this._fast = {
            ollamaModel: config.ollamaModelFast
                || process.env.OLLAMA_MODEL_FAST
                || config.ollamaModel
                || process.env.OLLAMA_MODEL
                || 'gemma3:4b',
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
        this._warmupPromise = null; // resolves when Ollama model is loaded into VRAM

        // Convenience: _ready is true if at least one tier works
        this._ready = false;
    }

    get economics() {
        return this.max?.economics;
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

        // Warm up Ollama — loads the model into VRAM. Store the promise so _runFast
        // can await it on the first real call instead of racing a cold model.
        if (this._fast.ready && this._fast.backend === 'ollama') {
            this._warmupPromise = this._ollama(this._fast.ollamaModel, 'hi', '', 0, 1, 120_000)
                .then(() => { console.log(`[Brain] ⚡ Ollama warm-up complete — model in VRAM`); })
                .catch(() => {})
                .finally(() => { this._warmupPromise = null; });
        }
    }

    // ─── Core inference ───────────────────────────────────────────────────
    // tier: 'fast' | 'smart' | 'code' — code goes straight to DeepSeek, bypassing local Ollama
    // onToken: optional (token: string) => void callback for streaming output
    // messages: optional pre-built messages array for multi-turn conversation history
    async think(prompt, { systemPrompt = '', temperature = 0.7, maxTokens = 2048, tier = 'smart', onToken = null, messages = null, signal = null } = {}) {
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

        // Pragmatic model selection if urgency/complexity is provided
        if (tier === 'pragmatic' && this.economics) {
            const recommended = this.economics.recommendModel('task', { urgency: 0.5, complexity: 0.5 });
            if (recommended === 'ollama') tier = 'fast';
            else if (recommended === 'deepseek-reasoner') tier = 'code';
            else tier = 'smart';
        }

        // Hard budget guard — block cloud API calls when daily cap exceeded
        const econ = this.max?.economics;
        if (econ?.isOverBudget() && tier !== 'fast') {
            const budget = econ.getBudgetStatus();
            const msg = `Daily budget cap reached ($${budget.used.toFixed(2)} / $${budget.cap.toFixed(2)}). Set MAX_DAILY_BUDGET in config/api-keys.env to increase.`;
            console.warn(`[Brain] 💰 ${msg}`);
            if (onToken) onToken(`[Budget cap reached — ${msg}]`);
            return { text: `Budget cap reached. Used $${budget.used.toFixed(2)} of $${budget.cap.toFixed(2)} today.`, metadata: { model: 'budget_cap', tokens: 0, latency: 0, backend: 'none' } };
        }

        let result;
        if (tier === 'fast') {
            result = await this._runFast(prompt, systemPrompt, temperature, maxTokens, onToken, messages, signal);
        } else if (tier === 'code') {
            result = await this._runCode(prompt, systemPrompt, temperature, maxTokens, onToken, messages, signal);
        } else {
            result = await this._runSmart(prompt, systemPrompt, temperature, maxTokens, onToken, messages, signal);
        }

        // Return object with text and performance metadata
        return result;
    }

    // ─── Fast tier execution — Ollama only, falls back to DeepSeek ───────
    async _runFast(prompt, systemPrompt, temperature, maxTokens, onToken = null, messages = null, signal = null) {
        if (this._fast.ready && this._fast.backend === 'ollama' && !this._fastDisabled) {
            // If warmup is still in progress, wait for it so we don't race a cold model
            if (this._warmupPromise) await this._warmupPromise;
            try {
                return await this._ollama(this._fast.ollamaModel, prompt, systemPrompt, temperature, maxTokens, this.fastTimeout, onToken, messages || null, signal);
            } catch (err) {
                this._fastFailures++;
                // Aggressive circuit breaker: 1 failure and we stop hitting local Ollama for the session.
                // This prevents "PC heat" issues from constant connection retries/timeouts.
                if (this._fastFailures >= 3) {
                    this._fastDisabled = true;
                    console.warn(`[Brain] ⚡ Fast tier disabled for this session — Ollama unresponsive (using DeepSeek for fast calls)`);
                } else {
                    console.warn(`[Brain] Fast tier (Ollama) error: ${err.message} — falling back to DeepSeek`);
                }
            }
        }
        // Ollama down/disabled — fall back to DeepSeek with a cost-capped token limit
        return this._runSmart(prompt, systemPrompt, temperature, Math.min(maxTokens, 1024), onToken, messages, signal);
    }

    // ─── Code tier — deepseek-reasoner (deep thinking for code) ──────────
    async _runCode(prompt, systemPrompt, temperature, maxTokens, onToken = null, messages = null, signal = null) {
        if (this._validKey(this._smart.deepseekKey)) {
            return this._deepseek(prompt, systemPrompt, temperature, maxTokens, this._smart.deepseekCodeModel, onToken, messages, this.codeTimeout, signal);
        }
        throw new Error('Code tier unavailable — add DEEPSEEK_API_KEY to config/api-keys.env');
    }

    // ─── Smart tier execution — DeepSeek only ────────────────────────────
    async _runSmart(prompt, systemPrompt, temperature, maxTokens, onToken = null, messages = null, signal = null) {
        if (this._validKey(this._smart.deepseekKey)) {
            return this._deepseek(prompt, systemPrompt, temperature, maxTokens, null, onToken, messages, this.smartTimeout, signal);
        }
        throw new Error('Smart tier unavailable — add DEEPSEEK_API_KEY to config/api-keys.env');
    }

    // ─── Backend implementations ──────────────────────────────────────────
    async _deepseek(prompt, systemPrompt, temperature, maxTokens, modelOverride = null, onToken = null, messages = null, timeoutMs = null, signal = null) {
        const start = Date.now();
        // Use pre-built messages array (multi-turn history) if provided, else build single-turn
        if (!messages) {
            messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: prompt });
        }

        const model = modelOverride || this._smart.deepseekModel;
        const useStream = !!onToken;

        // Combine timeout with user signal if provided
        const fetchSignal = (signal && typeof AbortSignal.any === 'function')
            ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs || this.timeout)])
            : (signal || AbortSignal.timeout(timeoutMs || this.timeout));

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
            signal: fetchSignal
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

            try {
                for await (const chunk of res.body) {
                    if (signal?.aborted) throw new Error('AbortError');
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
            } catch (err) {
                if (err.name === 'AbortError' || err.message === 'AbortError') throw err; // rethrow timeout/cancel
                console.warn(`[Brain] ⚠️ Stream interrupted: ${err.message}. Returning partial response.`);
            }

            const result = {
                text: fullText.trim(),
                metadata: {
                    model,
                    tokens:  totalTokens,
                    latency: Date.now() - start,
                    backend: 'deepseek'
                }
            };
            const econ = this.max?.economics;
            if (econ && typeof econ.recordUsage === 'function') {
                econ.recordUsage(model, prompt.length / 4, totalTokens);
            }
            return result;
        }

        // Non-streaming path
        const data = await res.json();
        const usage = data.usage || { prompt_tokens: prompt.length / 4, completion_tokens: 0 };
        const econ = this.max?.economics;
        if (econ && typeof econ.recordUsage === 'function') {
            econ.recordUsage(model, usage.prompt_tokens, usage.completion_tokens);
        }
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

    async _ollama(model, prompt, systemPrompt, temperature, maxTokens, timeoutMs = null, onToken = null, prebuiltMessages = null, signal = null) {
        const start = Date.now();

        let messages;
        if (prebuiltMessages) {
            messages = prebuiltMessages;
        } else {
            messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            const turns = prompt.split(/\n\n(?=USER:|MAX:)/);
            for (const turn of turns) {
                if (turn.startsWith('USER:')) messages.push({ role: 'user', content: turn.slice(5).trim() });
                else if (turn.startsWith('MAX:')) messages.push({ role: 'assistant', content: turn.slice(4).trim() });
                else if (turn.trim()) messages.push({ role: 'user', content: turn.trim() });
            }
        }

        const useStream = !!onToken;
        const body = {
            model,
            messages,
            stream:  useStream,
            options: { temperature, num_predict: maxTokens }
        };

        const fetchSignal = (signal && typeof AbortSignal.any === 'function')
            ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs || this.timeout)])
            : (signal || AbortSignal.timeout(timeoutMs || this.timeout));

        const res = await fetch(`${this.ollamaUrl}/api/chat`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  fetchSignal
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}`);

        let fullText = '';
        let promptTokens = 0, evalTokens = 0;

        if (useStream) {
            const decoder = new TextDecoder();
            let partial = '';
            for await (const chunk of res.body) {
                if (signal?.aborted) throw new Error('AbortError');
                partial += decoder.decode(chunk, { stream: true });
                const lines = partial.split('\n');
                partial = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        const token = json.message?.content || '';
                        if (token) { fullText += token; onToken(token); }
                        if (json.done) {
                            promptTokens = json.prompt_eval_count || 0;
                            evalTokens   = json.eval_count || 0;
                        }
                    } catch { /* partial JSON — skip */ }
                }
            }
        } else {
            const data = await res.json();
            fullText     = data.message?.content?.trim() || '';
            promptTokens = data.prompt_eval_count || 0;
            evalTokens   = data.eval_count || 0;
        }

        const econ = this.max?.economics;
        if (econ && typeof econ.recordUsage === 'function') {
            econ.recordUsage('ollama', promptTokens, evalTokens);
        }

        return {
            text: fullText.trim(),
            metadata: { model, tokens: evalTokens, latency: Date.now() - start, backend: 'ollama' }
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
