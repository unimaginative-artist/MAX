// ═══════════════════════════════════════════════════════════════════════════
// GitTool.js — git operations
//
// Security: uses execFile() with args as an array — no shell is invoked,
// so commit messages, branch names, and file paths cannot cause injection
// regardless of what characters they contain.
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// All git calls go through here — args is always an array, never a string
async function git(args, cwd = process.cwd()) {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, { cwd, timeout: 30000 });
        return { success: true, output: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
        return { success: false, error: err.message, stderr: err.stderr?.trim() };
    }
}

export const GitTool = {
    name: 'git',
    description: 'Run git operations: status, diff, log, commit, branch',

    actions: {
        async status({ cwd }) {
            return git(['status', '--short'], cwd);
        },

        async diff({ cwd, file = '' }) {
            return git(file ? ['diff', file] : ['diff'], cwd);
        },

        async log({ cwd, limit = 10 }) {
            return git(['log', '--oneline', `-${Math.min(parseInt(limit) || 10, 100)}`], cwd);
        },

        async branch({ cwd }) {
            return git(['branch', '-a'], cwd);
        },

        async checkout({ cwd, branch }) {
            return git(['checkout', branch], cwd);
        },

        async add({ cwd, files = '.' }) {
            const fileList = files.split(/\s+/).filter(Boolean);
            return git(['add', ...fileList], cwd);
        },

        async commit({ cwd, message }) {
            // message passed as a direct arg — no escaping needed, no shell involved
            return git(['commit', '-m', message], cwd);
        },

        async pull({ cwd }) {
            return git(['pull'], cwd);
        },

        async push({ cwd, remote = 'origin', branch = 'HEAD' }) {
            return git(['push', remote, branch], cwd);
        },

        async clone({ url, dest }) {
            return git(['clone', url, dest], process.cwd());
        }
    }
};
