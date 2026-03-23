// ═══════════════════════════════════════════════════════════════════════════
// ShellTool.js — MAX's full shell access
//
// Designed like Claude Code: commands print live to the terminal so you see
// exactly what's happening. Supports long-running processes, background
// daemons, and persistent working directory across calls.
//
// Actions:
//   run    — run a command, stream output live, wait for exit
//   start  — spawn a background process (server, watcher, etc.)
//   stop   — kill a named background process
//   ps     — list running background processes
//   cd     — change persistent working directory
//   which  — check if a program is installed
// ═══════════════════════════════════════════════════════════════════════════

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Persistent state ─────────────────────────────────────────────────────
let _cwd   = process.cwd();          // survives across calls in the same session
let _procs = new Map();              // name → { pid, proc, command, started, log }
let _env   = { ...process.env };     // survives across calls

export function getCwd() { return _cwd; }
export function getEnv() { return _env; }

// ─── Blocked patterns — only truly dangerous / irreversible ops ───────────
// Deliberately narrow. python -c, node -e, curl, etc. are legitimate dev tools.
const BLOCKED_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+[\/~]/i,   // rm -rf / or rm -rf ~
    /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+[\/~]/i,   // rm -fr /
    /\bformat\s+[a-z]:\b/i,                      // format c:
    /\bdel\s+\/[fqs]\s+\/[fqs]\s+\/[fqs]\b/i,   // del /f /s /q (recursive delete)
    /\bmkfs\b/i,                                  // mkfs (format disk)
    /:\(\)\s*\{.*:\|.*&.*\}/,                    // fork bomb :(){:|:&};:
    /\bdd\s+if=\/dev\/zero\b/i,                  // dd if=/dev/zero of=disk
    /\bshutdown\b/i,                             // shutdown
    /\bhalt\b/i,                                 // halt
    /\breboot\b/i,                               // reboot
    /\bpoweroff\b/i,                             // poweroff
    />\s*\/dev\/sd[a-z]/i,                       // redirect to raw disk
    /\bcurl\b.*\|\s*(ba)?sh\b/i,                 // curl | bash (remote exec)
    /\bwget\b.*\|\s*(ba)?sh\b/i,                 // wget | bash
];

function isBlocked(cmd) {
    for (const p of BLOCKED_PATTERNS) {
        if (p.test(cmd)) return `Blocked: matches pattern ${p}`;
    }
    return null;
}

