// ═══════════════════════════════════════════════════════════════════════════
// ReasoningChamber.js — multi-strategy reasoning engine
// Detects what KIND of problem this is, picks the right thinking approach,
// then runs a tailored brain prompt for that strategy.
// Ported from SOMA ReasoningChamber.js — wired to Brain instead of SOMA stack
// ═══════════════════════════════════════════════════════════════════════════

export class ReasoningChamber {
    constructor(brain, memoryOrConfig = null, outcomes = null, config = {}) {
        this.brain    = brain;
        this.memory   = (typeof memoryOrConfig === 'object' && memoryOrConfig !== null && !memoryOrConfig.topK && !memoryOrConfig.debug) ? memoryOrConfig : null;
        this.outcomes = outcomes;
        this.config   = (typeof memoryOrConfig === 'object' && memoryOrConfig !== null && (memoryOrConfig.topK || memoryOrConfig.debug)) ? memoryOrConfig : config;
        this.stats    = { total: 0, byType: {}, byStrategy: {}, avgConfidence: 0 };
    }

    /**
     * Hierarchical goal decomposition into concrete execution steps
     */
    async decompose(goal, { availableTools = [], skill = null, tier = 'smart' } = {}) {
        const title = typeof goal === 'string' ? goal : (goal.title || goal.description || 'Unknown Goal');
        const desc  = typeof goal === 'object' ? (goal.description || '') : '';
        const toolList = availableTools.length > 0 ? availableTools.join(', ') : 'file, shell, git, web, memory, kb, brain';

        const prompt = `You are MAX's hierarchical planning architect. Decompose this goal into 2 to 5 concrete, actionable sequential steps.

GOAL: "${title}"
${desc ? `DETAILS: "${desc}"` : ''}
${skill ? `RECALLED SKILL: "${skill.name}": ${skill.description}` : ''}
AVAILABLE TOOLS: ${toolList}

Each step must specify:
1. "step": Step number (1, 2, 3...)
2. "action": Specific description of what to do
3. "tool": Which tool to use (from available tools, or 'brain' for pure analysis)
4. "action_name": (optional) sub-action like 'read', 'write', 'search', 'run'
5. "success": What success looks like
6. "dependsOn": Array of prior step numbers

Return ONLY a valid JSON array of step objects:
[
  { "step": 1, "action": "...", "tool": "...", "action_name": "...", "success": "...", "dependsOn": [] },
  { "step": 2, "action": "...", "tool": "...", "action_name": "...", "success": "...", "dependsOn": [1] }
]`;

        try {
            const resObj = await this.brain.think(prompt, {
                systemPrompt: 'You are MAX, an expert software engineer and autonomous planner. Output ONLY valid JSON array.',
                tier,
                temperature: 0.2,
                maxTokens: 1024
            });

            const text = resObj?.text || '';
            const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (match) {
                const steps = JSON.parse(match[0]);
                if (Array.isArray(steps) && steps.length > 0) {
                    return steps.map((s, idx) => ({
                        step: s.step || idx + 1,
                        action: s.action || title,
                        tool: s.tool || 'brain',
                        action_name: s.action_name || 'run',
                        success: s.success || 'completed',
                        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : []
                    }));
                }
            }
        } catch (err) {
            console.warn(`[ReasoningChamber] Decomposition failed: ${err.message}`);
        }

        // Fallback to single-step execution
        return [{
            step: 1,
            action: title,
            tool: 'brain',
            action_name: 'run',
            success: 'completed',
            dependsOn: []
        }];
    }

    // ─── Main entry point ─────────────────────────────────────────────────
    async reason(query, context = {}) {
        this.stats.total++;

        const type     = this._detectType(query);
        const strategy = this._pickStrategy(type);
        
        // Inject world model into context if available
        const resObj   = await this._execute(strategy, query, context);
        const result   = resObj.text;
        const conf     = this._confidence(result, context);

        this.stats.byType[type]         = (this.stats.byType[type]         || 0) + 1;
        this.stats.byStrategy[strategy] = (this.stats.byStrategy[strategy] || 0) + 1;
        const n = this.stats.total;
        this.stats.avgConfidence = ((this.stats.avgConfidence * (n - 1)) + conf) / n;

        return { result, confidence: conf, type, strategy, telemetry: resObj.metadata };
    }

    // ─── Detect reasoning type from query keywords ────────────────────────
    _detectType(query) {
        const q = query.toLowerCase();
        const score = (keywords, weight = 1) =>
            keywords.reduce((s, w) => s + (q.includes(w) ? weight : 0), 0);

        const scores = {
            causal:          score(['why', 'because', 'cause of', 'reason for', 'due to', 'led to'], 2),
            counterfactual:  score(['what if', 'suppose', 'imagine if', 'instead of', 'alternative'], 3),
            comparative:     score(['compare', 'vs', 'versus', 'better than', 'difference between', 'pros and cons'], 2),
            mechanistic:     score(['how does', 'how do', 'explain how', 'mechanism', 'process of'], 2),
            analytical:      score(['solve', 'calculate', 'analyze', 'debug', 'optimize', 'evaluate'], 2),
            generative:      score(['create', 'write', 'build', 'implement', 'design', 'generate', 'code'], 2),
            security:        score(['security', 'vulnerability', 'attack', 'exploit', 'safe', 'threat', 'inject'], 3),
            planning:        score(['plan', 'steps', 'how to', 'approach', 'strategy', 'roadmap', 'task'], 2)
        };

        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return best[1] >= 2 ? best[0] : 'general';
    }

