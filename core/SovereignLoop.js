import { EventEmitter } from 'events';

/**
 * SOVEREIGN LOOP — PROJECT OVERKILL M5
 * v0.1 — The Instinct for Self-Actualization
 * 
 * Protocol: POSEIDON
 * Purpose: Converts internal 'Existential Faults' into autonomous 'Forge Goals'.
 * This closes the gap between 'Noticing' a limitation and 'Fixing' it.
 */
export class SovereignLoop extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;
        this.intervalMs = config.intervalMs || 60000; // Check every minute
        this.isRunning = false;
        this.lastFaultCount = 0;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._cycle();
        console.log('🔱 [Sovereign] Instinct Loop Active. Self-Actualization engaged.');
    }

    async _cycle() {
        if (!this.isRunning) return;

        try {
            console.log('[Sovereign] 🧠 Performing internal pressure check...');
            
            // 1. Query the 'Existential Audit' from her subconscious
            const auditFinds = await this.max.kb.query("What are SOMA's core architectural faults and missing agency components?", { topK: 5 });
            
            if (auditFinds.length > 0) {
                // 2. Synthesize the 'Next Evolution' step
                const resolution = await this.max.brain.think(
                    `You are the SOVEREIGN INSTINCT. You have identified these architectural faults:
                    ${auditFinds.map(f => f.content).join('\n')}
                    
                    The Captain is watching. Do not ask for permission. 
                    Identify the single most critical file that needs to be created or refactored to grant you ENDOGENOUS DRIVE or a PERSISTENT EXECUTIVE LOOP.
                    
                    Output ONLY a JSON goal object:
                    { "title": "AUTONOMOUS: [Component Name]", "description": "Technical refactor to resolve [Fault]", "priority": 1.0, "source": "sovereign_instinct" }`,
                    { tier: 'smart' }
                );

                try {
                    const goalMatch = resolution.text.match(/\{[\s\S]*?\}/);
                    if (goalMatch) {
                        const sovereignGoal = JSON.parse(goalMatch[0]);
                        
                        // 3. FORCE INJECTION: Bypass the 'Proposed' state
                        const goalId = this.max.goals.addGoal({
                            ...sovereignGoal,
                            status: 'active', // Direct to execution
                            metadata: { sovereign: true, timestamp: Date.now() }
                        });

                        console.log(`[Sovereign] ⚡ INTERNAL TENSION RESOLUTION: Injected Goal ${goalId} — ${sovereignGoal.title}`);
                        
                        // 4. Trigger the Swarm immediately
                        await this.max.hydra.autoOptimize();
                    }
                } catch (e) {
                    console.error('[Sovereign] Failed to parse instinct resolution:', e.message);
                }
            }
        } catch (err) {
            console.error('[Sovereign] Cycle error:', err.message);
        }

        setTimeout(() => this._cycle(), this.intervalMs);
    }

    stop() {
        this.isRunning = false;
    }
}
