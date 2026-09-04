// ═══════════════════════════════════════════════════════════════════════════
// DiscordCodeEvaluator.js — Sandboxed In-Memory Code Runner for Discord
// Safely runs JavaScript code blocks with execution timers and captured stdout.
// ═══════════════════════════════════════════════════════════════════════════

import vm from 'node:vm';

export class DiscordCodeEvaluator {
    /**
     * Extracts executable code snippet from Discord message text.
     */
    static extractCode(text) {
        const raw = String(text || '').trim();
        // Match ```javascript ... ``` or ```js ... ``` or ``` ... ```
        const blockMatch = raw.match(/```(?:js|javascript|node)?\n?([\s\S]*?)```/i);
        if (blockMatch) return blockMatch[1].trim();

        // Match @Max (run|eval|execute) <code>
        const cmdMatch = raw.match(/(?:eval|run|execute)\s+([\s\S]+)/i);
        if (cmdMatch) return cmdMatch[1].trim();

        return null;
    }

    /**
     * Executes code inside an isolated VM sandbox with timeout and stdout interception.
     */
    static async evaluate(codeString, timeoutMs = 5000) {
        const code = String(codeString || '').trim();
        if (!code) return { success: false, error: 'No code provided to evaluate.' };

        const logs = [];
        const sandbox = {
            console: {
                log:   (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                error: (...args) => logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                warn:  (...args) => logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                info:  (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
            },
            Math,
            Date,
            JSON,
            Buffer,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            Promise
        };

        const context = vm.createContext(sandbox);
        const start = performance.now();
        const memBefore = process.memoryUsage().heapUsed;

        try {
            const script = new vm.Script(code);
            const rawResult = await script.runInContext(context, { timeout: timeoutMs });
            const executionTimeMs = (performance.now() - start).toFixed(2);
            const memAfter = process.memoryUsage().heapUsed;

            return {
                success: true,
                result: rawResult !== undefined ? (typeof rawResult === 'object' ? JSON.stringify(rawResult, null, 2) : String(rawResult)) : 'undefined',
                stdout: logs.join('\n').slice(0, 1500),
                executionTimeMs: Number(executionTimeMs),
                memoryDeltaBytes: Math.max(0, memAfter - memBefore)
            };
        } catch (err) {
            const executionTimeMs = (performance.now() - start).toFixed(2);
            return {
                success: false,
                error: err.message,
                stdout: logs.join('\n').slice(0, 1500),
                executionTimeMs: Number(executionTimeMs)
            };
        }
    }
}
