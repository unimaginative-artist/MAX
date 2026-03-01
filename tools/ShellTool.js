// ═══════════════════════════════════════════════════════════════════════════
// ShellTool.js — sandboxed shell execution
// Runs commands with timeout, output capture, and a blocklist for safety
// ═══════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Commands MAX refuses to run regardless of what it's told
const BLOCKED_COMMANDS = [
    'rm -rf /',
    'format c:',
    'del /f /s /q c:',
    'mkfs',
    ':(){:|:&};:',  // fork bomb
    'dd if=/dev/zero',
    'shutdown',
    'halt',
    'reboot'
];

function isBlocked(cmd) {
    const lower = cmd.toLowerCase().trim();
    return BLOCKED_COMMANDS.some(b => lower.includes(b.toLowerCase()));
}

export const ShellTool = {
    name: 'shell',
    description: 'Run shell commands with timeout and safety guardrails',

    actions: {
        async run({ command, cwd = process.cwd(), timeoutMs = 30000 }) {
            if (isBlocked(command)) {
                return { success: false, error: 'Blocked: that command is on the safety blocklist' };
            }

            try {
                const { stdout, stderr } = await execAsync(command, {
                    cwd,
                    timeout: timeoutMs,
                    maxBuffer: 5 * 1024 * 1024  // 5MB
                });

                return {
                    success:   true,
                    command,
                    stdout:    stdout?.trim() || '',
                    stderr:    stderr?.trim() || '',
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
            const cmd = process.platform === 'win32' ? `where ${program}` : `which ${program}`;
            try {
                const { stdout } = await execAsync(cmd);
                return { success: true, found: true, path: stdout.trim() };
            } catch {
                return { success: true, found: false };
            }
        }
    }
};
