import { EventEmitter } from 'events';
import { RealLSPBridge } from './RealLSPBridge.js';

/**
 * LSPArbiter — Language intelligence hub for MAX.
 *
 * Priority order for every capability:
 *   1. Real LSP server (typescript-language-server, pylsp, gopls, …)
 *   2. AI fallback via Brain (fast tier, limited context)
 *
 * The real bridge starts servers lazily — first request per language
 * triggers the probe → spawn → initialize sequence.
 */
export class LSPArbiter extends EventEmitter {
    constructor(max) {
        super();
        this.max = max;
        this.documents = new Map(); // uri -> { content, languageId }
        this._bridge   = new RealLSPBridge();

        // Forward async push-diagnostics from real LSP servers straight to IDE
        this._bridge.on('diagnostics', ({ uri, diagnostics }) => {
            this.emit('diagnostic', { uri, diagnostics });
        });
    }

    // ── Document sync ─────────────────────────────────────────────────────

    async updateDocument(uri, content, languageId = 'javascript') {
        const existing = this.documents.get(uri);
        this.documents.set(uri, { content, languageId });

        if (!existing) {
            await this._bridge.notifyOpen(uri, languageId, content);
        } else {
            await this._bridge.notifyChange(uri, languageId, content);
        }

        // Real LSP delivers diagnostics asynchronously via publishDiagnostics.
        // Only fall back to the AI pseudo-path if no real server is available.
        const client = await this._bridge.getClient(languageId);
        if (!client) {
            const diags = await this._pseudoDiagnostics(uri, content, languageId);
            if (diags.length) this.emit('diagnostic', { uri, diagnostics: diags });
            return diags;
        }
        return [];
    }

    // ── Completions ───────────────────────────────────────────────────────

    async getCompletions(uri, position, langId, content) {
        const doc  = this.documents.get(uri);
        const lang = langId ?? doc?.languageId ?? 'javascript';

        // 1. Real LSP
        const lspResult = await this._bridge.complete(uri, position, lang, content ?? null);
        if (lspResult) return lspResult;

        // 2. AI fallback
        return this._aiCompletions(uri, position, lang, content ?? doc?.content ?? '');
    }

    // ── Hover ─────────────────────────────────────────────────────────────

    async getHover(uri, position, langId) {
        const doc  = this.documents.get(uri);
        const lang = langId ?? doc?.languageId ?? 'javascript';
        return this._bridge.hover(uri, position, lang);
    }

    // ── Definition ───────────────────────────────────────────────────────

    async getDefinition(uri, position, langId) {
        const doc  = this.documents.get(uri);
        const lang = langId ?? doc?.languageId ?? 'javascript';
        return this._bridge.definition(uri, position, lang);
    }

    // ── AI inline ghost-text completions (Cursor-style) ───────────────────
    // Called by /api/lsp/ai-complete from the IDE inline provider.

    async getAICompletion(textBeforeCursor, languageId, fileName) {
        if (!this.max.brain?._ready) return '';
        // Limit context to last 2 k chars to stay in fast-tier budget
        const ctx = textBeforeCursor.slice(-2000);
        const prompt =
`You are an expert ${languageId} developer. Complete the code below at the cursor position (marked |). Output ONLY the completion text — the characters that should appear immediately after the cursor. No explanation, no markdown, no code fences. Typically 1–4 lines.

\`\`\`${languageId}
${ctx}|\`\`\``;

        try {
            const res = await this.max.brain.think(prompt, {
                tier: 'fast', temperature: 0.15, maxTokens: 200
            });
            return res.text.trim();
        } catch {
            return '';
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────

    async _aiCompletions(uri, position, languageId, content) {
        if (!this.max.brain?._ready) return { items: [] };
        const lines   = content.split('\n');
        const context = lines.slice(Math.max(0, position.line - 15), position.line + 1).join('\n');

        const prompt =
`Complete this ${languageId} code at cursor (|). Return ONLY a JSON array of up to 10 completion strings.

${context}|

Output: ["item1", "item2", ...]`;

        try {
            const res   = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.1, maxTokens: 300 });
            const match = res.text.match(/\[[\s\S]*?\]/);
            if (!match) return { items: [] };
            const raw = JSON.parse(match[0]);
            return { items: raw.map(c => ({ label: c, kind: 1, insertText: c })) };
        } catch {
            return { items: [] };
        }
    }

    async _pseudoDiagnostics(uri, content, languageId) {
        if (!this.max.brain?._ready) return [];
        const prompt =
`Analyze this ${languageId} code snippet for syntax errors and obvious bugs ONLY.
Return ONLY a JSON array:
[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":10}},"severity":1,"message":"...","source":"MAX-LSP"}]
severity: 1=Error 2=Warning 3=Info. If no issues return [].

${content.slice(0, 3000)}`;

        try {
            const res   = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.1, maxTokens: 500 });
            const match = res.text.match(/\[[\s\S]*\]/);
            return match ? JSON.parse(match[0]) : [];
        } catch {
            return [];
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    stop() { this._bridge.stop(); }

    getStatus() {
        return {
            activeDocuments: this.documents.size,
            ...this._bridge.getStatus()
        };
    }
}
