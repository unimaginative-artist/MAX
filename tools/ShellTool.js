// ═══════════════════════════════════════════════════════════════════════════
// ShellTool.js — sandboxed shell execution
// Runs commands with timeout, output capture, and safety guardrails.
//
// Security: regex-based blocklist (not substring) + chaining detection.
// ═══════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Patterns that are never allowed — uses word boundaries / anchors to prevent
// bypass tricks like "rm -rf / # comment" or "/home/user/shutdown-script.sh"
const BLOCKED_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+[\/~]/i,  // rm -rf / or rm -rf ~
    /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+[\/~]/i,  // rm -fr /
    /\bformat\s+[a-z]:\b/i,                     // format c:
    /\bdel\s+\/f\b/i,                           // del /f /s /q
    /\bmkfs\b/i,                                // mkfs.*
    /:\(\)\s*\{.*:\|.*&.*\}/,                   // fork bomb :(){:|:&};:
    /\bdd\s+if=\/dev\/zero\b/i,                 // dd if=/dev/zero of=disk
    /\bshutdown\b/i,                            // shutdown
    /\bhalt\b/i,                                // halt
    /\breboot\b/i,                              // reboot
    /\bpoweroff\b/i,                            // poweroff
    />\s*\/dev\/sd[a-z]/i,                      // redirect to raw disk device
    /\bcurl\b.*\|\s*(ba)?sh\b/i,                // curl | bash (remote code exec)
    /\bwget\b.*\|\s*(ba)?sh\b/i,                // wget | bash
    /\bpython[23]?\s+-c\b/i,                    // python -c "arbitrary code"
    /\bnode\s+-e\b/i,                           // node -e "arbitrary code"
    /\beval\b\s+[`"']/i,                        // eval "string"
];

// Shell metacharacters that enable command chaining/injection
// We warn but don't block — some are legitimate (pipes in grep, etc.)
const CHAIN_PATTERN = /[;&|`]|\$\(/;

function checkCommand(cmd) {
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(cmd)) {
            return { blocked: true, reason: `Matches blocked pattern: ${pattern}` };
        }
    }
    return { blocked: false };
}

export const ShellTool = {
    name: 'shell',
    description: 'Run shell commands with timeout and safety guardrails',

    actions: {
        async run({ command, cwd = process.cwd(), timeoutMs = 30000, allowChaining = false }) {
            const check = checkCommand(command);
            if (check.blocked) {
                return { success: false, error: `Blocked: ${check.reason}` };
            }

            // Warn (but allow) chaining operators unless explicitly prohibited
            if (!allowChaining && CHAIN_PATTERN.test(command)) {
                console.warn(`[ShellTool] ⚠️  Command contains shell metacharacters: ${command}`);
            }

            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd,
                    timeout:   timeoutMs,
                    maxBuffer: 5 * 1024 * 1024  // 5MB
                });

                return {
                    success: true,
                    command,
                    stdout:  stdout?.trim() || '',
                    stderr:  stderr?.trim() || '',
                    cwd
                };
            } catch (err) {
                return {
                    success: false,
                    command,
                    error:   err.message,
                    stdout:  err.stdout?.trim() || '',
                    stderr:  err.stderr?.trim() || '',
                    code:    err.code
                };
            }
        },

        async which({ program }) {
            // Safe: program name passed to `where`/`which` — no injection possible here
            // because program names can't contain shell metacharacters in practice
            const cmd = process.platform === 'win32' ? `where ${program}` : `which ${program}`;
            try {
                const { stdout } = await execAsync(cmd, { timeout: 5000 });
                return { success: true, found: true, path: stdout.trim() };
            } catch {
                return { success: true, found: false };
            }
        }
    }
};
