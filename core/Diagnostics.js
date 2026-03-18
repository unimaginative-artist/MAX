
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
            this._scanSomaKernel.bind(this),
            this._scanMemoryPressure.bind(this)
        ];
    }

    /**
     * Section 8: MemoryScanner.
     * Detects high memory pressure.
     */
    async _scanMemoryPressure() {
        const os = await import('os');
        const free = os.freemem() / 1024 / 1024;
        if (free < 500) {
            this.max.goals.addGoal({
                title: `Memory Pressure: Only ${free.toFixed(0)}MB free. Check for leaks.`,
                priority: 0.8,
                source: 'memory_scanner',
                type: 'optimization'
            });
        }

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
        // Scan for accidentally committed real secrets (not placeholders — those are intentional).
        // Placeholder strings like "your-openai-key-here" are valid config defaults — flagging them
        // as a goal is useless because MAX has no key to substitute without the user providing one.
        // If the user says "here's my key: sk-...", MAX can write it directly via file:write.
        const envPath = path.join(process.cwd(), 'config', 'api-keys.env');
        const content = await fs.readFile(envPath, 'utf8').catch(() => '');

        // Flag lines that look like real exposed keys: sk-... / AIza... / hf_... etc.
        // Skip comment lines and lines that are clearly placeholders.
        const realKeyPattern = /^[A-Z_]+=(?:sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_\-]{30,}|hf_[A-Za-z0-9]{20,})/m;
        const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const exposedLine = lines.find(l => realKeyPattern.test(l));

        if (exposedLine) {
            this.max.goals.addGoal({
                title: "Security: Real API key detected in config/api-keys.env — consider moving to env var",
                priority: 0.5,  // informational — lower priority, human must decide
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
