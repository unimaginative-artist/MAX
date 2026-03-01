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

    let s = str;
    // Single quotes → double quotes (simple values only, no nested single quotes)
    s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
    // Quote unquoted object keys: { key: → { "key":
    s = s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
    // Remove trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, '$1');

    return JSON.parse(s); // let the outer catch surface any remaining error
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
    // Small models often emit unquoted keys or single quotes — parseLooseJson handles it.
    async executeLLMToolCall(rawText) {
        const match = rawText.match(/TOOL:([^:]+):([^:]+):(.+)/s);
        if (!match) return null;

        const [, toolName, action, paramsJson] = match;
        try {
            const params = parseLooseJson(paramsJson.trim());
            return await this.execute(toolName, action, params);
        } catch (err) {
            return { success: false, error: `Tool call parse error: ${err.message}` };
        }
    }

    // ─── Build a tool manifest for the system prompt ──────────────────────
    buildManifest() {
        const tools = this.list();
        if (tools.length === 0) return '';

        const lines = ['', '## Available Tools', 'Call a tool with: TOOL:<name>:<action>:<json_params>', ''];
        for (const t of tools) {
            lines.push(`### ${t.name} — ${t.description}`);
            for (const a of t.actions) {
                lines.push(`  TOOL:${t.name}:${a}:{...params}`);
            }
        }
        return lines.join('\n');
    }
}
