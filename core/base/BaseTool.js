// ═══════════════════════════════════════════════════════════════════════════
// BaseTool.js — Modern tool inheritance system
// All MAX tools should extend this class for consistent architecture.
// ═══════════════════════════════════════════════════════════════════════════

export class BaseTool {
    /**
     * Tool name (must match TOOL: prefix in calls)
     * @type {string}
     */
    static name = 'base';
    
    /**
     * Human-readable description for the tool manifest
     * @type {string}
     */
    static description = 'Base tool class';
    
    /**
     * Actions registry - map of action names to async functions
     * @type {Object<string, Function>}
     */
    static actions = {};
    
    /**
     * Tool instance (for stateful tools)
     * @type {BaseTool|null}
     */
    static instance = null;
    
    /**
     * Initialize tool instance if needed
     * @returns {BaseTool}
     */
    static getInstance() {
        if (!this.instance) {
            this.instance = new this();
        }
        return this.instance;
    }
    
    /**
     * Get tool manifest for registration
     * @returns {Object}
     */
    static getManifest() {
        return {
            name: this.name,
            description: this.description,
            actions: this.actions
        };
    }
    
    /**
     * Execute an action with parameters
     * @param {string} action - Action name
     * @param {Object} params - Action parameters
     * @returns {Promise<Object>}
     */
    static async execute(action, params) {
        if (!this.actions[action]) {
            throw new Error(`Action ${action} not found in tool ${this.name}`);
        }
        
        try {
            // For static methods, call directly
            if (typeof this.actions[action] === 'function') {
                return await this.actions[action](params);
            }
            
            // For instance methods, use singleton
            const instance = this.getInstance();
            const method = instance[action];
            if (typeof method === 'function') {
                return await method.call(instance, params);
            }
            
            throw new Error(`Action ${action} is not callable`);
        } catch (error) {
            return {
                success: false,
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            };
        }
    }
    
    /**
     * Validate parameters before execution
     * @param {Object} params
     * @returns {Array<string>} Array of validation errors
     */
    static validateParams(params) {
        return []; // Override in subclasses
    }
    
    /**
     * Log tool usage for analytics
     * @param {string} action
     * @param {Object} params
     * @param {Object} result
     */
    static logUsage(action, params, result) {
        // Override for custom logging
        if (global.MAX?.heartbeat?.logToolUsage) {
            global.MAX.heartbeat.logToolUsage({
                tool: this.name,
                action,
                params: JSON.stringify(params),
                success: result.success,
                timestamp: Date.now()
            });
        }
    }
}
