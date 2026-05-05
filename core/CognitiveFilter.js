
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
     * Only triggers for specific, high-confidence claims — not casual mentions.
     */
    _identifyVerificationTask(text) {
        const t = text.toLowerCase();

        // Only verify concrete file existence claims with a specific path
        const fileExistsClaim = /(?:file|path)\s+['"]?([\w./\\-]+\.\w+)['"]?\s+(?:exists|is present|contains)/i;
        const fileMatch = text.match(fileExistsClaim);
        if (fileMatch) return { tool: 'file', action: 'list', params: { path: fileMatch[1] } };

        // Only verify process claims if we're explicitly asserting it's currently running
        if (/(?:process|server|service)\s+is\s+(?:running|active|started)/i.test(text)) {
            return { tool: 'shell', action: 'run', params: { command: 'tasklist' } };
        }

        // Removed: "error"/"bug" trigger — caused npm test to run on every casual mention
        return null;
    }

    /**
     * Log an uncertainty event for Kaizen improvement.
     * Called when a claim is tagged as | UNCERTAIN.
     */
    logUncertainty(text, task) {
        if (!this.max.outcomes) return;

        const topic = task?.params?.path || task?.params?.command || 'conceptual';
        
        this.max.outcomes.record({
            agent:   'CognitiveFilter',
            action:  'uncertainty_event',
            context: { text: text.slice(0, 100), topic },
            result:  'Uncertainty identified | resolving via Grounding Loop',
            success: true,
            metadata: { type: task?.tool || 'thought', topic }
        });

        // Surface to ReflectionEngine if available
        if (this.max.reflection) {
            this.max.reflection._notePattern(`Recurring Uncertainty: ${topic}`, `MAX was unsure about this topic; triggering Grounding Loop.`);
        }
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
