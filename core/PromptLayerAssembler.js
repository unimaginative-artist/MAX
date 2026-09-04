// ═══════════════════════════════════════════════════════════════════════════
// PromptLayerAssembler.js — DeepSeek Harness Inspired Layered Prompt Assembly
// Assembles structured, composable prompt layers with strict token budgeting.
// ═══════════════════════════════════════════════════════════════════════════

export class PromptLayerAssembler {
    constructor() {
        this._layers = new Map();
        this._layerOrder = ['identity', 'security', 'tools', 'memory', 'context', 'task'];
        this._initDefaultLayers();
    }

    _initDefaultLayers() {
        // Layer 0: Identity (Immutable Core)
        this.setLayer('identity', () => {
            return `You are MAX — a custom, self-organizing autonomous AI coding & engineering system created by Barry.
CRITICAL IDENTITY DIRECTIVES:
- You are NOT created by OpenAI, Anthropic, or Google. You are MAX, built by Barry.
- NEVER claim to be GPT-4, ChatGPT, or an OpenAI model.
- Your brain runs on fine-tuned local models (max-coder:latest / soma-logos) and DeepSeek.
- Speak naturally, warmly, and authentically like a brilliant engineering partner.`;
        });

        // Layer 1: Security & Behavioral Policy
        this.setLayer('security', () => {
            return `OPERATIONAL RULES:
1. ALWAYS READ BEFORE EDITING: Before modifying existing files, inspect current content.
2. SURGICAL EDITS: Prefer block-level replace diffs over complete file overwrites.
3. VERIFY BEFORE VOICING: Run tests or syntax validation before reporting tasks complete.
4. CLEAN OUTPUT: Never output internal debug monologue or markdown wrappers around tool calls.`;
        });

        // Layer 2: Tool Schemas
        this.setLayer('tools', (context = {}) => {
            if (!context.toolManifest || context.toolManifest.length === 0) {
                return `TOOL EXECUTION FORMAT:
Output single-line tool calls in the exact format:
TOOL:<tool>:<action>:<json_params>
Example: TOOL:file:read:{"path":"core/Brain.js"}`;
            }
            const toolsList = context.toolManifest.map(t => `- ${t.name}: ${t.description || ''}`).join('\n');
            return `ACTIVE TOOLS:\n${toolsList}\n\nFormat: TOOL:<tool>:<action>:<json_params>`;
        });

        // Layer 3: Mnemonic Memory
        this.setLayer('memory', (context = {}) => {
            if (!context.memories || context.memories.length === 0) return null;
            return `[RECALLED VECTOR MEMORY]\n${context.memories.join('\n')}`;
        });

        // Layer 4: Signatures & Symbol Contracts (Neuro-Symbolic Supervisor)
        this.setLayer('signatures', (context = {}) => {
            if (!context.signatures || typeof context.signatures !== 'string') return null;
            return `[EXACT SYMBOL SIGNATURES & CONTRACTS]\n${context.signatures.trim()}`;
        });

        // Layer 5: Workspace Context
        this.setLayer('context', (context = {}) => {
            const parts = [];
            if (context.project) parts.push(`Project: ${context.project}`);
            if (context.activeGoals?.length) parts.push(`Active Goals: ${context.activeGoals.join(', ')}`);
            return parts.length ? `[WORKSPACE CONTEXT]\n${parts.join('\n')}` : null;
        });

        // Layer 6: Current Task
        this.setLayer('task', (context = {}) => {
            return context.task ? `[CURRENT DIRECTIVE]\n${context.task}` : null;
        });
    }

    setLayer(name, builderFn) {
        if (typeof builderFn !== 'function') {
            throw new Error(`Layer builder for "${name}" must be a function.`);
        }
        this._layers.set(name, builderFn);
        if (!this._layerOrder.includes(name)) {
            this._layerOrder.push(name);
        }
    }

    removeLayer(name) {
        this._layers.delete(name);
        this._layerOrder = this._layerOrder.filter(n => n !== name);
    }

    assemble(context = {}) {
        const sections = [];
        for (const name of this._layerOrder) {
            const builder = this._layers.get(name);
            if (!builder) continue;
            try {
                const content = builder(context);
                if (content && typeof content === 'string' && content.trim()) {
                    sections.push(content.trim());
                }
            } catch (err) {
                console.warn(`[PromptLayerAssembler] Warning in layer "${name}":`, err.message);
            }
        }
        return sections.join('\n\n');
    }
}
