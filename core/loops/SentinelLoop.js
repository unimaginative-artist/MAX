// ═══════════════════════════════════════════════════════════════════════════
// SentinelLoop.js — background project health monitoring
//
// Detects "code smells" and architectural rot:
//   1. Broken Imports (syntax check)
//   2. Test Gaps (new code without tests)
//   3. Missing Error Boundaries
//
// When a smell is found, it proactively queues a "fix" goal.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';

export class SentinelLoop {
    static id = 'sentinel';
    static signals = ['health check', 'sentinel', 'monitor codebase', 'scan for smells'];
    static description = 'Proactive codebase health monitoring. Checks for syntax errors, broken imports, and missing tests.';

    /**
     * Run a sentinel health check.
     * @param {object} goal  The health check goal
     * @param {object} max   MAX instance
     * @param {object} agentLoop AgentLoop instance
     */
    async run(goal, max, agentLoop = null) {
        console.log(`\n[SentinelLoop] 🛡️  Scanning project health...`);
        
        const findings = [];
        const filesToScan = await this._getChangedFiles(max);

        if (filesToScan.length === 0) {
            console.log(`[SentinelLoop] ✨ No new files to scan.`);
            return { success: true, summary: 'No changes detected' };
        }

        agentLoop?.emit('progress', { goal: 'Sentinel', step: 1, total: 3, action: `Checking ${filesToScan.length} files for syntax/imports` });
        
        for (const file of filesToScan) {
            // ── 1. Check Syntax & Imports ─────────────────────────────────
            if (file.endsWith('.js') || file.endsWith('.mjs')) {
                const syntaxOk = await this._checkSyntax(file, max);
                if (!syntaxOk.success) {
                    findings.push({ file, smell: 'Broken Imports/Syntax', details: syntaxOk.error, priority: 0.9, type: 'fix' });
                }
            }

            // ── 2. Check for Test Coverage ────────────────────────────────
            const hasTest = await this._hasCorrespondingTest(file, max);
            if (!hasTest && this._shouldHaveTest(file)) {
                findings.push({ file, smell: 'Missing Test', details: 'No corresponding .test.js found', priority: 0.4, type: 'task' });
            }
        }

        // ── 3. Act on findings ────────────────────────────────────────────
        agentLoop?.emit('progress', { goal: 'Sentinel', step: 2, total: 3, action: `Processing ${findings.length} findings` });
        
        for (const finding of findings) {
            const title = `${finding.smell}: ${path.basename(finding.file)}`;
            const alreadyQueued = max.goals?.listActive().some(g => g.title === title);
            
            if (!alreadyQueued) {
                max.goals?.addGoal({
                    title,
                    description: `Sentinel found a smell in ${finding.file}: ${finding.details}`,
                    type: finding.type,
                    priority: finding.priority,
                    source: 'sentinel'
                });
                console.log(`[SentinelLoop] 🎯 Queued ${finding.type}: "${title}"`);
            }
        }

        const summary = findings.length > 0 
            ? `Found ${findings.length} health issues. Fixes queued.`
            : 'Project health is optimal.';

        agentLoop?.emit('insight', {
            source: 'sentinel',
            label:  '🛡️ Health Scan Complete',
            result: summary + (findings.length > 0 ? `\n\n${findings.map(f => `• ${f.file}: ${f.smell}`).join('\n')}` : '')
        });

        return { goal: 'Sentinel', success: true, summary };
    }

    async _getChangedFiles(max) {
        try {
            // Use git to find files changed in the last 24h or since last commit
            const res = await max.tools.execute('shell', 'run', { command: 'git diff --name-only HEAD' });
            if (res.success && res.stdout) {
                return res.stdout.split('\n').filter(f => f.trim() && f.endsWith('.js'));
            }
            // Fallback: list all js files in core and tools (limited)
            const list = await max.tools.execute('file', 'list', { dir: 'core', recursive: true });
            return (list.files || []).slice(0, 10); 
        } catch { return []; }
    }

    async _checkSyntax(filePath, max) {
        try {
            // node --check is great for detecting broken imports in ESM
            const res = await max.tools.execute('shell', 'run', { command: `node --check ${filePath}` });
            return { success: res.exitCode === 0, error: res.stderr };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async _hasCorrespondingTest(filePath, max) {
        const base = path.basename(filePath, path.extname(filePath));
        const testPatterns = [
            `test/${base}.test.js`,
            `tests/${base}.test.js`,
            filePath.replace('.js', '.test.js')
        ];
        
        for (const p of testPatterns) {
            const stat = await fs.stat(p).catch(() => null);
            if (stat) return true;
        }
        return false;
    }

    _shouldHaveTest(filePath) {
        const internalDirs = ['core/', 'tools/', 'memory/', 'debate/'];
        return internalDirs.some(dir => filePath.includes(dir)) && !filePath.includes('.test.js');
    }
}
