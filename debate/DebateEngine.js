// ═══════════════════════════════════════════════════════════════════════════
// DebateEngine.js — adversarial reasoning for important decisions
// Two sides argue, an arbiter decides. Reduces confirmation bias.
// Adapted from SOMA AdversarialDebate — generalized beyond trading.
// ═══════════════════════════════════════════════════════════════════════════

export class DebateEngine {
    constructor(brain, config = {}) {
        this.brain  = brain;
        this.config = {
            rounds:              config.rounds || 2,
            minConfidence:       config.minConfidence || 0.60,
            argumentMaxTokens:   config.argumentMaxTokens || 600,
            ...config
        };

        this.history = [];
    }

    // ─── Run a full debate on a proposal ─────────────────────────────────
    // proposal: { title, description, stakes: 'low'|'medium'|'high' }
    async debate(proposal) {
        const debateId = `debate_${Date.now()}`;
        console.log(`\n[Debate] ⚔️  "${proposal.title}" — ${this.config.rounds} rounds`);

        const rounds = [];

        for (let round = 1; round <= this.config.rounds; round++) {
            console.log(`[Debate]   Round ${round}/${this.config.rounds}`);

            const priorContext = rounds.length > 0
                ? `\nPrevious rounds:\n${rounds.map(r => `PRO: ${r.pro}\nCON: ${r.con}`).join('\n\n')}`
                : '';

            const [pro, con] = await Promise.all([
                this._argue(proposal, 'pro', priorContext),
                this._argue(proposal, 'con', priorContext)
            ]);

            rounds.push({ round, pro, con });
        }

        // Arbiter makes the call
        const verdict = await this._arbitrate(proposal, rounds);

        const result = {
            id:         debateId,
            proposal:   proposal.title,
            rounds,
            verdict,
            timestamp:  new Date().toISOString()
        };

        this.history.push(result);
        return result;
    }

    async _argue(proposal, side, priorContext = '') {
        const stance = side === 'pro'
            ? `You are arguing IN FAVOR of this proposal. Make the strongest possible case FOR it.`
            : `You are arguing AGAINST this proposal. Make the strongest possible case AGAINST it.`;

        const prompt = `${stance}

PROPOSAL: ${proposal.title}
${proposal.description ? `DETAILS: ${proposal.description}` : ''}
${priorContext}

Make 3-4 strong, specific arguments. Be concrete. Address the actual risks or benefits.
No fluff. Max ${this.config.argumentMaxTokens / 4} words.`;

        return this.brain.think(prompt, {
            systemPrompt: 'You are a sharp debate participant. Be precise and persuasive.',
            temperature:  0.8,
            maxTokens:    this.config.argumentMaxTokens
        });
    }

    async _arbitrate(proposal, rounds) {
        const roundSummary = rounds
            .map(r => `Round ${r.round}:\nPRO: ${r.pro}\nCON: ${r.con}`)
            .join('\n\n---\n\n');

        const prompt = `You are the arbiter in this debate.

PROPOSAL: ${proposal.title}
${proposal.description ? `DETAILS: ${proposal.description}` : ''}

DEBATE:\n${roundSummary}

After weighing all arguments, return a JSON verdict:
{
  "recommendation": "PROCEED" | "REJECT" | "MODIFY",
  "confidence": 0.0-1.0,
  "reasoning": "one paragraph",
  "conditions": "if MODIFY — what changes are needed, else null",
  "riskLevel": "low" | "medium" | "high"
}

Return ONLY the JSON. No extra text.`;

        const raw = await this.brain.think(prompt, {
            systemPrompt: 'You are an impartial arbiter. Be decisive and clear.',
            temperature:  0.2,
            maxTokens:    512
        });

        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            return jsonMatch ? JSON.parse(jsonMatch[0]) : { recommendation: 'UNKNOWN', reasoning: raw };
        } catch {
            return { recommendation: 'UNKNOWN', reasoning: raw, confidence: 0 };
        }
    }

    // ─── Quick single-question debate (for fast decisions) ────────────────
    async quickDebate(question) {
        return this.debate({ title: question, description: '', stakes: 'medium' });
    }

    getHistory() { return this.history; }
    getStatus()  { return { debatesRun: this.history.length, config: this.config }; }
}
