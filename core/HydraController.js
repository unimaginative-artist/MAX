
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const exec = promisify(execCallback);

/**
 * HYDRA CONTROLLER
 * v0.5 — Parallel Git Worktree Orchestrator
 * 
 * Protocol: POSEIDON
 * Capability: Agent Trees (Parallel Autonomous Verification)
 */
export class HydraController {
    constructor(max) {
        this.max = max;
        this.heads = new Map();
        this.basePath = process.cwd();
        this.worktreeRoot = path.join(this.basePath, '.max', 'worktrees');
    }

    /**
     * Spawns a new Hydra Head in an isolated Git Worktree.
     * This creates a physical sandbox where the agent can build and test
     * without affecting the main source tree.
     */
    async spawnHead(role = 'grinder', config = {}) {
        const headId = `hydra-${role}-${Math.random().toString(36).substr(2, 5)}`;
        const worktreePath = path.join(this.worktreeRoot, headId);
        const branchName = `hydra/branch-${headId}`;

        console.log(`[HYDRA] 🐉 Spawning head: ${headId} (Role: ${role})...`);

        try {
            // 1. Ensure worktree root exists
            if (!existsSync(this.worktreeRoot)) {
                await fs.mkdir(this.worktreeRoot, { recursive: true });
            }

            // 2. Create the worktree
            // -b creates a new branch for this head to work on
            console.log(`[HYDRA] 🛠️ Creating worktree at ${headId}...`);
            await exec(`git worktree add -b ${branchName} "${worktreePath}" HEAD`, { cwd: this.basePath });

            const head = { 
                id: headId, 
                role, 
                status: 'online', 
                path: worktreePath, 
                branch: branchName,
                createdAt: Date.now(),
                config 
            };
            
            this.heads.set(headId, head);
            return headId;
        } catch (err) {
            console.error(`[HYDRA] ❌ Failed to spawn head ${headId}:`, err.message);
            throw err;
        }
    }

    /**
     * Terminate a head and remove its worktree sandbox.
     */
    async killHead(headId) {
        const head = this.heads.get(headId);
        if (!head) return;

        console.log(`[HYDRA] 💀 Terminating head: ${headId}...`);
        try {
            // Remove the worktree and the branch
            await exec(`git worktree remove --force "${head.path}"`, { cwd: this.basePath });
            await exec(`git branch -D ${head.branch}`, { cwd: this.basePath });
            this.heads.delete(headId);
            return true;
        } catch (err) {
            console.warn(`[HYDRA] ⚠️ Cleanup for ${headId} failed:`, err.message);
            return false;
        }
    }

    /**
     * Project Ares: Verify a proposed change within a Head's worktree.
     */
    async auditChange(headId, filePath, command = 'node --check') {
        const head = this.heads.get(headId);
        if (!head) throw new Error(`Head ${headId} not found`);

        const fullPath = path.join(head.path, filePath);
        console.log(`[HYDRA-SHIELD] 🛡️ Auditing change in ${headId}: ${filePath}`);

        try {
            // Run the audit command inside the worktree
            const { stdout, stderr } = await exec(`${command} "${fullPath}"`, { 
                cwd: head.path,
                timeout: 10000 
            });
            console.log(`[HYDRA-SHIELD] ✅ Audit passed for ${headId}/${filePath}`);
            return { success: true, stdout };
        } catch (err) {
            console.warn(`[HYDRA-SHIELD] ❌ Audit failed for ${headId}/${filePath}:`, err.stderr || err.message);
            return { success: false, error: err.stderr || err.message };
        }
    }

    /**
     * Project Ares: Promote verified code from a Worktree to Production (Main Tree).
     * This can be done via file copy or git merge. We'll start with surgical copy.
     */
    async commitChange(headId, filePath) {
        const head = this.heads.get(headId);
        if (!head) throw new Error(`Head ${headId} not found`);

        const src = path.join(head.path, filePath);
        const dst = path.join(this.basePath, filePath);

        try {
            // Surgical promotion: Copy the verified file back to the main tree
            await fs.mkdir(path.dirname(dst), { recursive: true });
            await fs.copyFile(src, dst);
            console.log(`[HYDRA-PRIME] 🔱 Transaction Complete: Promoted ${filePath} from ${headId} to Production.`);
            return { success: true };
        } catch (err) {
            console.error(`[HYDRA-PRIME] ❌ Promotion Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Project Overkill: Autonomous Swarm Optimization (Hephaestus Loop)
     * Now upgraded to use parallel worktrees.
     */
    async autoOptimize() {
        console.log('\n[HYDRA-PRIME] ⚙️ Initiating Hephaestus Loop: Autonomous Self-Optimization...');
        
        try {
            // 1. Scout identifies a bottleneck
            console.log('[HYDRA-SCOUT] 🔭 Scanning architecture for targets...');
            const scanResult = await this.max.brain.think(
                "You are HYDRA-SCOUT. Identify one specific, isolated piece of technical debt or performance bottleneck in the MAX codebase that can be refactored safely. Output ONLY the file path and a 1-sentence reason.",
                { tier: 'fast', maxTokens: 200 }
            );

            const targetMatch = scanResult.text?.match(/([a-zA-Z0-9_\-\/]+\.[a-z]+)/);
            const target = targetMatch ? targetMatch[1] : null;

            if (!target) {
                console.log('[HYDRA-PRIME] ⏸️ No clear target identified. Swarm standing down.');
                return { success: false, reason: 'No target found' };
            }

            console.log(`[HYDRA-SCOUT] 🎯 Target Acquired: ${target}`);

            // 2. Spawn a Grinder Head to work on this specific file
            const headId = await this.spawnHead('grinder', { target });
            
            // 3. Queue the goal for the Engine
            const goalId = this.max.goals.addGoal({
                title: `[Hephaestus] Optimize ${target}`,
                description: `Autonomous Swarm Refactor.\nTarget: ${target}\nHead: ${headId}\nVerification required in worktree before promotion.`,
                type: 'improvement',
                priority: 0.9,
                source: 'hydra_swarm'
            });

            console.log(`[HYDRA-PRIME] 🔱 Swarm engaged. Goal ID: ${goalId}. Head: ${headId}`);
            return { success: true, headId, goalId };

        } catch (err) {
            console.error('[HYDRA-PRIME] ❌ Optimization loop failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    getStatus() {
        return {
            headCount:  this.heads.size,
            heads:      Array.from(this.heads.values()).map(h => ({ 
                id: h.id, 
                role: h.role, 
                status: h.status,
                path: h.path,
                age: Math.round((Date.now() - h.createdAt) / 1000) + 's'
            }))
        };
    }
}
