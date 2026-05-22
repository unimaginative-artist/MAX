import { EventEmitter } from 'events';

/**
 * GroundingArbiter.js — The "Truth-Seeker" for MAX.
 * 
 * Intercepts low-confidence or uncertain responses and launches 
 * an autonomous research swarm to verify facts.
 */
export class GroundingArbiter extends EventEmitter {
    constructor(max) {
        super();
        this.max = max;
        this.isGrounding = false;
        this.stats = {
            totalLoops: 0,
            resolved: 0,
            failed: 0
        };
    }

    /**
     * Attempts to ground an uncertain response.
     * @param {string} originalResponse - The text with | UNCERTAIN prefix
     * @param {object} verificationTask - { tool, action, params }
     */
    async ground(originalResponse, verificationTask = null) {
        if (this.isGrounding) return null;
        this.isGrounding = true;
        this.stats.totalLoops++;

        console.log(`[Grounding] ⚖️  Uncertainty detected. Launching Grounding Loop...`);
        this.emit('grounding_update', { status: 'starting', originalResponse });

        try {
            let groundingEvidence = '';

            // ── Step 1: Local Grounding (File system / Process check) ─────────
            if (verificationTask) {
                this.emit('grounding_update', { status: 'verifying_local', task: verificationTask });
                console.log(`[Grounding] 🔎 Running local verification: ${verificationTask.tool}.${verificationTask.action}`);
                try {
                    const res = await this.max.tools.execute(verificationTask.tool, verificationTask.action, verificationTask.params);
                    groundingEvidence += `\nLOCAL VERIFICATION (${verificationTask.tool}.${verificationTask.action}):\n${JSON.stringify(res)}\n`;
                    this.emit('grounding_update', { status: 'local_verified', result: res });
                } catch (err) {
                    console.warn(`[Grounding] Local verification failed: ${err.message}`);
                }
            }

            // ── Step 2: Global Grounding (Web Research Swarm) ────────────────
            // Extract the core "question" from the uncertain response
            const questionPrompt = `Extract the core factual question or ambiguity from this uncertain response that needs verification.
RESPONSE:
"${originalResponse}"

Output ONLY the search query.`;
            
            const queryRes = await this.max.brain.think(questionPrompt, { tier: 'fast', temperature: 0.1 });
            const query = queryRes.text.trim().replace(/"/g, '');

            if (query.length > 5) {
                this.emit('grounding_update', { status: 'researching', query });
                console.log(`[Grounding] 🌐 Launching Research Swarm for: "${query}"`);
                const researchResult = await this.max.research.quick(query);
                if (researchResult.success) {
                    groundingEvidence += `\nGLOBAL RESEARCH FINDINGS:\n${researchResult.synthesis}\n`;
                    this.emit('grounding_update', { status: 'research_complete', findings: researchResult.synthesis });
                }
            }

            // ── Step 3: Synthesis ( BELIEF REVISION ) ────────────────────────
            this.emit('grounding_update', { status: 'revising' });
            console.log(`[Grounding] 🧠 Revising belief based on evidence...`);
            const revisionPrompt = `You are performing a BELIEF REVISION for MAX.
ORIGINAL (UNCERTAIN) RESPONSE:
"${originalResponse}"

GATHERED EVIDENCE:
${groundingEvidence}

Instruction:
1. Compare the evidence to the original claims.
2. If the evidence confirms the claims, rewrite the response with a / TRUE prefix.
3. If the evidence contradicts the claims, rewrite the response to be correct with a / TRUE prefix.
4. If still unsure, keep the | UNCERTAIN prefix and explain the ambiguity.

Write the REVISED response now:`;

            const finalRes = await this.max.brain.think(revisionPrompt, { tier: 'smart', temperature: 0.2 });
            
            this.stats.resolved++;
            this.emit('grounding_update', { status: 'done', revisedResponse: finalRes.text });
            return finalRes.text;

        } catch (err) {
            console.error('[Grounding] ❌ Grounding Loop failed:', err.message);
            this.stats.failed++;
            this.emit('grounding_update', { status: 'failed', error: err.message });
            return null;
        } finally {
            this.isGrounding = false;
        }
    }

    getStatus() {
        return { ...this.stats, active: this.isGrounding };
    }
}
