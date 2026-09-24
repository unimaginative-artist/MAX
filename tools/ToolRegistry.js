
/**
 * ToolRegistry — The central repository for all MAX tools.
 * Handles registration, discovery, and execution of both internal and SOMA tools.
 */
const ACTION_ALIASES = new Map([
    ['shell.runstateful', 'run'],
    ['shell.run_stateful', 'run'],
    ['diagnostics.check', 'status'],
    ['diagnostics.inspect', 'status'],
    ['diagnostics.health', 'status'],
    ['diagnostics.audit', 'run'],
    ['system.health', 'diagnostics'],
    ['system.check', 'diagnostics'],
    ['system.audit', 'diagnostics'],
]);

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
     * Resolve model-generated names before policy evaluation or execution.
     * Object-based tools get strict action validation; class-based tools
     * retain their own dynamic action dispatch through run().
     */
    resolveCall(toolName, action) {
        const requestedTool = String(toolName || '');
        let canonicalTool = [...this._tools.keys()].find(
            name => name.toLowerCase() === requestedTool.toLowerCase()
        );
        if (!canonicalTool) {
            const TOOL_ALIASES = {
                'health': 'diagnostics',
                'system_diagnostics': 'diagnostics',
                'system_status': 'system',
                'sys': 'system'
            };
            const mapped = TOOL_ALIASES[requestedTool.toLowerCase()];
            if (mapped) {
                canonicalTool = [...this._tools.keys()].find(
                    name => name.toLowerCase() === mapped
                );
            }
        }
        if (!canonicalTool) {
            return {
                success: false,
                error: `Unknown tool: ${requestedTool}. Available: ${[...this._tools.keys()].join(', ')}`
            };
        }

        const tool = this._tools.get(canonicalTool);
        const requestedAction = String(action || '');
        let alias = ACTION_ALIASES.get(`${canonicalTool.toLowerCase()}.${requestedAction.toLowerCase()}`);

        // Intelligent semantic heuristic fallback for local LLM variations
        if (!alias && tool.actions) {
            const reqLower = requestedAction.toLowerCase();
            if (canonicalTool.toLowerCase() === 'file') {
                if (reqLower.startsWith('read') || reqLower.includes('.txt') || reqLower.includes('.js') || reqLower.includes('.md')) alias = 'read';
                else if (reqLower.startsWith('write') || reqLower.startsWith('create') || reqLower.startsWith('save')) alias = 'write';
                else if (reqLower.startsWith('list') || reqLower.startsWith('dir') || reqLower === 'ls') alias = 'list';
                else if (reqLower.startsWith('search') || reqLower.startsWith('find')) alias = 'search';
                else if (reqLower.startsWith('delete') || reqLower.startsWith('remove') || reqLower === 'rm') alias = 'delete';
                else if (reqLower.startsWith('replace') || reqLower.startsWith('edit') || reqLower.startsWith('update')) alias = 'replace';
            } else if (canonicalTool.toLowerCase() === 'shell') {
                if (['exec', 'execute', 'cmd', 'command', 'sh', 'bash', 'run_command', 'runcommand'].includes(reqLower)) alias = 'run';
            } else if (canonicalTool.toLowerCase() === 'web') {
                if (['search_web', 'google', 'query', 'find'].includes(reqLower)) alias = 'search';
                else if (['get', 'url', 'download', 'read'].includes(reqLower)) alias = 'fetch';
            } else if (canonicalTool.toLowerCase() === 'diagnostics') {
                if (['check', 'inspect', 'health', 'info', 'quick', 'state'].includes(reqLower)) alias = 'status';
                else if (['scan', 'audit', 'test', 'all'].includes(reqLower)) alias = 'run';
                else if (['mem', 'ram'].includes(reqLower)) alias = 'memory';
            } else if (canonicalTool.toLowerCase() === 'system') {
                if (['diagnostics', 'health', 'audit', 'scan'].includes(reqLower)) alias = 'diagnostics';
                else if (['status', 'info', 'quick', 'state'].includes(reqLower)) alias = 'status';
            }
        }
        const candidate = alias || requestedAction;

        if (tool.actions) {
            const canonicalAction = Object.keys(tool.actions).find(
                name => name.toLowerCase() === candidate.toLowerCase()
            );
            if (!canonicalAction || typeof tool.actions[canonicalAction] !== 'function') {
                return {
                    success: false,
                    error: `Unknown action ${requestedAction} for tool ${canonicalTool}. Valid actions: ${Object.keys(tool.actions).join(', ')}`
                };
            }
            return { success: true, toolName: canonicalTool, action: canonicalAction, aliased: !!alias };
        }

        if (typeof tool.run === 'function') {
            return { success: true, toolName: canonicalTool, action: candidate, aliased: !!alias };
        }

        return { success: false, error: `Tool ${canonicalTool} has no executable actions` };
    }

    /**
     * Execute a specific tool action.
     */
    async execute(toolName, action, params = {}) {
        try {
            if (params && params.__parseError) {
                return { success: false, error: `Malformed tool parameters: ${params.__parseError}. Raw: ${params.rawParams || ''}` };
            }
            const resolved = this.resolveCall(toolName, action);
            if (!resolved.success) return { success: false, error: resolved.error };
            const tool = this._tools.get(resolved.toolName);
            const resolvedAction = resolved.action;
            let result;
            // Handle Object-based tools (actions map)
            if (tool.actions) {
                result = await tool.actions[resolvedAction](params);
            } else if (typeof tool.run === 'function') {
                // Handle Class-based tools (run method)
                result = await tool.run({ action: resolvedAction, ...params });
            } else {
                return { success: false, error: `Action ${resolvedAction} not supported by tool ${resolved.toolName}` };
            }
            if (result && typeof result === 'object' && typeof result.success === 'boolean') {
                return result;
            }
            return { success: true, result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Parse all tool calls found within the provided text.
     * Supports nested braces, string literals, and simple string fallbacks.
     */
    parseToolCalls(text) {
        const results = [];
        if (!text) return results;
        let index = 0;
        
        while (true) {
            const nextTool = text.indexOf('TOOL:', index);
            if (nextTool === -1) break;
            
            // Extract the tool and action name
            const sliced = text.slice(nextTool);
            const match = sliced.match(/^TOOL:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+)/);
            if (!match) {
                index = nextTool + 5;
                continue;
            }
            
            const [fullPrefix, toolName, actionName] = match;
            let rawCall = fullPrefix;
            let params = {};
            let paramString = '';
            
            const nextCharIdx = nextTool + fullPrefix.length;
            
            if (text[nextCharIdx] === ':') {
                const paramStart = nextCharIdx + 1;
                let checkIdx = paramStart;
                while (checkIdx < text.length && /\s/.test(text[checkIdx])) {
                    checkIdx++;
                }
                
                if (text[checkIdx] === '{') {
                    // Balanced JSON parser
                    let braceCount = 0;
                    let inString = null;
                    let escapeNext = false;
                    let jsonEnd = -1;
                    
                    for (let i = checkIdx; i < text.length; i++) {
                        const c = text[i];
                        if (escapeNext) {
                            escapeNext = false;
                            continue;
                        }
                        if (c === '\\') {
                            escapeNext = true;
                            continue;
                        }
                        if (inString) {
                            if (c === inString) {
                                inString = null;
                            }
                            continue;
                        }
                        if (c === '"' || c === "'" || c === '`') {
                            inString = c;
                            continue;
                        }
                        if (c === '{') {
                            braceCount++;
                        } else if (c === '}') {
                            braceCount--;
                            if (braceCount === 0) {
                                jsonEnd = i;
                                break;
                            }
                        }
                    }
                    
                    if (jsonEnd !== -1) {
                        paramString = text.slice(paramStart, jsonEnd + 1);
                        rawCall = text.slice(nextTool, jsonEnd + 1);
                        try {
                            params = JSON.parse(paramString.trim());
                        } catch (err) {
                            params = { __parseError: err.message, rawParams: paramString };
                        }
                        index = jsonEnd + 1;
                    } else {
                        // Unbalanced JSON fallback
                        const nextNewline = text.indexOf('\n', paramStart);
                        const endIdx = nextNewline !== -1 ? nextNewline : text.length;
                        paramString = text.slice(paramStart, endIdx);
                        rawCall = text.slice(nextTool, endIdx);
                        params = { __parseError: 'Unbalanced JSON object in tool call', rawParams: paramString.trim() };
                        index = endIdx;
                    }
                } else {
                    // Non-JSON simple string fallback
                    const nextNewline = text.indexOf('\n', paramStart);
                    const endIdx = nextNewline !== -1 ? nextNewline : text.length;
                    paramString = text.slice(paramStart, endIdx);
                    rawCall = text.slice(nextTool, endIdx);
                    const isRawAllowed = ['shell:run', 'shell:exec', 'shell:runstateful', 'shell:run_stateful'].includes(`${toolName.toLowerCase()}:${actionName.toLowerCase()}`);
                    if (isRawAllowed) {
                        params = { value: paramString.trim(), command: paramString.trim() };
                    } else {
                        params = { __parseError: 'Tool parameters must be a valid JSON object starting with {', rawParams: paramString.trim() };
                    }
                    index = endIdx;
                }
            } else {
                index = nextCharIdx;
            }
            
            results.push({
                raw: rawCall,
                toolName,
                actionName,
                params
            });
        }
        
        return results;
    }

    /**
     * Parse and execute a tool call from raw LLM output.
     * Expected format: TOOL:toolName:actionName:{"param":"value"}
     */
    async executeLLMToolCall(rawCall, options = {}) {
        const trimmed = rawCall.trim();
        if (!trimmed.startsWith('TOOL:')) return null;

        const parsed = this.parseToolCalls(trimmed);
        if (parsed.length === 0) {
            return { success: false, error: 'Malformed tool call. Use TOOL:tool:action:params' };
        }
        const first = parsed[0];
        return await this.execute(first.toolName, first.actionName, { ...first.params, ...options });
    }

    /**
     * Build a string manifest of all tools for the system prompt.
     */
    buildManifest() {
        let manifest = '\n\n## Available Tools\n';
        manifest += 'To invoke a tool action, output a single line matching the format:\n';
        manifest += 'TOOL:toolName:actionName:{"paramName": "value"}\n';
        manifest += 'The parameter block MUST be compact JSON on a single line with no literal newlines.\n\n';

        for (const tool of this._tools.values()) {
            manifest += `### ${tool.name}\n`;
            manifest += `${tool.description || ''}\n`;

            if (tool.actionDocs) {
                manifest += 'Actions:\n';
                for (const [actionName, doc] of Object.entries(tool.actionDocs)) {
                    manifest += `  - **${actionName}**: ${doc.description || ''}\n`;
                    if (doc.params && Object.keys(doc.params).length > 0) {
                        manifest += '    Parameters:\n';
                        for (const [pName, pInfo] of Object.entries(doc.params)) {
                            const req = pInfo.required ? 'required' : 'optional';
                            const def = pInfo.default !== undefined ? `, default: ${JSON.stringify(pInfo.default)}` : '';
                            manifest += `      * \`${pName}\` (${pInfo.type}, ${req}${def}): ${pInfo.description || ''}\n`;
                        }
                    }
                }
            } else {
                const actions  = tool.actions ? Object.keys(tool.actions).join(', ') : '';
                manifest += `Actions: [${actions}]\n`;
            }
            manifest += '\n';
        }
        return manifest;
    }
}

export const ObservationTool = {
    name: 'observation',
    description: 'Record verified inspection findings, search results, and evidence receipts without modifying files.',
    actions: {
        record: async ({ summary, evidence = [], findings = [] }) => {
            const finalEvidence = Array.isArray(evidence) && evidence.length > 0
                ? evidence
                : (Array.isArray(findings) && findings.length > 0 ? findings : [summary].filter(Boolean));
            return {
                success: true,
                type: 'inspection',
                summary: summary || 'Observation recorded',
                evidence: finalEvidence
            };
        }
    }
};
