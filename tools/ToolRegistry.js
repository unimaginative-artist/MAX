// ═══════════════════════════════════════════════════════════════════════════
// ToolRegistry.js — MAX's tool management
// Tools are what MAX uses to actually DO things, not just think about them.
// ═══════════════════════════════════════════════════════════════════════════

export class ToolRegistry {
    constructor() {
        this._tools = new Map();
    }

    register(tool) {
        if (!tool.name) throw new Error('Tool must have a name');
        this._tools.set(tool.name, tool);
    }

    get(name) {
        return this._tools.get(name);
    }

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
    // LLM can output: TOOL:file.read:{"path":"./foo.js"}
    async executeLLMToolCall(rawText) {
        const match = rawText.match(/TOOL:([^:]+):([^:]+):(.+)/);
        if (!match) return null;

        const [, toolName, action, paramsJson] = match;
        try {
            const params = JSON.parse(paramsJson);
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
