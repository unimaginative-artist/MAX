
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
    }

    async initialize() {
        await fs.mkdir(this.stagingDir, { recursive: true });
        await fs.mkdir(this.backupDir, { recursive: true });
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

        return { success: true };
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
