// ═══════════════════════════════════════════════════════════════════════════
// Brain.js — MAX's LLM abstraction
// Supports Ollama (local), Gemini, OpenAI-compatible endpoints
// Falls back gracefully: Ollama → Gemini → error
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export class Brain {
    constructor(config = {}) {
        this.ollamaUrl  = config.ollamaUrl  || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.ollamaModel = config.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2';
        this.geminiKey  = config.geminiKey  || process.env.GEMINI_API_KEY;
        this.openaiKey  = config.openaiKey  || process.env.OPENAI_API_KEY;
        this.openaiUrl  = config.openaiUrl  || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        this.openaiModel = config.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
        this.timeout    = config.timeout || 60000;

        // Which backend is active
        this._backend = null;
        this._ready   = false;
    }

    async initialize() {
        // Try Ollama first
        if (await this._checkOllama()) {
            this._backend = 'ollama';
            this._ready   = true;
            console.log(`[Brain] ✅ Ollama connected — model: ${this.ollamaModel}`);
            return;
        }
        // Try Gemini
        if (this.geminiKey && this.geminiKey !== 'your-gemini-key-here') {
            this._backend = 'gemini';
            this._ready   = true;
            console.log('[Brain] ✅ Gemini connected');
            return;
        }
        // Try OpenAI-compatible
        if (this.openaiKey && this.openaiKey !== 'your-openai-key-here') {
            this._backend = 'openai';
            this._ready   = true;
            console.log(`[Brain] ✅ OpenAI-compatible connected — model: ${this.openaiModel}`);
            return;
        }

        console.error('[Brain] ❌ No LLM backend found. Start Ollama or set an API key in config/api-keys.env');
        this._ready = false;
    }

    async _checkOllama() {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    // ── Core inference ───────────────────────────────────────────────────────
    async think(prompt, { systemPrompt = '', temperature = 0.7, maxTokens = 2048 } = {}) {
        if (!this._ready) throw new Error('Brain not initialized — call initialize() first');

        switch (this._backend) {
            case 'ollama':  return this._ollama(prompt, systemPrompt, temperature, maxTokens);
            case 'gemini':  return this._gemini(prompt, systemPrompt, temperature, maxTokens);
            case 'openai':  return this._openai(prompt, systemPrompt, temperature, maxTokens);
            default:        throw new Error('No backend');
        }
    }

    async _ollama(prompt, systemPrompt, temperature, maxTokens) {
        const body = {
            model: this.ollamaModel,
            prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
            stream: false,
            options: { temperature, num_predict: maxTokens }
        };

        const res = await fetch(`${this.ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const data = await res.json();
        return data.response?.trim() || '';
    }

    async _gemini(prompt, systemPrompt, temperature, maxTokens) {
        const combined = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
        const body = {
            contents: [{ parts: [{ text: combined }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens }
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Gemini error ${res.status}: ${err}`);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    async _openai(prompt, systemPrompt, temperature, maxTokens) {
        const messages = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: prompt });

        const res = await fetch(`${this.openaiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openaiKey}`
            },
            body: JSON.stringify({ model: this.openaiModel, messages, temperature, max_tokens: maxTokens }),
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI error ${res.status}: ${err}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }

    getStatus() {
        return { ready: this._ready, backend: this._backend, model: this.ollamaModel };
    }
}
