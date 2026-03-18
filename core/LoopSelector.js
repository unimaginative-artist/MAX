// ═══════════════════════════════════════════════════════════════════════════
// LoopSelector.js — routes goals to the right execution strategy
//
// MAX has four execution modes. The selector reads a goal and returns which
// loop should run it. This is pure classification — no LLM call needed.
// Fast, deterministic, based on goal.type + keyword scoring.
//
// Loops:
//   explore  — read-only investigation, synthesizes knowledge (no writes/shell)
//   build    — adversarial engineering: research → debate → write → verify
//   reflect  — metacognitive self-improvement, outcome review, goal pruning
//   watch    — (future) recurring sentinel patrol
//   default  — existing linear AgentLoop execution
// ═══════════════════════════════════════════════════════════════════════════

// Keyword sets per loop type. Each keyword that matches adds 1 to that loop's score.
const SIGNALS = {
    explore: [
        'research', 'investigate', 'understand', 'explore', 'study', 'survey',
        'learn about', 'find out', 'what is', 'how does', 'discover', 'read through',
        'analyze codebase', 'map out', 'document', 'audit', 'inventory'
    ],
    build: [
        'implement', 'fix', 'create', 'add feature', 'refactor', 'patch',
        'build', 'write code', 'develop', 'debug', 'repair', 'update code',
        'migrate', 'port', 'integrate', 'wire up', 'add support for',
        'replace', 'rewrite', 'extend', 'modify'
    ],
    reflect: [
        'reflect', 'review outcomes', 'self-improve', 'analyze patterns',
        'self assessment', 'examine failures', 'performance review',
        'introspect', 'evaluate performance', 'what went wrong',
        'improve my', 'identify weaknesses', 'learning review'
    ],
    watch: [
        'monitor', 'watch', 'alert when', 'check every', 'notify when',
        'keep watching', 'sentinel', 'track changes', 'poll', 'detect when'
    ]
};

// goal.type direct mappings — highest confidence
const TYPE_MAP = {
    research:    'explore',
    improvement: 'reflect',
    fix:         'build'
};

export class LoopSelector {
    /**
     * Classify a goal into a loop type.
     * @param {object} goal  { title, description, type, source }
     * @returns {{ loop: string, confidence: number, rationale: string }}
     */
    classify(goal) {
        const type  = goal.type || 'task';
        const title = (goal.title + ' ' + (goal.description || '')).toLowerCase();

        // Direct type mapping is highest confidence
        if (TYPE_MAP[type]) {
            return {
                loop:       TYPE_MAP[type],
                confidence: 0.9,
                rationale:  `goal.type="${type}"`
            };
        }

        // Keyword scoring
        const scores = {};
        for (const [loop, keywords] of Object.entries(SIGNALS)) {
            scores[loop] = keywords.reduce((s, kw) => s + (title.includes(kw) ? 1 : 0), 0);
        }

        const [[bestLoop, bestScore]] = Object.entries(scores).sort((a, b) => b[1] - a[1]);

        if (bestScore >= 2) {
            return {
                loop:       bestLoop,
                confidence: Math.min(0.6 + bestScore * 0.08, 0.92),
                rationale:  `keyword score: ${bestScore} (${bestLoop})`
            };
        }

        // Weak signal — check if it's a code task by goal type
        if (type === 'task' && scores.build >= 1) {
            return { loop: 'build', confidence: 0.55, rationale: 'weak build signal on task type' };
        }

        return { loop: 'default', confidence: 1.0, rationale: 'no strong signal' };
    }
}
