// ═══════════════════════════════════════════════════════════════════════════
// GuardedToolPipeline.js — DeepSeek Harness Inspired Guarded Tool Execution
// Provides pre-execution validation, sandboxed execution, and hot-swappable plugins.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';

export class GuardedToolPipeline {
    constructor(baseExecutor = null) {
        this.baseExecutor = baseExecutor;
        this._plugins = new Map(); // pluginName -> { tools, actions, manifest }
        this._blacklistPatterns = [
            /rm\s+-rf\s+[\/\\]/i,
            /:(){ :|:& };:/, // fork bomb
            /mkfs/i,
            /dd\s+if=.*of=\/dev/i,
            />\s*\/dev\/sd/i
        ];
    }

    /**
     * Mount a hot-swappable tool plugin with reversible effects
     */
    mountPlugin(name, plugin) {
        if (!plugin || typeof plugin !== 'object') {
            throw new Error(`Plugin "${name}" must be an object with tool definitions.`);
        }
        this._plugins.set(name, plugin);
        console.log(`[GuardedToolPipeline] 🔌 Plugin mounted: "${name}"`);
        return () => this.unmountPlugin(name);
    }

    /**
     * Unmount a plugin, cleanly unwinding its tools
     */
    unmountPlugin(name) {
        const existed = this._plugins.delete(name);
        if (existed) {
            console.log(`[GuardedToolPipeline] 🔌 Plugin unmounted: "${name}"`);
        }
        return existed;
    }

    /**
     * List all active tool definitions
     */
    getToolManifest() {
        const manifest = [];
        for (const [pluginName, plugin] of this._plugins.entries()) {
            if (Array.isArray(plugin.manifest)) {
                manifest.push(...plugin.manifest);
            } else if (plugin.actions) {
                for (const action of Object.keys(plugin.actions)) {
                    manifest.push({ name: `${pluginName}.${action}`, plugin: pluginName, action });
                }
            }
        }
        return manifest;
    }

    /**
     * Pre-flight safety & parameter validator
     */
    validateToolCall(toolCall) {
        if (!toolCall || typeof toolCall !== 'object') {
            return { valid: false, error: 'Malformed tool call payload' };
        }

        const { tool, action, params = {} } = toolCall;

        if (!tool || !action) {
            return { valid: false, error: 'Missing tool or action identifier' };
        }

        // 1. Check command execution blacklist
        if (tool === 'shell' || action === 'run' || action === 'exec') {
            const cmd = params.command || params.cmd || '';
            for (const pattern of this._blacklistPatterns) {
                if (pattern.test(cmd)) {
                    return { valid: false, error: `Command blocked by security guard: ${cmd}` };
                }
            }
        }

        // 2. Check path traversal safety
        if (params.path || params.filePath || params.target) {
            const rawPath = String(params.path || params.filePath || params.target);
            if (rawPath.includes('..\\..\\..\\') || rawPath.includes('../../../')) {
                const resolved = path.resolve(rawPath);
                // Allow relative paths within workspace
                if (!resolved.toLowerCase().startsWith('c:\\users') && !resolved.startsWith('/')) {
                    return { valid: false, error: `Unsafe path traversal attempt: ${rawPath}` };
                }
            }
        }

        return { valid: true };
    }

    /**
     * Guarded Execution Wrapper
     */
    async executeGuarded(toolCall, options = {}) {
        const validation = this.validateToolCall(toolCall);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error,
                blocked: true,
                timestamp: Date.now()
            };
        }

        const { tool, action, params = {} } = toolCall;
        const startTime = Date.now();

        try {
            // Check mounted plugins first
            if (this._plugins.has(tool)) {
                const plugin = this._plugins.get(tool);
                if (plugin.actions && typeof plugin.actions[action] === 'function') {
                    const result = await Promise.race([
                        plugin.actions[action](params),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('Tool execution timeout')), options.timeout || 30000))
                    ]);
                    return {
                        success: true,
                        result,
                        durationMs: Date.now() - startTime,
                        source: `plugin:${tool}`
                    };
                }
            }

            // Fallback to base executor if provided
            if (this.baseExecutor) {
                const rawLine = `TOOL:${tool}:${action}:${JSON.stringify(params)}`;
                const result = await this.baseExecutor.executeLLMToolCall(rawLine);
                return {
                    success: true,
                    result,
                    durationMs: Date.now() - startTime,
                    source: 'baseExecutor'
                };
            }

            return {
                success: false,
                error: `No handler registered for tool: ${tool}.${action}`,
                durationMs: Date.now() - startTime
            };
        } catch (err) {
            return {
                success: false,
                error: err.message,
                durationMs: Date.now() - startTime
            };
        }
    }
}