// ─── Resolve cd from a command — update _cwd and strip the cd prefix ──────
// Handles: "cd /some/path && npm test" or just "cd /some/path"
function resolveCd(command) {
    const cdMatch = command.match(/^\s*cd\s+([^\s&;|]+)/);
    if (!cdMatch) return { command, cwd: _cwd };

    const target = cdMatch[1].replace(/^["']|["']$/g, '');
    let newCwd;
    try {
        const { resolve, isAbsolute } = await_path_sync();
        newCwd = isAbsolute(target) ? target : resolve(_cwd, target);
    } catch {
        newCwd = target;
    }
    _cwd = newCwd;

    // Strip the "cd X && " prefix — the cwd is now set, rest runs there
    const rest = command.replace(/^\s*cd\s+[^\s&;|]+\s*(?:&&\s*)?/, '').trim();
    return { command: rest, cwd: newCwd };
}

// sync path resolution without importing
function await_path_sync() {
    const path = { resolve: (...args) => require?.resolve?.(...args) };
    // Use native resolution
    try {
        const pathModule = { resolve: (...parts) => {
            let result = parts[0];
            for (let i = 1; i < parts.length; i++) {
                const p = parts[i];
                if (p.startsWith('/') || p.match(/^[A-Z]:\\/i)) { result = p; }
                else { result = result.replace(/\/?$/, '/') + p; }
            }
            return result.replace(/\\/g, '/');
        }, isAbsolute: (p) => p.startsWith('/') || /^[A-Z]:\\/i.test(p) };
        return pathModule;
    } catch { return { resolve: (base, rel) => base + '/' + rel, isAbsolute: () => false }; }
}

// ─── Print shell output to terminal ──────────────────────────────────────
// This is the "Claude Code" experience — you see commands running live.
function printShellHeader(command) {
    process.stdout.write(`\n  \x1b[36m▶\x1b[0m  \x1b[1m${command}\x1b[0m\n`);
}
function printShellLine(line, isErr = false) {
    const prefix = isErr ? '  \x1b[31m│\x1b[0m  ' : '  \x1b[90m│\x1b[0m  ';
    process.stdout.write(prefix + line + '\n');
}
function printShellFooter(code, ms) {
    const color = code === 0 ? '\x1b[32m' : '\x1b[31m';
    process.stdout.write(`  ${color}└─ exit ${code}\x1b[0m  \x1b[90m(${ms}ms)\x1b[0m\n\n`);
}

// ─── Exported sync snapshot — for MAX's _buildStateContext() ─────────────
export function getRunningProcesses() {
    return [..._procs.entries()].map(([name, p]) => ({
        name, pid: p.pid, command: p.command, started: p.started
    }));
}

export const ShellTool = {
    name: 'shell',
    description: 'Run shell commands with live terminal output. Supports background processes, persistent CWD, long-running tasks.',

    actions: {
        // ── run — execute a command, stream output live, wait for exit ────
        async run({ command, cwd, timeoutMs = 120_000 }) {
            const blocked = isBlocked(command);
            if (blocked) return { success: false, error: blocked };

            // Handle cd: update persistent cwd
            let runCwd = cwd || _cwd;
            const cdMatch = command.match(/^\s*cd\s+([^\s&;|"']+|"[^"]+"|'[^']+')(?:\s*&&\s*(.+))?$/);
            if (cdMatch) {
                const target = cdMatch[1].replace(/^["']|["']$/g, '');
                const path = await import('path');
                _cwd = path.default.resolve(_cwd, target);
                if (!cdMatch[2]) {
                    return { success: true, command, cwd: _cwd, stdout: '', stderr: '', note: `Working directory → ${_cwd}` };
                }
                command = cdMatch[2].trim();
                runCwd  = _cwd;
            }

            // Handle export/set: update persistent env
            const envMatch = command.match(/^\s*(?:export|set)\s+([a-zA-Z_][a-zA-Z0-9_]*)=([^&;|"']+|"[^"]+"|'[^']+')(?:\s*&&\s*(.+))?$/);
            if (envMatch) {
                const key = envMatch[1];
                const val = envMatch[2].replace(/^["']|["']$/g, '');
                _env[key] = val;
                if (!envMatch[3]) {
                    return { success: true, command, env: { [key]: val }, note: `Env set: ${key}=${val}` };
                }
                command = envMatch[3].trim();
            }

            // Validate cwd — ENOENT on spawn means the cwd doesn't exist, not the command
            try {
                const { promises: fsp } = await import('fs');
                await fsp.access(runCwd);
            } catch {
                runCwd = process.cwd();
                _cwd   = runCwd;  // self-heal persistent state
            }

            printShellHeader(command);

            const start     = Date.now();
            const stdoutLines = [];
            const stderrLines = [];

            return new Promise((resolve) => {
                const isWin = process.platform === 'win32';
                const proc  = spawn(
                    isWin ? 'cmd.exe' : 'bash',
                    isWin ? ['/c', command] : ['-c', command],
                    { cwd: runCwd, env: _env }
                );

                const timer = setTimeout(() => {
                    proc.kill();
                    printShellLine(`⚠  timed out after ${timeoutMs / 1000}s`, true);
                    resolve({
                        success: false, command, cwd: runCwd,
                        stdout: stdoutLines.join('\n'),
                        stderr: stderrLines.join('\n'),
                        error:  `Timed out after ${timeoutMs}ms`
                    });
                }, timeoutMs);

                proc.stdout.on('data', (chunk) => {
                    const lines = chunk.toString().split(/\r?\n/);
                    for (const l of lines) {
                        if (l) { printShellLine(l); stdoutLines.push(l); }
                    }
                });

                proc.stderr.on('data', (chunk) => {
                    const lines = chunk.toString().split(/\r?\n/);
                    for (const l of lines) {
                        if (l) { printShellLine(l, true); stderrLines.push(l); }
                    }
                });

                proc.on('close', (code) => {
                    clearTimeout(timer);
                    const ms = Date.now() - start;
                    printShellFooter(code ?? 0, ms);
                    resolve({
                        success:  (code ?? 0) === 0,
                        command,
                        cwd:      runCwd,
                        code:     code ?? 0,
                        stdout:   stdoutLines.join('\n').slice(0, 8000),
                        stderr:   stderrLines.join('\n').slice(0, 2000),
                        ms
                    });
                });

                proc.on('error', (err) => {
                    clearTimeout(timer);
                    printShellLine(`Error: ${err.message}`, true);
                    resolve({ success: false, command, error: err.message });
                });
            });
        },

        // ── start — spawn a background process (server, watcher, dev process) ──
        async start({ command, name, cwd }) {
            const blocked = isBlocked(command);
            if (blocked) return { success: false, error: blocked };

            const label   = name || command.split(' ')[0];
            const runCwd  = cwd || _cwd;

            // Kill existing process with same name
            if (_procs.has(label)) {
                const existing = _procs.get(label);
                try { existing.proc.kill(); } catch {}
                _procs.delete(label);
            }

            const isWin = process.platform === 'win32';
            const proc  = spawn(
                isWin ? 'cmd.exe' : 'bash',
                isWin ? ['/c', command] : ['-c', command],
                { cwd: runCwd, env: process.env, detached: false, stdio: 'pipe' }
            );

            const log     = [];
            const started = new Date().toISOString();

            proc.stdout.on('data', (d) => {
                const lines = d.toString().split(/\r?\n/).filter(Boolean);
                log.push(...lines);
                if (log.length > 200) log.splice(0, log.length - 200);
                // Print to terminal so user sees output from background process
                for (const l of lines) process.stdout.write(`  \x1b[35m[${label}]\x1b[0m ${l}\n`);
            });
            proc.stderr.on('data', (d) => {
                const lines = d.toString().split(/\r?\n/).filter(Boolean);
                log.push(...lines);
                if (log.length > 200) log.splice(0, log.length - 200);
                for (const l of lines) process.stdout.write(`  \x1b[31m[${label}]\x1b[0m ${l}\n`);
            });
            proc.on('exit', (code) => {
                process.stdout.write(`  \x1b[35m[${label}]\x1b[0m process exited (${code})\n`);
                _procs.delete(label);
            });
            proc.on('error', (err) => {
                process.stdout.write(`  \x1b[31m[${label}]\x1b[0m error: ${err.message}\n`);
                _procs.delete(label);
            });

            _procs.set(label, { pid: proc.pid, proc, command, started, cwd: runCwd, log });

            process.stdout.write(`\n  \x1b[35m▶\x1b[0m  \x1b[1m${label}\x1b[0m started (pid ${proc.pid})\n\n`);
            return { success: true, name: label, pid: proc.pid, command, cwd: runCwd };
        },

        // ── stop — kill a named background process ────────────────────────
        async stop({ name }) {
            if (!_procs.has(name)) {
                const running = [..._procs.keys()];
                return { success: false, error: `No process named "${name}". Running: ${running.join(', ') || 'none'}` };
            }
            const entry = _procs.get(name);
            try {
                entry.proc.kill('SIGTERM');
                setTimeout(() => { try { entry.proc.kill('SIGKILL'); } catch {} }, 3000);
            } catch {}
            _procs.delete(name);
            process.stdout.write(`  \x1b[35m[${name}]\x1b[0m stopped\n\n`);
            return { success: true, stopped: name, pid: entry.pid };
        },

        // ── ps — list running background processes ────────────────────────
        async ps() {
            if (_procs.size === 0) return { success: true, processes: [], count: 0 };
            const list = [..._procs.entries()].map(([name, p]) => ({
                name,
                pid:     p.pid,
                command: p.command,
                started: p.started,
                cwd:     p.cwd,
                lastLog: p.log.slice(-3).join(' | ')
            }));
            return { success: true, processes: list, count: list.length };
        },

        // ── cd — change persistent working directory ──────────────────────
        async cd({ path: targetPath }) {
            const pathModule = await import('path');
            const { promises: fsp } = await import('fs');
            const resolved = pathModule.default.resolve(_cwd, targetPath);
            try {
                await fsp.access(resolved);
                _cwd = resolved;
                return { success: true, cwd: _cwd };
            } catch {
                return { success: false, error: `Directory does not exist: ${resolved}`, cwd: _cwd };
            }
        },

        // ── which — check if a program is installed ───────────────────────
        async which({ program }) {
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
