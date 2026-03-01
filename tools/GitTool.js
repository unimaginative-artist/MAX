// ═══════════════════════════════════════════════════════════════════════════
// GitTool.js — git operations
// ═══════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function git(args, cwd = process.cwd()) {
    try {
        const { stdout, stderr } = await execAsync(`git ${args}`, { cwd, timeout: 30000 });
        return { success: true, output: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
        return { success: false, error: err.message, stderr: err.stderr?.trim() };
    }
}

export const GitTool = {
    name: 'git',
    description: 'Run git operations: status, diff, log, commit, branch',

    actions: {
        async status({ cwd }) { return git('status --short', cwd); },

        async diff({ cwd, file = '' }) { return git(`diff ${file}`.trim(), cwd); },

        async log({ cwd, limit = 10 }) { return git(`log --oneline -${limit}`, cwd); },

        async branch({ cwd }) { return git('branch -a', cwd); },

        async checkout({ cwd, branch }) { return git(`checkout ${branch}`, cwd); },

        async add({ cwd, files = '.' }) { return git(`add ${files}`, cwd); },

        async commit({ cwd, message }) {
            return git(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
        },

        async pull({ cwd }) { return git('pull', cwd); },

        async push({ cwd, remote = 'origin', branch = 'HEAD' }) {
            return git(`push ${remote} ${branch}`, cwd);
        },

        async clone({ url, dest }) {
            return git(`clone ${url} ${dest}`, process.cwd());
        }
    }
};
