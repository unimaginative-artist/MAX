import { EventEmitter } from 'events';
import { exec }         from 'child_process';
import { promisify }    from 'util';
import fs               from 'fs';
import path             from 'path';

const execAsync = promisify(exec);

const FAILURE_PATTERNS = [
    /FAIL\s+\S+/,
    /(\d+) failing/,
    /Tests:\s+\d+ failed/,
    /AssertionError/,
    /Error: /,
    /SyntaxError/,
    /Cannot find module/,
];

const SUCCESS_PATTERNS = [
    /Tests:\s+\d+ passed/,
    /\d+ passing/,
    /All tests passed/,
    /Test Suites:.*passed/,
];

export class CIWatcher extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max         = max;
        this.testCommand = config.testCommand || this._detectTestCommand();
        this.cwd         = config.cwd || process.cwd();
        this.lastResult  = null;
        this.lastCommit  = null;
        this._running    = false;
        this.stats       = { runs: 0, passes: 0, failures: 0 };
    }

    _detectTestCommand() {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
            if (pkg.scripts?.test) return 'npm test';
            if (pkg.scripts?.['test:unit']) return 'npm run test:unit';
        } catch {}
        if (fs.existsSync(path.join(process.cwd(), 'pytest.ini'))) return 'pytest --tb=short -q';
        if (fs.existsSync(path.join(process.cwd(), 'Makefile'))) return 'make test';
        return null;
    }

    async runChecks() {
        if (this._running || !this.testCommand) return null;
        this._running = true;
        this.stats.runs++;

        console.log(`[CI] 🧪 Running: ${this.testCommand}`);
        const start = Date.now();

        try {
            const { stdout, stderr } = await execAsync(this.testCommand, {
                cwd:     this.cwd,
                timeout: 120_000,
                env:     { ...process.env, CI: 'true', FORCE_COLOR: '0' }
            });

            const output = (stdout + stderr).trim();
            this.lastResult = { success: true, output, duration: Date.now() - start, timestamp: Date.now() };
            this.stats.passes++;
            console.log(`[CI] ✅ Tests passed (${((Date.now() - start) / 1000).toFixed(1)}s)`);
            this.emit('pass', this.lastResult);
            return this.lastResult;

        } catch (err) {
            const output = ((err.stdout || '') + (err.stderr || '') + err.message).trim();
            this.lastResult = { success: false, output, duration: Date.now() - start, timestamp: Date.now() };
            this.stats.failures++;

            const snippet = this._extractFailureSnippet(output);
            console.log(`[CI] ❌ Tests failed — auto-queuing fix goal`);
            this.emit('fail', this.lastResult);

            if (this.max?.goals) {
                const existing = this.max.goals.listActive()
                    .some(g => g.source === 'ci_watcher' && g.status !== 'done');

                if (!existing) {
                    this.max.goals.addGoal({
                        title:       'Fix CI: Test suite failure',
                        description: `Tests failed with:\n\`\`\`\n${snippet}\n\`\`\`\nRun \`${this.testCommand}\` to verify fix.`,
                        type:        'fix',
                        priority:    0.92,
                        source:      'ci_watcher',
                        verifyCommand: this.testCommand
                    });
                }
            }
            return this.lastResult;
        } finally {
            this._running = false;
        }
    }

    _extractFailureSnippet(output) {
        const lines = output.split('\n');
        const failIdx = lines.findIndex(l => FAILURE_PATTERNS.some(p => p.test(l)));
        if (failIdx === -1) return output.slice(0, 800);
        return lines.slice(Math.max(0, failIdx - 2), failIdx + 20).join('\n');
    }

    async checkOnFileWrite(filePath) {
        const ext = path.extname(filePath);
        const testable = ['.js', '.mjs', '.ts', '.py', '.go', '.rs'];
        if (!testable.includes(ext)) return;
        await this.runChecks();
    }

    getStatus() {
        return {
            testCommand: this.testCommand,
            running:     this._running,
            lastResult:  this.lastResult
                ? { success: this.lastResult.success, duration: this.lastResult.duration, timestamp: new Date(this.lastResult.timestamp).toISOString() }
                : null,
            ...this.stats
        };
    }
}
