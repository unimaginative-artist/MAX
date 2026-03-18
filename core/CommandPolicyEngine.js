// ═══════════════════════════════════════════════════════════════════════════
// CommandPolicyEngine.js — MAX's shell command security layer
//
// Prevents execution of dangerous, destructive, or hallucinated commands.
// All shell steps in AgentLoop and SwarmCoordinator run through this before
// the tool executes. If validate() throws, the step is skipped with a clear
// reason rather than failing silently or blowing up.
//
// Design mirrors SOMA's CommandPolicyEngine but adapted for MAX's environment:
//   - Windows-first (dir, findstr, powershell) while also supporting Unix paths
//   - Git allowed (MAX is a coding agent)
//   - Script existence check built in (not bolted on as a bandaid elsewhere)
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

// Commands MAX is allowed to run
const ALLOWLIST = new Set([
    // Node / JS toolchain
    'node', 'npm', 'npx',
    // Git
    'git',
    // Read-only file/directory inspection
    'dir', 'ls', 'type', 'cat',
    // Text search
    'findstr', 'grep',
    // Code quality
    'eslint', 'tsc', 'jest', 'vitest',
    // Python (data scripts, but script must exist — see _checkScriptExists)
    'python', 'python3',
    // PowerShell read-only invocations (blocked for dangerous patterns below)
    'powershell', 'pwsh',
]);

// Patterns that are always blocked, even in allowlisted commands
// Covers redirect/overwrite, dangerous deletions, chained commands, net changes
const BLOCKED_PATTERNS = [
    { re: /(?:^|[^>])>>?(?:[^>]|$)/,  reason: 'output redirection (>>/>)' },
    { re: /\|/,                         reason: 'pipe (|) — use brain step to process output instead' },
    { re: /(?<![&])&(?!&)/,             reason: 'background execution (&)' },
    { re: /;/,                          reason: 'command chaining (;)' },
    { re: /\brm\s+-rf?\b/i,            reason: 'recursive delete (rm -rf)' },
    { re: /\bdel\s+\/[sqf]/i,          reason: 'forced delete (del /s /q /f)' },
    { re: /\brmdir\b/i,                reason: 'directory removal (rmdir)' },
    { re: /\brd\s+\/s/i,               reason: 'recursive directory delete (rd /s)' },
    { re: /\bformat\b/i,               reason: 'disk format' },
    { re: /\breg\s+(add|delete|import)/i, reason: 'registry modification' },
    { re: /\bnetsh\b/i,                reason: 'network configuration (netsh)' },
    { re: /\bschtasks\b/i,             reason: 'scheduled task creation' },
    { re: /\bsc\s+(create|start|stop|delete)/i, reason: 'service control' },
    { re: /\bcurl\b.*-[oO]/i,          reason: 'curl file download (-o/-O)' },
    { re: /\bwget\b/i,                 reason: 'wget download' },
    { re: /\binvoke-expression\b/i,    reason: 'Invoke-Expression (PowerShell exec)' },
    { re: /\biex\b/i,                  reason: 'iex alias (PowerShell exec)' },
];

// Script extensions that must exist on disk before we allow execution
const SCRIPT_EXTENSIONS = /\.(py|js|mjs|cjs|ts|ps1|sh|bat|cmd)$/i;

export class CommandPolicyEngine {
    /**
     * Validate a shell command against MAX's security policy.
     *
     * Returns { allowed: true } if the command passes.
     * Returns { allowed: false, reason: string } if blocked.
     * Never throws — callers decide what to do with a blocked command.
     *
     * @param {string} command  Full command string (e.g. "node scripts/build.js")
     * @param {string} [cwd]    Working directory for resolving relative script paths
     */
    validate(command, cwd = process.cwd()) {
        if (!command || typeof command !== 'string') {
            return { allowed: false, reason: 'Empty or non-string command' };
        }

        const cmd = command.trim();

        // ── 1. Extract base command ──────────────────────────────────────
        // Strip leading path separators so .\node_modules\.bin\eslint → eslint
        const rawBase  = cmd.split(/\s+/)[0];
        const normBase = rawBase
            .split(/[/\\]/).pop()           // last path segment
            .replace(/\.(exe|cmd|bat)$/i, '') // drop Windows extensions
            .toLowerCase();

        if (!ALLOWLIST.has(normBase)) {
            return { allowed: false, reason: `Command not in allowlist: "${normBase}"` };
        }

        // ── 2. Dangerous pattern scan ────────────────────────────────────
        for (const { re, reason } of BLOCKED_PATTERNS) {
            if (re.test(cmd)) {
                return { allowed: false, reason: `Blocked pattern — ${reason}` };
            }
        }

        // ── 3. Script existence check ────────────────────────────────────
        // If the command is "node foo.js" / "python bar.py" / etc., the script
        // must actually exist. This is what was previously a bandaid in AgentLoop.
        const scriptArg = this._extractScriptArg(cmd);
        if (scriptArg) {
            const resolved = path.isAbsolute(scriptArg)
                ? scriptArg
                : path.join(cwd, scriptArg);

            if (!fs.existsSync(resolved)) {
                return {
                    allowed: false,
                    reason:  `Script does not exist: ${scriptArg} (resolved: ${resolved})`
                };
            }
        }

        return { allowed: true };
    }

    // ── Extract the first script-file argument from a command ────────────────
    // "node scripts/build.js --flag" → "scripts/build.js"
    // "python3 src/train.py"         → "src/train.py"
    // "npm test"                      → null (no file arg needed)
    _extractScriptArg(cmd) {
        const parts = cmd.split(/\s+/);
        const base  = parts[0].split(/[/\\]/).pop().replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();

        // Only check file existence for interpreters, not for npm/git/etc.
        const interpreters = new Set(['node', 'python', 'python3', 'npx', 'tsc']);
        if (!interpreters.has(base)) return null;

        // Find the first argument that looks like a file path (has a script extension)
        for (let i = 1; i < parts.length; i++) {
            const arg = parts[i].replace(/^['"]|['"]$/g, ''); // strip quotes
            if (arg.startsWith('-')) continue;                 // skip flags
            if (SCRIPT_EXTENSIONS.test(arg)) return arg;
            // No extension but not a flag — might be a plain script name; skip (let it run)
            break;
        }
        return null;
    }
}

// Singleton — import this one instance everywhere
export const commandPolicy = new CommandPolicyEngine();
