
import path from 'path';
import fs from 'fs/promises';

/**
 * DiagnosticsSystem — Runs background scanners to feed the Goal Economy.
 * Section 8 of Architecture Notes.
 */
export class DiagnosticsSystem {
    constructor(max) {
        this.max = max;
        this.scanners = [
            this._scanPerformance.bind(this),
            this._scanTestCoverage.bind(this),
            this._scanSecurity.bind(this),
            this._scanSomaKernel.bind(this)
        ];
    }

    async runAll() {
        console.log('[Diagnostics] 🔍 Running system-wide architectural audit...');
        // Run all scanners in parallel so slow ones don't block the pass
        await Promise.allSettled(this.scanners.map(s => s())).then(results => {
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    console.error(`[Diagnostics] Scanner #${i} failed: ${r.reason?.message || r.reason}`);
                }
            });
        });
    }

    /**
     * Section 8: PerformanceScanner.
     * Identifies slow turns and reasoning bottlenecks.
     */
    async _scanPerformance() {
        const outcomes = this.max.outcomes?.getStats();
        if (!outcomes || outcomes.total < 5) return;

        if (outcomes.avgLatency > 15000) {
            this.max.goals.addGoal({
                title: `Optimize reasoning latency (Current avg: ${outcomes.avgLatency.toFixed(0)}ms)`,
                priority: 0.75,
                source: 'performance_scanner',
                type: 'optimization'
            });
        }
    }

    /**
     * Section 8: TestScanner.
     * Finds mission-critical files without tests.
     */
    async _scanTestCoverage() {
        const coreDir = path.join(process.cwd(), 'core');
        const testDir = path.join(process.cwd(), 'tests');

        const files = await fs.readdir(coreDir);
        let goalsQueued = 0;
        const MAX_TEST_GOALS = 3;  // cap: don't flood the goal queue

        for (const file of files) {
            if (goalsQueued >= MAX_TEST_GOALS) break;
            if (!file.endsWith('.js')) continue;
            const testFile = file.replace('.js', '.test.js');
            const hasTest = await fs.access(path.join(testDir, testFile)).then(() => true).catch(() => false);

            if (!hasTest) {
                this.max.goals.addGoal({
                    title: `Improve test coverage: Create unit test for core/${file}`,
                    priority: 0.6,
                    source: 'test_scanner',
                    type: 'testing'
                });
                goalsQueued++;
            }
        }
    }

    /**
     * Section 8: SecurityScanner.
     * Scans for secrets or unsafe patterns.
     */
    async _scanSecurity() {
        // Basic check for hardcoded API keys in memory/config
        const envPath = path.join(process.cwd(), 'config', 'api-keys.env');
        const content = await fs.readFile(envPath, 'utf8').catch(() => '');
        
        if (content.includes('your-key-here') || content.includes('your-openai-key')) {
            this.max.goals.addGoal({
                title: "Security: Replace placeholder API keys in config/api-keys.env",
                priority: 0.9,
                source: 'security_scanner',
                type: 'security'
            });
        }
    }

    /**
     * SOMA Kernel Scanner.
     * MAX reaches out to SOMA to see if the kernel needs engineering work.
     */
    async _scanSomaKernel() {
        if (!this.max.soma?.available) return;

        const discoveries = await this.max.soma.auditSoma();
        if (discoveries && discoveries.length > 0) {
            for (const d of discoveries) {
                this.max.goals.addGoal({
                    ...d,
                    source: 'soma_kernel_scanner'
                });
            }
        }
    }
}
