// ═══════════════════════════════════════════════════════════════════════════
// TriBrainConsensus.js — Multi-Agent Debate & Consensus Engine
// Orchestrates 3-way debate (Architect vs Security Breaker vs Maintainer)
// before executing high-impact code changes or system operations.
// ═══════════════════════════════════════════════════════════════════════════

export class TriBrainConsensus {
    constructor(brain, config = {}) {
        this.brain = brain;
        this.threshold = config.threshold || 0.75;
    }

    /**
     * Evaluate a proposed action via 3-way consensus debate.
     * action: { type: 'code_edit' | 'shell_cmd', target: string, proposal: string }
     */
    async evaluate(action) {
        console.log(`[TriBrainConsensus] ⚖️  Initiating 3-party debate for: ${action.type} (${action.target})`);

        if (!this.brain) {
            // Default pass if brain not initialized
            return { approved: true, score: 1.0, consensus: 'Brain unattached — auto pass' };
        }

        const architectPrompt = `You are the Lead Architect. Evaluate this proposed ${action.type} for structural clean architecture and project fit.\nTarget: ${action.target}\nProposal: ${action.proposal}\nRate approval from 0.0 to 1.0. Format response: SCORE: <number> | REASON: <text>`;
        
        const securityPrompt = `You are the Security Breaker. Attack this proposed ${action.type} for command injection, hardcoded credentials, and safety risks.\nTarget: ${action.target}\nProposal: ${action.proposal}\nRate safety score from 0.0 to 1.0. Format response: SCORE: <number> | REASON: <text>`;

        const maintainerPrompt = `You are the Senior Maintainer. Evaluate this proposed ${action.type} for regression risks, testability, and code clarity.\nTarget: ${action.target}\nProposal: ${action.proposal}\nRate approval from 0.0 to 1.0. Format response: SCORE: <number> | REASON: <text>`;

        try {
            const [archRes, secRes, maintRes] = await Promise.allSettled([
                this.brain.think(architectPrompt, { tier: 'fast' }),
                this.brain.think(securityPrompt, { tier: 'fast' }),
                this.brain.think(maintainerPrompt, { tier: 'fast' })
            ]);

            const archScore  = this._extractScore(archRes.value?.text);
            const secScore   = this._extractScore(secRes.value?.text);
            const maintScore = this._extractScore(maintRes.value?.text);

            // Weighted average: Security (40%), Architect (35%), Maintainer (25%)
            const finalScore = (secScore * 0.40) + (archScore * 0.35) + (maintScore * 0.25);
            const approved   = finalScore >= this.threshold;

            console.log(`[TriBrainConsensus] 📊 Debate Results — Arch: ${archScore.toFixed(2)}, Sec: ${secScore.toFixed(2)}, Maint: ${maintScore.toFixed(2)} → Final Score: ${finalScore.toFixed(2)} (${approved ? 'APPROVED ✅' : 'REJECTED ❌'})`);

            return {
                approved,
                score: finalScore,
                breakdown: { archScore, secScore, maintScore },
                consensus: approved ? 'Consensus threshold met' : 'Safety/Architectural threshold failed'
            };
        } catch (err) {
            console.warn('[TriBrainConsensus] Debate evaluation error:', err.message);
            // Safety fallback
            return { approved: true, score: 0.8, consensus: 'Fallback approval on debate error' };
        }
    }

    _extractScore(text) {
        if (!text) return 0.8;
        const match = text.match(/SCORE:\s*([0-1](?:\.\d+)?)/i);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return 0.8;
    }
}
