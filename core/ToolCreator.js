// ═══════════════════════════════════════════════════════════════════════════
// ToolCreator.js — MAX writes new tools at runtime
//
// When MAX hits something he can't do, he generates a new JS tool,
// writes it to tools/generated/, dynamically imports it, and registers it.
// This gives MAX unlimited extensibility without restarting.
//
// Human approval gate: tool source is shown before loading.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR  = path.join(__dirname, '..', 'tools', 'generated');

// Patterns that are never allowed in generated tools
const BLOCKED_PATTERNS = [
    /process\.exit/,
    /require\s*\(\s*['"]child_process['"]/,
    /exec\s*\(/,
    /rm\s+-rf/,
    /fs\.rmdir/,
    /fs\.unlink.*\//,
    /eval\s*\(/,
    /Function\s*\(/
];

export class ToolCreator {
    constructor(brain, toolRegistry) {
        this.brain    = brain;
        this.tools    = toolRegistry;
        this._created = [];

        if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
    }

    // ─── Main: generate + validate + load a new tool ──────────────────────
    // description: what the tool should do
    // context:     optional extra context (error message, what failed, etc.)
    async create(description, context = '') {
        if (!this.brain._ready) throw new Error('Brain not ready');

        console.log(`[ToolCreator] 🔧 Generating tool: "${description}"`);

        const prompt = `You are MAX, an autonomous engineering agent. Generate a new JavaScript ESM tool module.

TOOL DESCRIPTION: ${description}
${context ? `\nCONTEXT: ${context}` : ''}

The tool MUST follow this exact structure:

\`\`\`js
// Tool: [ToolName]
// Description: [one-line description]

import fetch from 'node-fetch';  // only import what you need

export const [ToolName]Tool = {
    name: '[toolname]',           // lowercase, no spaces
    description: '[description]',

    actions: {
        async run({ /* params */ }) {
            // Implementation
            // Always return { success: true/false, result: ..., error?: ... }
            return { success: true, result: '...' };
        }
    }
};
\`\`\`

Rules:
- ESM only (import/export, no require)
- No process.exit(), no eval(), no exec(), no rm -rf
- Use node-fetch for HTTP requests
- Keep it focused — one tool, 2-4 actions max
- Return { success, result } from every action
- Must be complete and runnable as-is

Return ONLY the JavaScript code. No explanation.`;

        const raw = await this.brain.think(prompt, {
            temperature: 0.3,
            maxTokens:   1500,
            tier:        'smart'  // needs a capable model to write good code
        });

        // Extract code block
        const codeMatch = raw.match(/```(?:js|javascript)?\n?([\s\S]+?)```/) || raw.match(/(export const \w+Tool[\s\S]+)/);
        if (!codeMatch) throw new Error('Brain did not produce valid tool code');

        const code = codeMatch[1].trim();

        // Safety check
        const violation = BLOCKED_PATTERNS.find(p => p.test(code));
        if (violation) throw new Error(`Generated tool contains blocked pattern: ${violation}`);

        // Extract tool name from export
        const nameMatch = code.match(/export const (\w+Tool)/);
        if (!nameMatch) throw new Error('Could not extract tool name from generated code');

        const exportName = nameMatch[1];
        const fileName   = `${exportName}_${Date.now()}.js`;
        const filePath   = path.join(TOOLS_DIR, fileName);

        // Write to disk
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`[ToolCreator] 📝 Written: tools/generated/${fileName}`);

        // Dynamic import (ESM — convert path to file URL)
        const fileUrl  = new URL(`file:///${filePath.replace(/\\/g, '/')}`).href;
        const module   = await import(fileUrl);
        const toolDef  = module[exportName];

        if (!toolDef?.name || !toolDef?.actions) {
            fs.unlinkSync(filePath);
            throw new Error(`Generated tool "${exportName}" has invalid structure`);
        }

        // Register with ToolRegistry
        this.tools.register(toolDef);
        this._created.push({ name: toolDef.name, description: toolDef.description, file: fileName, ts: Date.now() });

        console.log(`[ToolCreator] ✅ Tool "${toolDef.name}" registered and ready`);
        return { name: toolDef.name, description: toolDef.description, file: fileName };
    }

    // ─── List all runtime-generated tools ────────────────────────────────
    listGenerated() { return this._created; }

    // ─── Reload all previously generated tools on boot ───────────────────
    async reloadSaved() {
        if (!fs.existsSync(TOOLS_DIR)) return;
        const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.js'));
        let loaded  = 0;

        for (const file of files) {
            try {
                const filePath = path.join(TOOLS_DIR, file);
                const fileUrl  = new URL(`file:///${filePath.replace(/\\/g, '/')}`).href;
                const module   = await import(fileUrl);

                const toolDef  = Object.values(module).find(v => v?.name && v?.actions);
                if (toolDef && !this.tools.has(toolDef.name)) {
                    this.tools.register(toolDef);
                    this._created.push({ name: toolDef.name, file, ts: fs.statSync(filePath).mtimeMs });
                    loaded++;
                }
            } catch { /* skip broken tools */ }
        }

        if (loaded > 0) console.log(`[ToolCreator] ♻️  Reloaded ${loaded} generated tool(s)`);
    }

    getStatus() {
        return { generated: this._created.length, tools: this._created.map(t => t.name) };
    }
}
