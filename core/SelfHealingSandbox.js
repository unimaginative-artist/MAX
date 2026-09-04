// ═══════════════════════════════════════════════════════════════════════════
// SelfHealingSandbox.js — Automated Self-Healing CI/CD Testing Sandbox
// Runs post-edit syntax & test verification. If an edit breaks syntax or tests,
// feeds stack trace back to Brain for surgical auto-repair or safely reverts.
// ═══════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SelfHealingSandbox {
    constructor(max) {
        this.max = max;
        this.maxAttempts = 3;
    }

    /**
     * Safely executes an edit with full self-healing verification
     */
    async applyAndVerifyEdit(filePath, patchPlan, originalCode) {
        console.log(`[SelfHealing] 🛡️ Validating edit on ${path.basename(filePath)}...`);

        // 1. Create temporary backup
        const backupPath = `${filePath}.bak_${Date.now()}`;
        fs.writeFileSync(backupPath, originalCode, 'utf8');

        let currentCode = originalCode.replace(patchPlan.targetSnippet, patchPlan.replacementCode);
        let attempt = 0;
        let verified = false;

        while (attempt < this.maxAttempts && !verified) {
            attempt++;
            console.log(`[SelfHealing] 🧪 Verification attempt ${attempt}/${this.maxAttempts}...`);

            // Apply candidate code to disk
            fs.writeFileSync(filePath, currentCode, 'utf8');

            // Check 1: Syntax Validation
            const syntaxResult = await this._checkSyntax(filePath);
            if (!syntaxResult.valid) {
                console.warn(`[SelfHealing] ❌ Syntax Error detected on attempt ${attempt}:`, syntaxResult.error);
                currentCode = await this._autoRepair(filePath, currentCode, syntaxResult.error, patchPlan.rationale);
                continue;
            }

            // Check 2: Quick Unit Test Suite (if configured)
            const testResult = await this._runQuickTests();
            if (!testResult.success) {
                console.warn(`[SelfHealing] ⚠️ Test suite failure on attempt ${attempt}:`, testResult.error);
                currentCode = await this._autoRepair(filePath, currentCode, testResult.error, patchPlan.rationale);
                continue;
            }

            // If syntax and tests pass, edit is VERIFIED!
            verified = true;
            console.log(`[SelfHealing] ✅ Edit on ${path.basename(filePath)} VERIFIED CLEAN!`);
        }

        // Clean up backup file
        if (fs.existsSync(backupPath)) {
            if (!verified) {
                // Revert to original code if all attempts failed
                console.error(`[SelfHealing] 🚨 All ${this.maxAttempts} self-repair attempts failed. Reverting to original backup!`);
                fs.writeFileSync(filePath, originalCode, 'utf8');
            }
            fs.unlinkSync(backupPath);
        }

        return { verified, finalCode: currentCode };
    }

    async _checkSyntax(filePath) {
        try {
            await execAsync(`node --check "${filePath}"`);
            return { valid: true };
        } catch (err) {
            return { valid: false, error: err.stderr || err.stdout || err.message };
        }
    }

    async _runQuickTests() {
        try {
            // Run lightweight test verification if test file exists
            if (fs.existsSync('test_orchestrator.mjs')) {
                await execAsync('node test_orchestrator.mjs', { timeout: 10000 });
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.stderr || err.stdout || err.message };
        }
    }

    async _autoRepair(filePath, brokenCode, errorLog, originalRationale) {
        console.log(`[SelfHealing] 🔧 Invoking Brain to repair syntax/test error...`);

        const repairPrompt = `The recent code patch for ${path.basename(filePath)} caused a syntax or test error.
Original Rationale: ${originalRationale}

Broken Code:
\`\`\`javascript
${brokenCode.slice(0, 1500)}
\`\`\`

Error Traceback:
\`\`\`
${errorLog.slice(0, 1000)}
\`\`\`

Fix the error and return the FULL valid JavaScript replacement code.`;

        const response = await this.max.brain.think(repairPrompt, { tier: 'smart' });
        const text = response?.text || '';

        // Extract code block
        const codeMatch = text.match(/```(?:javascript|js)?\n([\s\S]*?)\n```/);
        return codeMatch ? codeMatch[1] : brokenCode;
    }
}
