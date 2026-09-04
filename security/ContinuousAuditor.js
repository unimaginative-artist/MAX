// ═══════════════════════════════════════════════════════════════════════════
// ContinuousAuditor.js — Background Security & Red-Teaming Daemon
// Scans project code, evaluates security risks, and queues fix goals.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export class ContinuousAuditor {
    constructor(max, config = {}) {
        this.max       = max;
        this.interval  = config.interval || 300000; // run every 5 mins
        this._timer    = null;
        this.running   = false;
        this.auditLog  = [];
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.log('[ContinuousAuditor] 🛡️  Background security auditor armed');
        this._timer = setInterval(() => this.runAuditCycle(), this.interval);
        // Run initial cycle asynchronously
        setTimeout(() => this.runAuditCycle(), 5000);
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this.running = false;
        console.log('[ContinuousAuditor] 🛑 Background security auditor stopped');
    }

    async runAuditCycle() {
        console.log('[ContinuousAuditor] 🔍 Running continuous security scan...');
        try {
            const vulnerabilities = [];
            const srcDirs = ['core', 'tools', 'server', 'swarm'];

            for (const dir of srcDirs) {
                const fullDir = join(process.cwd(), dir);
                const files = this._findFiles(fullDir, ['.js', '.mjs', '.cjs']);

                for (const file of files) {
                    const content = readFileSync(file, 'utf8');
                    // Check for hardcoded API keys or unsafe eval calls
                    if (/sk-[a-zA-Z0-9]{32,}/.test(content) && !file.includes('.env')) {
                        vulnerabilities.push({ file, issue: 'Potential hardcoded secret detected' });
                    }
                    if (/\beval\s*\(/.test(content)) {
                        vulnerabilities.push({ file, issue: 'Unsafe eval() invocation detected' });
                    }
                }
            }

            if (vulnerabilities.length > 0) {
                console.warn(`[ContinuousAuditor] ⚠️ Found ${vulnerabilities.length} potential security issues`);
                for (const v of vulnerabilities) {
                    if (this.max?.goals) {
                        this.max.goals.addGoal({
                            title: `Security Fix: ${v.issue} in ${v.file.split(/[\/\\]/).pop()}`,
                            description: `Security audit detected ${v.issue} at ${v.file}`,
                            priority: 0.95
                        });
                    }
                }
            } else {
                console.log('[ContinuousAuditor] ✅ Security audit passed cleanly');
            }

            this.auditLog.push({ ts: Date.now(), vulns: vulnerabilities.length });
        } catch (err) {
            console.error('[ContinuousAuditor] Error during audit cycle:', err.message);
        }
    }

    _findFiles(dirPath, exts) {
        let results = [];
        try {
            const list = readdirSync(dirPath);
            for (const item of list) {
                const fullPath = join(dirPath, item);
                const stat = statSync(fullPath);
                if (stat.isDirectory()) {
                    if (!item.includes('node_modules') && !item.startsWith('.')) {
                        results = results.concat(this._findFiles(fullPath, exts));
                    }
                } else if (exts.some(ext => fullPath.endsWith(ext))) {
                    results.push(fullPath);
                }
            }
        } catch { /* skip missing dirs */ }
        return results;
    }
}
