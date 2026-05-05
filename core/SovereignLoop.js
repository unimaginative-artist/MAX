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
        // Run first cycle after 15 minutes to avoid startup contention, then every 20 minutes.
        // Previous 60s interval was calling smart-tier LLM every minute competing with chat.
        setTimeout(() => this._cycle(), 15 * 60 * 1000);
        console.log('🔱 [Sovereign] Instinct Loop active — first pulse in 15m.');
    }

    async _cycle() {
        if (!this.isRunning) return;

        // Guard: don't run while user is actively chatting
        if (this.max._chatBusy) {
            setTimeout(() => this._cycle(), 5 * 60 * 1000);
            return;
        }

        try {
            const auditFinds = await this.max.kb.query(
                'What are MAX\'s architectural gaps and missing capabilities?', { topK: 5 }
            );

            if (auditFinds.length > 0) {
                const resolution = await this.max.brain.think(
                    `You are MAX's self-improvement instinct. Identified gaps:\n${auditFinds.map(f => f.content).join('\n')}\n\nIdentify ONE critical missing capability to build next.\n\nOutput ONLY JSON:\n{ "title": "AUTONOMOUS: [Component Name]", "description": "What to build and why", "priority": 0.7, "source": "sovereign_instinct" }`,
                    { tier: 'fast', maxTokens: 200 }
                );

                const goalMatch = resolution.text.match(/\{[\s\S]*?\}/);
                if (goalMatch) {
                    const sovereignGoal = JSON.parse(goalMatch[0]);
                    if (sovereignGoal.title) {
                        const goalId = this.max.goals.addGoal({
                            ...sovereignGoal,
                            priority: Math.min(sovereignGoal.priority || 0.7, 0.8) // cap priority — don't override user goals
                        });
                        console.log(`[Sovereign] ⚡ Self-improvement goal queued: "${sovereignGoal.title}"`);
                    }
                }
            }
        } catch (err) {
            console.error('[Sovereign] Cycle error:', err.message);
        }

        setTimeout(() => this._cycle(), 20 * 60 * 1000); // 20-minute cadence
    }

    stop() {
        this.isRunning = false;
    }
}
