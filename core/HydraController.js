
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/**
 * HYDRA CONTROLLER
 * v0.2 — Transactional Swarm Orchestrator
 * 
 * Protocol: POSEIDON
 * Capability: Project Ares (Autonomous Verification)
 */
export class HydraController {
    constructor(max) {
        this.max = max;
        this.heads = new Map();
        this.forgePath = 'C:\\Users\\barry\\Desktop\\SOMA\\.hydra_forge';
        this.prodPath  = 'C:\\Users\\barry\\Desktop\\SOMA';
    }

    async spawnHead(role = 'grinder', config = {}) {
        const headId = `hydra-${role}-${Math.random().toString(36).substr(2, 5)}`;
        console.log(`[HYDRA] 🐉 Spawning head: ${headId} (Role: ${role})...`);

        const head = { id: headId, role, status: 'online', config };
        this.heads.set(headId, head);
        return headId;
    }

    /**
     * Project Ares: Verify a proposed change in the sandbox
     */
    async auditChange(filePath, command = 'node --check') {
        const fullForgePath = path.join(this.forgePath, filePath);
        console.log(`[HYDRA-SHIELD] 🛡️ Auditing change: ${filePath}`);

        return new Promise((resolve) => {
            // Hard 5s timeout for safety
            const child = exec(`${command} "${fullForgePath}"`, { timeout: 5000 }, (err, stdout, stderr) => {
                if (err) {
                    console.warn(`[HYDRA-SHIELD] ❌ Audit failed for ${filePath}:`, stderr || err.message);
                    resolve({ success: false, error: stderr || err.message });
                } else {
                    console.log(`[HYDRA-SHIELD] ✅ Audit passed: ${filePath}`);
                    resolve({ success: true });
                }
            });
        });
    }

    /**
     * Project Ares: Move verified code from Forge to Production
     */
    async commitChange(filePath) {
        const src = path.join(this.forgePath, filePath);
        const dst = path.join(this.prodPath, filePath);

        try {
            await fs.mkdir(path.dirname(dst), { recursive: true });
            await fs.copyFile(src, dst);
            console.log(`[HYDRA-PRIME] 🔱 Transaction Complete: Committed ${filePath} to Production.`);
            return { success: true };
        } catch (err) {
            console.error(`[HYDRA-PRIME] ❌ Transaction Failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Project Overkill: Autonomous Swarm Optimization (Hephaestus Loop)
     */
    async autoOptimize() {
        console.log('\n[HYDRA-PRIME] ⚙️ Initiating Hephaestus Loop: Autonomous Self-Optimization...');
        
        // Ensure heads exist
        if (this.heads.size < 3) {
            await this.spawnHead('scout');
            await this.spawnHead('grinder');
            await this.spawnHead('shield');
        }

        try {
            // 1. Scout identifies a bottleneck
            console.log('[HYDRA-SCOUT] 🔭 Scanning SOMA architecture for optimization targets...');
            const scanResult = await this.max.brain.think(
                "You are HYDRA-SCOUT. Identify one specific, isolated piece of technical debt or performance bottleneck in SOMA's architecture that can be refactored safely. Output ONLY the file path and a 1-sentence reason.",
                { tier: 'smart', maxTokens: 200 }
            );

            const target = scanResult.text || "Unknown";
            console.log(`[HYDRA-SCOUT] 🎯 Target Acquired: ${target.replace(/\n/g, ' ')}`);

            // 2. Queue the goal for Grinder & Shield
            if (target && !target.includes("Unknown")) {
                const goalId = this.max.goals.addGoal({
                    title: `[Hephaestus] Optimize ${target.substring(0, 30)}...`,
                    description: `Autonomous Swarm Refactor.\nTarget: ${target}\nUse .hydra_forge for drafting. Hydra-Shield MUST verify before commit.`,
                    type: 'improvement',
                    priority: 0.9,
                    source: 'hydra_swarm'
                });
                console.log(`[HYDRA-PRIME] 🔱 Goal Injected to Engine (ID: ${goalId}). The Swarm is grinding.`);
                return { success: true, target };
            }
            return { success: false, reason: 'No clear target identified' };

        } catch (err) {
            console.error('[HYDRA-PRIME] ❌ Optimization loop failed:', err.message);
            return { success: false, error: err.message };
        }
    }

    _getPersonaForRole(role) {
        const personas = {
            scout:   "You are the HYDRA-SCOUT. Focus on discovery and mapping technical requirements.",
            grinder: "You are the HYDRA-GRINDER. Write code to the .hydra_forge sandbox for testing.",
            shield:  "You are the HYDRA-SHIELD. Audit code in .hydra_forge. If /TRUE, signal Hydra-Prime to commit."
        };
        return personas[role] || personas.grinder;
    }

    getStatus() {
        return {
            headCount:  this.heads.size,
            heads:      Array.from(this.heads.values()).map(h => ({ id: h.id, role: h.role, status: h.status }))
        };
    }
}
