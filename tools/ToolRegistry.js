// ═══════════════════════════════════════════════════════════════════════════
// ToolRegistry.js — MAX's tool management
// Tools are what MAX uses to actually DO things, not just think about them.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tolerant JSON parser ─────────────────────────────────────────────────
// LLMs (especially smaller ones) often emit malformed JSON in tool calls:
//   • Unquoted keys:   {path: "./foo"}   → {"path": "./foo"}
//   • Single quotes:   {'key': 'val'}    → {"key": "val"}
//   • Trailing commas: {"a":1,}          → {"a":1}
// Try strict parse first; if it fails apply fixes and retry.
function parseLooseJson(str) {
    try { return JSON.parse(str); } catch {}

    let s = str.trim();

    // If it doesn't look like JSON at all (no curly braces), it's a hallucinated CLI string.
    // Return null so executeLLMToolCall can try wrapping it.
    if (!s.startsWith('{') && !s.startsWith('[')) return null;

    // Single quotes → double quotes (simple values only, no nested single quotes)
    s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
    // Quote unquoted object keys: { key: → { "key":
    s = s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    // Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, '$1');

    return JSON.parse(s);
}

export class ToolRegistry {
    constructor() {
        this._tools = new Map();
    }

    register(tool) {
        if (!tool.name) throw new Error('Tool must have a name');
        this._tools.set(tool.name, tool);
    }

    get(name)  { return this._tools.get(name); }
    has(name)  { return this._tools.has(name); }

    list() {
        return [...this._tools.values()].map(t => ({
            name:        t.name,
            description: t.description,
            actions:     t.actions ? Object.keys(t.actions) : []
        }));
    }

    async execute(toolName, action, params = {}) {
        const tool = this._tools.get(toolName);
        if (!tool) throw new Error(`Unknown tool: ${toolName}. Available: ${[...this._tools.keys()].join(', ')}`);
        if (!tool.actions?.[action]) throw new Error(`Tool ${toolName} has no action: ${action}`);

        try {
            return await tool.actions[action](params);
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ─── Parse and execute a tool call from LLM output ───────────────────
    // LLM can output: TOOL:file:read:{"path":"./foo.js"}
    // Small models often emit unquoted keys, single quotes, or just raw text.
    async executeLLMToolCall(rawText) {
        const match = rawText.match(/TOOL:([^:]+):([^:]+):(.+)/s);
        if (!match) return null;

        const [, toolName, action, paramsRaw] = match;
        const trimmedParams = paramsRaw.trim();

        try {
            let params = parseLooseJson(trimmedParams);

            // Fallback: If it wasn't JSON, wrap it in a default parameter name.
            // This fixes hallucinations where the LLM just writes TOOL:shell:run:ls -la
            if (params === null) {
                if (toolName === 'shell') params = { command: trimmedParams };
                else if (toolName === 'file' && action === 'read') params = { filePath: trimmedParams };
                else if (toolName === 'web')   params = { query: trimmedParams };
                else if (toolName === 'api')   params = { url: trimmedParams };
                else throw new Error(`Invalid JSON params: ${trimmedParams}`);
            }

            return await this.execute(toolName, action, params);
        } catch (err) {
            return { success: false, error: `Tool call parse error: ${err.message}` };
        }
    }

    // ─── Build a tool manifest for the system prompt ──────────────────────
    buildManifest() {
        const tools = this.list();
        if (tools.length === 0) return '';

        const lines = [
            '',
            '## Available Tools',
            'CRITICAL: Call a tool ONLY with this exact format: TOOL:<name>:<action>:<json_params>',
            'The parameters MUST be a valid JSON object. Do not use CLI-style arguments.',
            '',
            '### Example (CORRECT):',
            'TOOL:file:read:{"filePath": "core/MAX.js"}',
            'TOOL:shell:run:{"command": "npm test"}',
            'TOOL:shell:start:{"command": "npm run dev", "name": "dev-server"}',
            'TOOL:shell:stop:{"name": "dev-server"}',
            '',
            '### Example (WRONG - DO NOT DO THIS):',
            'TOOL:file:read core/MAX.js',
            'TOOL:shell:run ls -la',
            ''
        ];

        for (const t of tools) {
            lines.push(`### ${t.name} — ${t.description}`);
            for (const a of t.actions) {
                // Heuristic for examples based on action name
                let example = '{}';
                if (t.name === 'file' && a === 'read')   example = '{"filePath": "...", "startLine": 10, "endLine": 50}';
                if (t.name === 'file' && a === 'write')  example = '{"filePath": "...", "content": "..."}';
                if (t.name === 'file' && a === 'replace') example = '{"filePath": "...", "oldText": "...", "newText": "..."}';
                if (t.name === 'file' && a === 'grep')   example = '{"dir": ".", "pattern": "async function", "filePattern": ".js"}';
                if (t.name === 'shell' && a === 'run')   example = '{"command": "npm test", "timeoutMs": 120000}';
                if (t.name === 'shell' && a === 'start') example = '{"command": "npm run dev", "name": "dev-server"}';
                if (t.name === 'shell' && a === 'stop')  example = '{"name": "dev-server"}';
                if (t.name === 'shell' && a === 'ps')    example = '{}';
                if (t.name === 'shell' && a === 'cd')    example = '{"path": "../other-project"}';
                if (t.name === 'web' && a === 'search') example = '{"query": "..."}';
                if (t.name === 'api' && a === 'request') example = '{"url": "...", "method": "GET"}';
                if (t.name === 'discord' && a === 'send') example = '{"channelId": "...", "message": "..."}';

                lines.push(`  TOOL:${t.name}:${a}:${example}`);
            }
        }
        return lines.join('\n');
    }
}
