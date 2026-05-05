
/**
 * ToolRegistry — The central repository for all MAX tools.
 * Handles registration, discovery, and execution of both internal and SOMA tools.
 */
export class ToolRegistry {
    constructor() {
        this._tools = new Map();
    }

    /**
     * Register a new tool or toolset.
     * @param {Object} tool - { name, description, actions: { actionName: fn } }
     */
    register(tool) {
        if (!tool.name) throw new Error('Tool must have a name');
        this._tools.set(tool.name, tool);
    }

    get(name)  { return this._tools.get(name); }
    has(name)  { return this._tools.has(name); }

    /**
     * List all registered tools and their actions.
     */
    list() {
        return [...this._tools.values()].map(t => ({
            name:        t.name,
            description: t.description,
            actions:     t.actions ? Object.keys(t.actions) : []
        }));
    }

    /**
     * Execute a specific tool action.
     */
    async execute(toolName, action, params = {}) {
        const tool = this._tools.get(toolName);
        if (!tool) {
            throw new Error(`Unknown tool: ${toolName}. Available: ${[...this._tools.keys()].join(', ')}`);
        }

        try {
            // Handle Object-based tools (actions map)
            if (tool.actions && typeof tool.actions[action] === 'function') {
                return await tool.actions[action](params);
            }
            // Handle Class-based tools (run method)
            if (typeof tool.run === 'function') {
                return await tool.run({ action, ...params });
            }
            throw new Error(`Action ${action} not supported by tool ${toolName}`);
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Parse and execute a tool call from raw LLM output.
     * Expected format: TOOL:toolName:actionName:{"param":"value"}
     */
    async executeLLMToolCall(rawCall) {
        const trimmed = rawCall.trim();
        if (!trimmed.startsWith('TOOL:')) return null;

        const parts = trimmed.split(':');
        if (parts.length < 3) return { success: false, error: 'Malformed tool call. Use TOOL:tool:action:params' };

        const toolName = parts[1];
        const action   = parts[2];
        let params     = {};

        // Extract JSON params if present
        const jsonStart = trimmed.indexOf('{');
        if (jsonStart !== -1) {
            try {
                // Heuristic: everything from the first '{' to the last '}'
                const jsonStr = trimmed.slice(jsonStart, trimmed.lastIndexOf('}') + 1);
                params = JSON.parse(jsonStr);
            } catch (err) {
                // Fallback for messy LLM output: try to find unquoted keys/values
                // (Very basic — if this fails, the tool will report the error)
            }
        } else if (parts[3]) {
            // Fallback for simple single-string param: TOOL:tool:action:value
            params = { value: parts.slice(3).join(':') };
        }

        return await this.execute(toolName, action, params);
    }

    /**
     * Build a string manifest of all tools for the system prompt.
     */
    buildManifest() {
        let manifest = '\n\n## Available Tools\n';
        for (const tool of this._tools.values()) {
            const oneliner = (tool.description || '').split('\n')[0].slice(0, 100);
            const actions  = tool.actions ? Object.keys(tool.actions).join(', ') : '';
            manifest += `- **${tool.name}**: ${oneliner}${actions ? ` [${actions}]` : ''}\n`;
        }
        return manifest;
    }
}
