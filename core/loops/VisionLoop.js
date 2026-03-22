// ═══════════════════════════════════════════════════════════════════════════
// VisionLoop.js — visual perception and UI reasoning
//
// Bridges MAX to SOMA's vision suite (screenshot, vision_scan).
// This loop allows MAX to "see" the computer environment and reason
// about visual state (UI bugs, alignment, system status).
// ═══════════════════════════════════════════════════════════════════════════

export class VisionLoop {
    static id = 'vision';
    static signals = ['look at', 'see', 'screenshot', 'scan ui', 'visual check', 'ui audit'];
    static description = 'Visual perception loop. Captures screenshots and uses SOMA vision to reason about UI and environment.';

    /**
     * Run a visual perception goal.
     * @param {object} goal  The visual task
     * @param {object} max   MAX instance
     * @param {object} agentLoop AgentLoop instance
     */
    async run(goal, max, agentLoop = null) {
        console.log(`\n[VisionLoop] 👁️  Looking at the environment...`);
        
        if (!max.soma?.available) {
            console.log(`[VisionLoop] ⚠️  SOMA offline — visual perception unavailable.`);
            return { success: false, summary: 'SOMA offline' };
        }

        // ── 1. Capture Screenshot ─────────────────────────────────────────
        agentLoop?.emit('progress', { goal: goal.title, step: 1, total: 3, action: 'Capturing screenshot' });
        const screenshot = await max.tools.execute('soma_tools', 'screenshot', {});
        
        if (!screenshot.success) {
            return { success: false, summary: `Screenshot failed: ${screenshot.error}` };
        }

        // ── 2. Run Vision Scan ────────────────────────────────────────────
        agentLoop?.emit('progress', { goal: goal.title, step: 2, total: 3, action: 'Scanning for UI elements' });
        const scan = await max.tools.execute('soma_tools', 'vision_scan', { source: 'screen', threshold: 0.6 });

        const elements = scan.result?.elements || [];
        const elementSummary = elements.map(e => `${e.label} at [${e.x}, ${e.y}]`).join(', ');

        // ── 3. Synthesize Visual Insight ──────────────────────────────────
        agentLoop?.emit('progress', { goal: goal.title, step: 3, total: 3, action: 'Synthesizing visual insight' });
        
        const prompt = `You are MAX with active visual perception. You just took a screenshot and ran a vision scan.

GOAL: "${goal.title}"
VISION SCAN DATA: ${elementSummary || 'No distinct elements found'}

Based on what you "see", provide a technical insight. 
Are there UI anomalies? Is the system dashboard healthy? 
What is the most prominent thing on the screen?

Reply with a concise technical summary.`;

        const res = await max.brain.think(prompt, { tier: 'smart', temperature: 0.4 });
        const visualInsight = res.text.trim();

        console.log(`[VisionLoop] ✅ Observation complete: ${visualInsight}`);

        // Emit insight
        agentLoop?.emit('insight', {
            source: 'vision',
            label:  '👁️ Visual Observation',
            result: visualInsight
        });

        // Record outcome
        max.outcomes?.record({
            agent:   'VisionLoop',
            action:  'vision:observe',
            context: { goal: goal.title, elementsFound: elements.length },
            result:  visualInsight,
            success: true
        });

        return { goal: goal.title, success: true, summary: visualInsight };
    }
}
