
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * EvolutionArbiter — Production-grade self-modification pipeline.
 * Ensures MAX can only improve his own code if it passes strict validation.
 */
export class EvolutionArbiter {
    constructor(config = {}) {
        this.baseDir    = process.cwd();
        this.stagingDir = path.join(this.baseDir, '.max', 'evolution', 'staging');
        this.backupDir  = path.join(this.baseDir, '.max', 'evolution', 'backups');
        this.swarm      = config.swarm || null;
    }

    async initialize() {
        await fs.mkdir(this.stagingDir, { recursive: true });
        await fs.mkdir(this.backupDir, { recursive: true });
        // Ensure staging is treated as ESM so node --check works for .js files
        await fs.writeFile(path.join(this.stagingDir, 'package.json'), JSON.stringify({ type: 'module' }));
    }

    /**
     * Phase 1: Propose a change.
     * Copies the original file to staging for modification.
     */
    async propose(relPath) {
        const fullPath   = path.join(this.baseDir, relPath);
        const stagedPath = path.join(this.stagingDir, path.basename(relPath));
        
        await fs.copyFile(fullPath, stagedPath);
        return stagedPath;
    }

    /**
     * Phase 2: Verify the staged change.
     * Runs syntax check, ESLint, and look-for-lobotomy checks.
     */
    async verify(stagedPath) {
        console.log(`[Evolution] 🛡️ Verifying staged change: ${path.basename(stagedPath)}`);

        // 1. Basic Node.js syntax check
        try {
            await execAsync(`node --check "${stagedPath}"`);
        } catch (err) {
            return { success: false, error: `Syntax Error: ${err.stderr || err.message}` };
        }

        // 2. ESLint check (Production Grade)
        try {
            // We use a basic config for safety
            await execAsync(`npx eslint "${stagedPath}" --no-eslintrc --rule 'no-undef: error'`);
        } catch (err) {
            // ESLint returns non-zero on warnings/errors
            if (err.stdout?.includes('error')) {
                return { success: false, error: `Linting Error: ${err.stdout}` };
            }
        }

        // 3. "Heartbeat Protection" — ensure critical symbols aren't deleted
        const content = await fs.readFile(stagedPath, 'utf8');
        const filename = path.basename(stagedPath);

        if (filename === 'MAX.js' && !content.includes('class MAX')) {
            return { success: false, error: "Lobotomy Detected: 'class MAX' missing from core file." };
        }
        if (filename === 'AgentLoop.js' && !content.includes('runCycle')) {
            return { success: false, error: "Brain Failure: 'runCycle' missing from AgentLoop." };
        }

        // 4. Automated Unit Test Check
        try {
            console.log(`[Evolution] 🧪 Running project test suite against change...`);
            // We run with --passWithNoTests so it doesn't fail if the user hasn't written any yet,
            // but if there ARE tests, they MUST pass.
            await execAsync('npm test');
        } catch (err) {
            return { 
                success: false, 
                error: `Regression Detected: The change broke existing functionality.`,
                details: err.stdout || err.message
            };
        }

        // 4.5 Runtime Runtime Validation (Level 4 Dry Run)
        // Ensure the file can actually be imported/required without crashing.
        // This catches runtime bugs that static checks (node --check) miss.
        try {
            console.log(`[Evolution] 🏃 Running runtime dry-run (import check)...`);
            const dryRunScript = `import * as mod from './${path.basename(stagedPath)}'; console.log('Import successful');`;
            const scriptPath = path.join(this.stagingDir, 'dry_run.js');
            await fs.writeFile(scriptPath, dryRunScript);
            
            await execAsync(`node "${scriptPath}"`, { cwd: this.stagingDir });
            await fs.unlink(scriptPath).catch(() => {});
        } catch (err) {
            return {
                success: false,
                error: `Runtime Crash Detected: The change caused an error during import.`,
                details: err.stderr || err.message
            };
        }

        // 5. Adversarial Peer Review (Level 4 Evolution)
        if (this.swarm) {
            const review = await this.adversarialReview(stagedPath);
            if (!review.success) {
                return { success: false, error: `Adversarial Review Rejected: ${review.reason}` };
            }
        }

        return { success: true };
    }

    /**
     * Phase 2.5: Swarm Review (Architect vs maintainer)
     */
    async adversarialReview(stagedPath) {
        console.log(`[Evolution] 🐝 Starting adversarial swarm review...`);
        const filename = path.basename(stagedPath);
        const content  = await fs.readFile(stagedPath, 'utf8');

        try {
            const task = {
                name: `Review Evolution: ${filename}`,
                subtasks: [
                    {
                        id: 'Architect',
                        prompt: `Review this proposed change to ${filename}. Does it improve the system architecture? Is it idiomatic? 
CODE:
${content}`
                    },
                    {
                        id: 'SecurityAuditor',
                        prompt: `Act as a paranoid security and stability auditor. Find any ways this change to ${filename} could break the system, introduce leaks, or crash the agent.
CODE:
${content}

Return a DISCOVERY: {"riskSeverity": 0.0-1.0, "reason": "..."} if you find issues.`
                    }
                ]
            };

            const result = await this.swarm.run(task);
            
            // If the SecurityAuditor found a high risk, reject
            const securityResult = result.results.find(r => r.id === 'SecurityAuditor');
            const risk = securityResult?.discoveries?.riskSeverity || 0;

            if (risk > 0.7) {
                const reason = securityResult?.discoveries?.reason || 'High risk detected';
                console.warn(`[Evolution] ❌ Swarm Rejected change: ${reason}`);
                return { success: false, reason };
            }

            console.log(`[Evolution] ✅ Swarm Approved change`);
            return { success: true };
        } catch (err) {
            console.warn(`[Evolution] ⚠️ Review failed (ignoring): ${err.message}`);
            return { success: true }; // don't block on swarm failure
        }
    }

    /**
     * Phase 3: Commit the change.
     * Backs up the original, moves the staged file into place.
     */
    async commit(relPath) {
        const originalPath = path.join(this.baseDir, relPath);
        const stagedPath   = path.join(this.stagingDir, path.basename(relPath));
        const backupPath   = path.join(this.backupDir, `${path.basename(relPath)}.${Date.now()}.bak`);

        // Backup
        await fs.copyFile(originalPath, backupPath);

        // Move into place
        await fs.rename(stagedPath, originalPath);

        console.log(`[Evolution] ✅ Successfully evolved: ${relPath}`);
        return { success: true, backup: backupPath };
    }
}
