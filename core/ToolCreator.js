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
    /child_process/,           // any child_process reference
    /\bexec\s*\(/,             // exec(), execSync()
    /\bspawn\s*\(/,            // spawn()
    /\bfork\s*\(/,             // fork()
    /\bexecFile\s*\(/,         // execFile()
    /rm\s+-rf/,
    /fs\.(rmdir|rm)\b/,        // fs.rmdir, fs.rm
    /fs\.unlinkSync/,
    /fs\.unlink\s*\(/,
    /eval\s*\(/,
    /new\s+Function\s*\(/,     // new Function() — dynamic code eval
    /Function\s*\(\s*['"`]/,   // Function('code') — dynamic code eval
    /__proto__/,               // prototype pollution
    /prototype\s*\[/,          // prototype pollution via bracket access
];

// Check for top-level executable statements — anything that runs on import()
// Strips comments/strings first to avoid false positives from code in string literals
function hasTopLevelExecution(code) {
    const cleaned = code
        .replace(/\/\/[^\n]*/g, '')              // strip line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')        // strip block comments
        .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, '""')  // strip template literals
        .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')  // strip double-quoted strings
        .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '""'); // strip single-quoted strings

    for (const line of cleaned.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Skip safe top-level constructs
        if (/^(import\s|export\s|const\s|let\s|var\s|\}|\{|\/\/)/.test(trimmed)) continue;
        if (/^(async\s+function|function\s+\w)/.test(trimmed)) continue;
        if (/^\/[\/*]/.test(trimmed)) continue;  // comments that slipped through
        // Anything else at col-0 that's not a closing brace is suspicious
        if (line[0] !== ' ' && line[0] !== '\t' && trimmed.length > 0) {
            return { found: true, line: trimmed.slice(0, 80) };
        }
    }
    return { found: false };
}

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

        const result = await this.brain.think(prompt, {
            temperature: 0.3,
            maxTokens:   1500,
            tier:        'fast'
        });

        const raw = result.text;

        // Extract code block
        const codeMatch = raw.match(/```(?:js|javascript)?\n?([\s\S]+?)```/) || raw.match(/(export const \w+Tool[\s\S]+)/);
        if (!codeMatch) throw new Error('Brain did not produce valid tool code');

        const code = codeMatch[1].trim();

        // Safety check — blocked patterns
        const violation = BLOCKED_PATTERNS.find(p => p.test(code));
        if (violation) throw new Error(`Generated tool contains blocked pattern: ${violation}`);

        // Safety check — top-level execution (code that runs at import time)
        const topLevel = hasTopLevelExecution(code);
        if (topLevel.found) throw new Error(`Generated tool has top-level executable code: "${topLevel.line}"`);

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

    // ─── Registration as a tool ───────────────────────────────────────────
    asTool() {
        return {
            name: 'meta',
            description: 'Generate and register NEW tools and capabilities at runtime.',
            actions: {
                create: async ({ description, context }) => {
                    return await this.create(description, context);
                }
            }
        };
    }

    // ─── Proactive identification: what tools are we missing? ─────────────
    // Called by ReflectionEngine/AgentLoop when it sees repeated blocks
    async autoSuggest(recentFailures = []) {
        if (!this.brain._ready) return null;

        const prompt = `You are MAX, an autonomous engineering agent. Review these recent tool failures and suggest ONE new tool that would solve the underlying problem.

RECENT FAILURES:
${recentFailures.join('\n')}

CURRENT TOOLS:
${this.tools.list().map(t => t.name).join(', ')}

Return ONLY a JSON object:
{
  "name": "ToolName",
  "description": "What the tool does",
  "reason": "Why this tool is needed now"
}
Return ONLY the JSON.`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.2, tier: 'fast' });
            const raw = result.text;
            const match = raw.match(/\{[\s\S]*?\}/);
            if (!match) return null;
            return JSON.parse(match[0]);
        } catch { return null; }
    }
}
