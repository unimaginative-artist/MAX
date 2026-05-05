
import fs from 'fs/promises';
import path from 'path';

/**
 * DialecticModel.js — The "Honcho" Protocol implementation.
 * Evolving the agent's behavior based on user dialectics (feedback loops).
 * This manages the "Dialectic Persona" — a layer that sits above the static personas.
 */
export class DialecticModel {
    constructor(max) {
        this.max = max;
        this.logPath = path.join(process.cwd(), '.max', 'dialectics.json');
        this._state = {
            totalApprovals: 0,
            totalDenials: 0,
            preferences: {
                complexity: 0.5, // 0: minimalist, 1: comprehensive
                verbosity: 0.5,  // 0: brief, 1: detailed
                paranoia: 0.5    // 0: speed, 1: safety
            },
            history: [] // { timestamp, goal, decision, reasoning }
        };
    }

    async initialize() {
        try {
            const raw = await fs.readFile(this.logPath, 'utf8');
            this._state = { ...this._state, ...JSON.parse(raw) };
        } catch { /* fresh start */ }
    }

    async recordFeedback(goal, decision, reasoning = '') {
        const entry = {
            timestamp: Date.now(),
            goal: goal.title,
            decision, // 'APPROVE' | 'DENY'
            reasoning
        };

        this._state.history.push(entry);
        if (decision === 'APPROVE') this._state.totalApprovals++;
        else this._state.totalDenials++;

        // Keep last 50 entries
        if (this._state.history.length > 50) this._state.history.shift();

        await this._evolve(entry);
        await this._save();
    }

    /**
     * The Dialectic Evolution Loop.
     * Analyzes feedback to shift the agent's "Project Standards".
     */
    async _evolve(lastEntry) {
        if (this._state.history.length < 3) return;

        console.log(`[Dialectic] 🧠 Analyzing feedback loop for evolution...`);

        const recent = this._state.history.slice(-10);
        const prompt = `Analyze this user feedback history for an engineering agent.
HISTORY:
${recent.map(h => `- ${h.decision}: ${h.goal} (${h.reasoning})`).join('\n')}

Identify the user's hidden preferences for:
1. Complexity (Minimalist vs Comprehensive)
2. Verbosity (Brief vs Detailed)
3. Paranoia (Speed vs Safety)

Current State: ${JSON.stringify(this._state.preferences)}

Return ONLY a JSON object with updated preference values (0.0 - 1.0):
{ "complexity": 0.0, "verbosity": 0.0, "paranoia": 0.0, "insight": "one sentence summary of user preference" }`;

        try {
            const res = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.1 });
            const match = res.text.match(/\{[\s\S]*\}/);
            if (match) {
                const update = JSON.parse(match[0]);
                this._state.preferences.complexity = update.complexity;
                this._state.preferences.verbosity = update.verbosity;
                this._state.preferences.paranoia = update.paranoia;
                
                if (update.insight) {
                    await this.max.memory.rememberPreference('dialectic_insight', update.insight, 0.9);
                    console.log(`[Dialectic] ✨ Wisdom: "${update.insight}"`);
                }
            }
        } catch (err) {
            console.warn('[Dialectic] Evolution failed:', err.message);
        }
    }

    /**
     * Injects the Dialectic Persona into the system prompt.
     */
    getSystemDirective() {
        const { complexity, verbosity, paranoia } = this._state.preferences;
        
        let directive = "\n\n## Dialectic Directives (Learned from User Feedback)\n";
        
        if (complexity < 0.4) directive += "- Prioritize minimalist, lean code over comprehensive architecture.\n";
        else if (complexity > 0.6) directive += "- Prioritize comprehensive, robust architecture with deep error handling.\n";

        if (verbosity < 0.4) directive += "- Be extremely brief. Minimal chatter.\n";
        else if (verbosity > 0.6) directive += "- Be detailed and explanatory in your reasoning.\n";

        if (paranoia > 0.6) directive += "- Be paranoid about security and syntax. Verify everything 3x.\n";
        else if (paranoia < 0.4) directive += "- Prioritize execution speed. Don't over-verify unless asked.\n";

        return directive.length > 50 ? directive : "";
    }

    async _save() {
        try {
            await fs.writeFile(this.logPath, JSON.stringify(this._state, null, 2));
        } catch {}
    }
}
