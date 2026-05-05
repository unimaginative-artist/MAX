// ═══════════════════════════════════════════════════════════════════════════
// DebugLoop.js — Autonomous test → diagnose → fix → verify cycle
//
// When tests fail, DebugLoop runs the full repair loop automatically:
//   1. Run test suite, capture failures
//   2. Brain diagnoses root cause from failure output
//   3. AgentLoop executes targeted fix steps
//   4. Re-run tests to verify
//   5. Iterate up to maxIterations
//
// Wired into CIWatcher.fail events and exposed as TOOL:debug:run
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { exec }         from 'child_process';
import { promisify }    from 'util';

const execAsync = promisify(exec);

const FAILURE_PATTERNS = [
    /(?:FAIL|FAILED)\s+(.+)/,
    /(\d+) failing/,
    /Tests?:\s+(\d+) failed/,
    /AssertionError[^\n]*/,
    /Error: [^\n]*/,
    /SyntaxError[^\n]*/,
    /Cannot find module[^\n]*/,
    /TypeError[^\n]*/,
];

export class DebugLoop extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max    = max;
        this.config = {
            maxIterations: config.maxIterations || 5,
            timeoutMs:     config.timeoutMs     || 120_000,
            ...config
        };
        this._active = false;
    }

    // ─── Main entry: run the full autonomous debug loop ───────────────────
    async run(testCommand, { label = 'CI', goalContext = '' } = {}) {
        if (this._active) return { skipped: true, reason: 'DebugLoop already running' };
        this._active = true;

        console.log(`\n[DebugLoop] 🔁 Starting autonomous debug loop for: ${testCommand}`);
        this.emit('start', { testCommand, label });

        let iterations = 0;
        let lastFailures = '';

        try {
            while (iterations < this.config.maxIterations) {
                iterations++;
                console.log(`\n[DebugLoop] 🔬 Iteration ${iterations}/${this.config.maxIterations}`);

                // ── 1. Run tests ───────────────────────────────────────────
                const testResult = await this._runTests(testCommand);

                if (testResult.success) {
                    console.log(`[DebugLoop] ✅ All tests passing after ${iterations} iteration(s)`);
                    this.emit('fixed', { iterations, testCommand });
                    return { fixed: true, iterations, testCommand };
                }

                // ── 2. Extract failure context ─────────────────────────────
                const failures = this._extractFailures(testResult.output);
                console.log(`[DebugLoop] ❌ ${failures.length} failure(s) detected`);

                // Detect if we're spinning — same failures as last time
                if (failures.join('\n') === lastFailures && iterations > 1) {
                    console.log(`[DebugLoop] ⚠️  Same failures as last iteration — escalating strategy`);
                    this.emit('stuck', { iterations, failures });
                    // Try a different approach on stuck — reset and let brain think harder
                    await this._escalate(failures, testCommand, goalContext);
                } else {
                    lastFailures = failures.join('\n');
                    await this._diagnoseAndFix(failures, testResult.output, testCommand, goalContext, iterations);
                }

                // Brief pause between iterations to avoid hammering the system
                await new Promise(r => setTimeout(r, 2000));
            }

            console.log(`[DebugLoop] 🚫 Max iterations (${this.config.maxIterations}) reached — giving up`);
            this.emit('exhausted', { iterations, testCommand, lastFailures });
            return { fixed: false, iterations, testCommand, lastFailures };

        } finally {
            this._active = false;
        }
    }

    // ─── Run the test command and return result ───────────────────────────
    async _runTests(testCommand) {
        try {
            const { stdout, stderr } = await execAsync(testCommand, {
                cwd:     process.cwd(),
                timeout: this.config.timeoutMs,
                env:     { ...process.env, CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' }
            });
            return { success: true, output: (stdout + stderr).trim() };
        } catch (err) {
            return {
                success: false,
                output:  ((err.stdout || '') + (err.stderr || '') + '\n' + err.message).trim()
            };
        }
    }

    // ─── Extract the most relevant failure lines from test output ─────────
    _extractFailures(output) {
        const lines    = output.split('\n');
        const failures = [];

        for (let i = 0; i < lines.length; i++) {
            if (FAILURE_PATTERNS.some(p => p.test(lines[i]))) {
                // Include surrounding context (±3 lines) for each failure
                const start   = Math.max(0, i - 1);
                const end     = Math.min(lines.length - 1, i + 8);
                const snippet = lines.slice(start, end).join('\n').trim();
                if (!failures.includes(snippet)) failures.push(snippet);
                if (failures.length >= 4) break;  // cap at 4 distinct failures
            }
        }

        // Fallback: return first 600 chars if pattern matching found nothing
        if (failures.length === 0) failures.push(output.slice(0, 600));

        return failures;
    }

    // ─── Diagnose root cause + queue targeted fix goal ────────────────────
    async _diagnoseAndFix(failures, fullOutput, testCommand, goalContext, iteration) {
        const failureBlock = failures.join('\n---\n');

        console.log(`[DebugLoop] 🧠 Diagnosing failures...`);

        const diagPrompt = `You are MAX, an autonomous engineering agent fixing failing tests.

TEST COMMAND: ${testCommand}
ITERATION: ${iteration}
${goalContext ? `CONTEXT: ${goalContext}\n` : ''}
FAILURES:
\`\`\`
${failureBlock.slice(0, 2000)}
\`\`\`

Identify the root cause and the minimum code change needed to fix it.
Return ONLY JSON:
{
  "rootCause": "one sentence",
  "files": ["list of files to look at"],
  "fixDescription": "concrete description of what to change",
  "confidence": 0.0-1.0
}`;

        let diagnosis = null;
        try {
            const result = await this.max.agentBrain.think(diagPrompt, {
                tier:        'code',
                temperature: 0.1,
                maxTokens:   600
            });
            const match = result.text.match(/\{[\s\S]*\}/);
            if (match) diagnosis = JSON.parse(match[0]);
        } catch (err) {
            console.warn(`[DebugLoop] Diagnosis parse failed: ${err.message}`);
        }

        if (!diagnosis) {
            // Fallback: queue a generic fix goal
            diagnosis = {
                rootCause:       'Unknown — see failure output',
                files:           [],
                fixDescription:  `Fix failing tests: ${failureBlock.slice(0, 200)}`,
                confidence:      0.3
            };
        }

        console.log(`[DebugLoop] 📋 Root cause: ${diagnosis.rootCause} (${(diagnosis.confidence * 100).toFixed(0)}% confidence)`);
        this.emit('diagnosed', { rootCause: diagnosis.rootCause, files: diagnosis.files, iteration });

        // Queue a high-priority fix goal into AgentLoop
        if (this.max.goals) {
            const goalId = this.max.goals.addGoal({
                title:         `DebugLoop fix (iter ${iteration}): ${diagnosis.rootCause.slice(0, 60)}`,
                description:   `${diagnosis.fixDescription}\n\nFailing tests:\n\`\`\`\n${failureBlock.slice(0, 1000)}\n\`\`\``,
                type:          'fix',
                priority:      0.97,
                source:        'debug_loop',
                verifyCommand: testCommand,
                files:         diagnosis.files
            });
            console.log(`[DebugLoop] 🎯 Fix goal queued (id: ${goalId})`);

            // Wait for the goal to complete before next test run
            await this._waitForGoal(goalId);
        }
    }

    // ─── Escalation: stuck on same failures — try harder approach ─────────
    async _escalate(failures, testCommand, goalContext) {
        console.log(`[DebugLoop] 🔺 Escalating — requesting deeper investigation`);

        if (this.max.goals) {
            this.max.goals.addGoal({
                title:       `DebugLoop ESCALATION: persistent test failure`,
                description: `Tests keep failing with the same errors after multiple fix attempts.\n\nFailures:\n${failures.join('\n---\n').slice(0, 800)}\n\nTest command: ${testCommand}\n${goalContext}\n\nDo a deeper investigation — read the full test files, trace the import chain, check for environment issues.`,
                type:        'research',
                priority:    0.98,
                source:      'debug_loop_escalation'
            });
        }
    }

    // ─── Wait for a specific goal to reach done/failed state ──────────────
    async _waitForGoal(goalId, timeoutMs = 180_000) {
        const start = Date.now();
        return new Promise(resolve => {
            const check = () => {
                if (Date.now() - start > timeoutMs) { resolve(false); return; }
                const goal = this.max.goals?._active?.get(goalId);
                if (!goal || goal.status === 'done' || goal.status === 'failed') {
                    resolve(goal?.status === 'done');
                } else {
                    setTimeout(check, 2000);
                }
            };
            check();
        });
    }

    getStatus() {
        return { active: this._active, maxIterations: this.config.maxIterations };
    }
}