    _pickStrategy(type) {
        return {
            causal:         'causal_chain',
            counterfactual: 'counterfactual_simulation',
            comparative:    'comparative_analysis',
            mechanistic:    'mechanistic_decomposition',
            analytical:     'logical_deduction',
            generative:     'creative_synthesis',
            security:       'security_council',
            planning:       'step_decomposition',
            simulation:     'world_simulation', // 🌍 New: Mental Simulation
            general:        'integrated_reasoning'
        }[type] || 'integrated_reasoning';
    }

    // ─── Execute the chosen reasoning strategy ────────────────────────────
    async _execute(strategy, query, context) {
        const ctx = context.userContext || '';

        // Handle world simulation separately as it interacts with the WorldModel
        if (strategy === 'world_simulation') {
            const world = context.world;
            if (world) {
                const state = world.getCurrentState();
                const sim = world.simulate(state, query);
                return {
                    text: `🌍 MENTAL SIMULATION:
Proposed Action: "${query}"
Predicted Outcome: Tension will shift to ${(sim.nextState.tension * 100).toFixed(0)}%, Satisfaction to ${(sim.nextState.satisfaction * 100).toFixed(0)}%.
Expected Reward: ${sim.reward.toFixed(2)}
Estimated Latency: ${sim.latency.toFixed(0)}ms
Confidence: ${(sim.confidence * 100).toFixed(0)}%

${sim.confidence > 0.6 ? 'Conclusion: This action is well-modeled and likely to succeed.' : 'Conclusion: This is a novel action with high uncertainty.'}`,
                    metadata: { backend: 'world_model', tokens: 0, latency: 10 }
                };
            }
        }

        const prompts = {
            causal_chain: `Analyze this using CAUSAL CHAIN reasoning.
Trace causes → effects. Identify root causes, not just symptoms.
Ask: What caused this? What caused THAT? Go at least 3 levels deep.
${ctx}
QUERY: ${query}`,

            counterfactual_simulation: `Reason COUNTERFACTUALLY.
Explore: What if the opposite were true? What if key assumptions changed?
Identify the most critical variable, then simulate 2-3 alternative worlds.
${ctx}
QUERY: ${query}`,

            comparative_analysis: `Do a rigorous COMPARATIVE ANALYSIS.
Identify the key dimensions of comparison. Score each option.
Surface tradeoffs that aren't obvious. Give a clear recommendation.
${ctx}
QUERY: ${query}`,

            mechanistic_decomposition: `Explain the MECHANISM — how this actually works.
Break it into components. Trace data/control flow. Identify interfaces.
Be specific: not "it processes data" but HOW it processes data.
${ctx}
QUERY: ${query}`,

            logical_deduction: `Apply ANALYTICAL reasoning.
State your assumptions explicitly. Work through the logic step by step.
Show your work. Call out where you're uncertain.
${ctx}
QUERY: ${query}`,

            creative_synthesis: `Approach this GENERATIVELY.
Produce a concrete, working artifact — not a description of one.
Be specific, be complete, be opinionated about design choices.
${ctx}
QUERY: ${query}`,

            security_council: `Analyze through a SECURITY LENS.
Think like an attacker: what would you exploit? What's the blast radius?
Then think like a defender: what controls mitigate the risk?
Rate severity: Critical / High / Medium / Low with justification.
${ctx}
QUERY: ${query}`,

            step_decomposition: `Build a concrete EXECUTION PLAN.
Break this into numbered steps. For each step: what exactly happens, what tool/action, what success looks like.
Flag dependencies between steps. Identify the highest-risk step.
${ctx}
QUERY: ${query}`,

            integrated_reasoning: `Think about this carefully and completely.
Consider multiple angles. Be concrete. Don't hedge unnecessarily.
${ctx}
QUERY: ${query}`
        };

        const systemPrompt = `You are MAX, an autonomous engineering agent using structured reasoning.
You are in ${strategy} mode. Be precise, opinionated, and concrete. No filler.`;

        return this.brain.think(prompts[strategy] || prompts.integrated_reasoning, {
            systemPrompt,
            temperature: strategy === 'creative_synthesis' ? 0.8 : 0.4,
            maxTokens: 1024
        });
    }

    // ─── Estimate confidence from response quality ────────────────────────
    _confidence(result, context) {
        if (!result || typeof result !== 'string') return 0.2;
        let conf = 0.65;
        if (result.length > 300)   conf += 0.10;
        if (result.includes('1.')) conf += 0.05;  // structured
        if (result.includes('**')) conf += 0.05;  // formatted
        if (result.toLowerCase().includes('uncertain') ||
            result.toLowerCase().includes('might'))    conf -= 0.10;
        return Math.min(0.95, Math.max(0.2, conf));
    }

    getStats() { return this.stats; }
}
