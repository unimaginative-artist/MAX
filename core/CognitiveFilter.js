
/**
 * CognitiveFilter — The "Barry Protocol" implementation.
 * Sits between the LLM and the terminal to enforce ternary belief states.
 * States: / TRUE | \ FALSE | | UNCERTAIN
 */
export class CognitiveFilter {
    constructor(max, config = {}) {
        this.max = max;
        this.config = {
            verificationThreshold: config.verificationThreshold || 0.75,
            ...config
        };
    }

    /**
     * Process a raw LLM response through the ternary logic.
     * Returns { response, state, needsVerification, verificationTask }
     */
    async process(text, context = {}) {
        const confidence = this._estimateConfidence(text, context);
        let state = 'UNCERTAIN';
        let prefix = '|';

        if (confidence >= this.config.verificationThreshold) {
            state = 'TRUE';
            prefix = '/';
        } else if (confidence < 0.3) {
            state = 'FALSE';
            prefix = '\\';
        }

        // Detect if the response makes a claim that needs real-world grounding
        const verificationTask = this._identifyVerificationTask(text);
        const needsVerification = state === 'UNCERTAIN' && !!verificationTask;

        return {
            originalText: text,
            filteredText: `${prefix} ${text}`,
            state,
            confidence,
            needsVerification,
            verificationTask
        };
    }

    /**
     * Estimate confidence using the WorldModel and linguistic cues.
     */
    _estimateConfidence(text, context) {
        let score = 0.6; // Baseline

        // Grounding with WorldModel if available
        if (this.max.world) {
            const accuracy = this.max.world.getCurrentAccuracy() / 100;
            score = (score * 0.4) + (accuracy * 0.6);
        }

        // Linguistic hedge detection
        const hedges = ['maybe', 'perhaps', 'likely', 'believe', 'might', 'possibly', 'unsure', 'not certain'];
        const lowConfidenceCount = hedges.filter(h => text.toLowerCase().includes(h)).length;
        score -= (lowConfidenceCount * 0.1);

        // Verification cues
        if (text.includes('Verified') || text.includes('Confirmed')) score += 0.15;
        if (text.includes('TOOL:')) score += 0.1;

        return Math.min(0.95, Math.max(0.1, score));
    }

    /**
     * Extract a potential tool call to verify an uncertain claim.
     */
    _identifyVerificationTask(text) {
        const t = text.toLowerCase();
        
        // Pattern match for common claims that need verification
        if (t.includes('file') && (t.includes('exists') || t.includes('contains'))) {
            const match = text.match(/file\s+['"]?([\w./\\]+)['"]?/i);
            if (match) return { tool: 'file', action: 'list', params: { path: match[1] } };
        }
        
        if (t.includes('process') && (t.includes('running') || t.includes('started'))) {
            return { tool: 'shell', action: 'run', params: { command: 'tasklist' } };
        }

        if (t.includes('error') || t.includes('bug')) {
            return { tool: 'shell', action: 'run', params: { command: 'npm test' } };
        }

        return null;
    }

    /**
     * Tag a fact with its provenance.
     */
    getProvenance(state, source = 'brain') {
        if (source === 'user') return 'STATED';
        if (state === 'TRUE') return 'VERIFIED';
        return 'HYPOTHESIZED';
    }
}
