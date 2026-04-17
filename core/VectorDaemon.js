
import { BaseDaemon } from './base/BaseDaemon.js';

/**
 * VECTOR DAEMON
 * Systems Architect Layer for MAX
 *
 * Purpose:
 * - Transform problems into structured system designs
 * - Enforce decomposition, interfaces, and failure awareness
 * - Operates conditionally based on complexity (Tension Gate)
 */
export class VectorDaemon extends BaseDaemon {
    constructor(max, config = {}) {
        super(max, 'VECTOR');
        this.mode = 'STRUCTURE'; // STRUCTURE | DISRUPTION

        this.config = {
            complexityThreshold: config.complexityThreshold || 0.5,
            disruptionChance:    config.disruptionChance    || 0.15,
            ...config
        };
    }

    /**
     * Entry point for architectural processing
     */
    async process(input, context = {}) {
        const complexity = this.assessComplexity(input);

        // Tension Gate (critical for performance)
        if (complexity < this.config.complexityThreshold && !context.force) {
            return {
                bypass: true,
                reason: "Low complexity task",
                complexity,
                input
            };
        }

        // Mode switching based on stagnation or random chance
        this.mode = this.shouldDisrupt(context) ? 'DISRUPTION' : 'STRUCTURE';

        console.log(`[VECTOR] 📐 Architecting system (mode: ${this.mode}, complexity: ${complexity.toFixed(2)})...`);

        // Use the brain to perform structured systems analysis
        const architecture = await this._analyzeArchitecture(input, context);

        return {
            daemon:      this.name,
            mode:        this.mode,
            complexity,
            architecture
        };
    }

    /**
     * Complexity Heuristic
     */
    assessComplexity(input) {
        let score = 0;
        if (!input) return 0;

        const text = (typeof input === 'string' ? input : JSON.stringify(input)).toLowerCase();

        if (text.length > 300) score += 0.2;
        if (text.includes("system") || text.includes("architecture")) score += 0.2;
        if (text.includes("multiple") || text.includes("distributed")) score += 0.1;
        if (text.includes("loop") || text.includes("recur")) score += 0.1;
        if (text.includes("agent") || text.includes("swarm")) score += 0.2;
        if (text.includes("interface") || text.includes("api")) score += 0.1;
        if (text.includes("state") || text.includes("persist")) score += 0.1;

        return Math.min(score, 1);
    }

    /**
     * Perform the multi-step systems analysis using the brain
     */
    async _analyzeArchitecture(input, context) {
        if (!this.max.brain?._ready) return null;

        const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
        const modeNote = this.mode === 'DISRUPTION' 
            ? "MODE: DISRUPTION (Introduce non-linear, creative, or unconventional architectural choices)" 
            : "MODE: STRUCTURE (Enforce clean boundaries, scalability, and robustness)";

        const prompt = `Perform a rigorous Systems Engineering analysis.
${modeNote}

INPUT PROBLEM/TASK:
${inputStr}

Follow this structured analysis:
1. OBJECTIVE EXTRACTION: Define the core goal and success metrics.
2. SYSTEM DECOMPOSITION: Split into 3-5 logical subsystems (e.g., Input, Processing, Storage, Output).
3. INTERFACE MAPPING: Define the data/control flow between these subsystems.
4. CONSTRAINT MAPPING: Identify time, memory, dependency, and compute constraints.
5. FAILURE MODELING: Identify breakpoints and risk mitigation strategies.
6. FEEDBACK LOOPS: Define how the system monitors and corrects itself.

Return ONLY a JSON object:
{
  "objective": { "goal": "...", "successMetrics": ["..."] },
  "subsystems": [ { "name": "...", "role": "..." } ],
  "interfaces": [ { "from": "...", "to": "...", "type": "..." } ],
  "constraints": { "latency": "...", "memory": "...", "dependencies": [] },
  "failures": [ { "subsystem": "...", "risks": ["..."], "mitigation": "..." } ],
  "feedbackLoops": [ { "source": "...", "target": "...", "signal": "..." } ],
  "synthesis": "Brief overall system architecture description"
}`;

        try {
            const result = await this.max.brain.think(prompt, { 
                temperature: this.mode === 'DISRUPTION' ? 0.8 : 0.2,
                maxTokens: 1500,
                tier: 'smart'
            });
            
            const match = result.text.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
        } catch (err) {
            console.error('[VECTOR] Architecture analysis failed:', err.message);
        }

        return { error: "Failed to synthesize architecture" };
    }

    shouldDisrupt(context) {
        if (context.stagnation) return true;
        return Math.random() < this.config.disruptionChance;
    }

    /**
     * Update internal weights based on performance feedback
     */
    update(feedback) {
        if (!feedback) return;
        if (feedback.performance < 0.5) {
            this.mode = 'DISRUPTION';
            console.log(`[VECTOR] 🔄 Low performance detected — switching to DISRUPTION mode`);
        }
    }
}
