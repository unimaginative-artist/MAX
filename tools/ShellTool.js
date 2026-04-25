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

import { exec, spawn }  from 'child_process';
import { promisify }    from 'util';
import fs               from 'fs/promises';
import path             from 'path';
import { VirtualShell } from '../core/VirtualShell.js';

const execAsync = promisify(exec);

// ── Persistent state ──
let _procs = new Map();              // name → { pid, proc, command, started, log }

// The true persistent shell
const vShell = new VirtualShell();
vShell.start();

// ── Stream output to terminal for live viewing ──
vShell.on('data', (data) => {
    const lines = data.split(/\r?\n/);
    for (const l of lines) {
        // We filter out our internal delimiters so the user doesn't see them
        if (l && !l.includes('__EXIT_CODE_') && !l.includes('__MAX_SHELL_DONE_')) {
            printShellLine(l);
        }
    }
});

vShell.on('data_err', (data) => {
    const lines = data.split(/\r?\n/);
    for (const l of lines) {
        if (l) printShellLine(l, true);
    }
});

const PID_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.max', 'pids.json');

async function _savePids() {
    try {
        await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
        const data = {};
        for (const [name, p] of _procs) data[name] = { pid: p.pid, command: p.command, started: p.started };
        await fs.writeFile(PID_FILE, JSON.stringify(data, null, 2));
    } catch {}
}

async function _killByPid(pid) {
    if (process.platform === 'win32') {
        try { await execAsync(`taskkill /F /T /PID ${pid}`); } catch {}
    } else {
        try { process.kill(-pid, 'SIGKILL'); } catch {}
        try { process.kill(pid,  'SIGKILL'); } catch {}
    }
}

// ── Blocked patterns ──
const BLOCKED_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+[\/~]/i,
    /\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+[\/~]/i,
    /\bformat\s+[a-z]:\b/i,
    /\bdel\s+\/[fqs]\s+\/[fqs]\s+\/[fqs]\b/i,
    /\bmkfs\b/i,
    /:\(\)\s*\{.*:\|.*&.*\}/,
    /\bdd\s+if=\/dev\/zero\b/i,
    /\bshutdown\b/i,
    /\bhalt\b/i,
    /\breboot\b/i,
    /\bpoweroff\b/i,
    />\s*\/dev\/sd[a-z]/i,
    /\bcurl\b.*\|\s*(ba)?sh\b/i,
    /\bwget\b.*\|\s*(ba)?sh\b/i,
];

function isBlocked(cmd) {
    for (const p of BLOCKED_PATTERNS) {
        if (p.test(cmd)) return `Blocked: matches pattern ${p}`;
    }
    return null;
}

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

export function getRunningProcesses() {
    return [..._procs.entries()].map(([name, p]) => ({
        name, pid: p.pid, command: p.command, started: p.started, cwd: p.cwd,
        recentLog: p.log.slice(-20)
    }));
}

export function getProcessLog(name) {
    return _procs.get(name)?.log || [];
}

// External broadcast hook — called when a background process emits a line
// Set by server.js so SSE clients see live process output
let _logBroadcast = null;
export function setProcessLogBroadcast(fn) { _logBroadcast = fn; }

export const ShellTool = {
    name: 'shell',
    description: 'Run shell commands with a stateful Virtual Shell. Keeps working directory and environment variables persistent. Can start/stop background daemons.',

    actions: {
        async run({ command, timeoutMs = 120_000 }) {
            const blocked = isBlocked(command);
            if (blocked) return { success: false, error: blocked };

            printShellHeader(command);
            const start = Date.now();

            try {
                const res = await vShell.run(command, timeoutMs);
                const ms = Date.now() - start;
                printShellFooter(res.code, ms);
                
                return {
                    success: res.success,
                    command,
                    code: res.code,
                    stdout: res.stdout.slice(0, 8000),
                    stderr: res.stderr.slice(0, 2000),
                    ms
                };
            } catch (err) {
                printShellLine(`Error: ${err.message}`, true);
                printShellFooter(-1, Date.now() - start);
                return { success: false, command, error: err.message };
            }
        },

        async start({ command, name, cwd }) {
            const blocked = isBlocked(command);
            if (blocked) return { success: false, error: blocked };

            const label   = name || command.split(' ')[0];
            const runCwd  = cwd || process.cwd();

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
                for (const l of lines) {
                    process.stdout.write(`  \x1b[35m[${label}]\x1b[0m ${l}\n`);
                    _logBroadcast?.({ process: label, line: l, stream: 'stdout', ts: Date.now() });
                }
            });
            proc.stderr.on('data', (d) => {
                const lines = d.toString().split(/\r?\n/).filter(Boolean);
                log.push(...lines);
                if (log.length > 200) log.splice(0, log.length - 200);
                for (const l of lines) {
                    process.stdout.write(`  \x1b[31m[${label}]\x1b[0m ${l}\n`);
                    _logBroadcast?.({ process: label, line: l, stream: 'stderr', ts: Date.now() });
                }
            });
            proc.on('exit', (code) => {
                process.stdout.write(`  \x1b[35m[${label}]\x1b[0m process exited (${code})\n`);
                _logBroadcast?.({ process: label, line: `process exited (${code})`, stream: 'system', exitCode: code, ts: Date.now() });
                _procs.delete(label);
                _savePids();
            });
            proc.on('error', (err) => {
                process.stdout.write(`  \x1b[31m[${label}]\x1b[0m error: ${err.message}\n`);
                _procs.delete(label);
                _savePids();
            });

            _procs.set(label, { pid: proc.pid, proc, command, started, cwd: runCwd, log });
            _savePids();

            process.stdout.write(`\n  \x1b[35m▶\x1b[0m  \x1b[1m${label}\x1b[0m started (pid ${proc.pid})\n\n`);
            return { success: true, name: label, pid: proc.pid, command, cwd: runCwd };
        },

        async stop({ name }) {
            let pid = null;

            if (_procs.has(name)) {
                const entry = _procs.get(name);
                pid = entry.pid;
                try { entry.proc.kill('SIGTERM'); } catch {}
                _procs.delete(name);
            } else {
                try {
                    const saved = JSON.parse(await fs.readFile(PID_FILE, 'utf8'));
                    if (saved[name]) pid = saved[name].pid;
                } catch {}
                if (!pid) {
                    const running = [..._procs.keys()];
                    return { success: false, error: `No process named "${name}". Running: ${running.join(', ') || 'none'}` };
                }
            }

            await _killByPid(pid);
            _savePids();
            process.stdout.write(`  \x1b[35m[${name}]\x1b[0m stopped (pid ${pid})\n\n`);
            return { success: true, stopped: name, pid };
        },

        async ps() {
            if (_procs.size === 0) return { success: true, processes: [], count: 0 };
            const list = [..._procs.entries()].map(([name, p]) => ({
                name, pid: p.pid, command: p.command, started: p.started, cwd: p.cwd, lastLog: p.log.slice(-3).join(' | ')
            }));
            return { success: true, processes: list, count: list.length };
        },

        async cd({ path: targetPath }) {
            // Because we use a Virtual Shell, we just pass the 'cd' command directly to it!
            const res = await vShell.run(`cd "${targetPath}"`);
            return { success: res.success, output: res.stdout, error: res.stderr };
        },

        async which({ program }) {
            const cmd = process.platform === 'win32' ? `where ${program}` : `which ${program}`;
            const res = await vShell.run(cmd, 5000);
            return { success: true, found: res.success, path: res.stdout.trim() };
        }
    }
};
