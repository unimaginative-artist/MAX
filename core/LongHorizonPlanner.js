// ═══════════════════════════════════════════════════════════════════════════
// LongHorizonPlanner.js — aligns MAX's daily work with long-term vision
//
// Reads .max/vision.md (user-authored markdown) and synthesizes:
//   - 1-2 week-level goals MAX can make progress on TODAY
//   - Strategic alignment check so daily tasks don't drift from long-term intent
//
// Called by ReflectLoop. If vision.md doesn't exist, creates a starter template.
// Rate-limited to re-synthesize at most once every 6 hours.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';

const VISION_FILE = path.join(process.cwd(), '.max', 'vision.md');

const TEMPLATE = `# MAX Vision — Long-Horizon Goals

## This Week
- [ ] SOMA and MAX share memory bidirectionally (every build outcome recorded)
- [ ] MAX completes at least 5 autonomous goals without human intervention
- [ ] All broken loops in AgentLoop are wired and tested

## This Month
- [ ] SOMA achieves a full self-improvement cycle: benchmark → plan → patch → verify
- [ ] MAX's ReflectLoop identifies and closes 3+ recurring failure patterns
- [ ] Both systems run stably for 72 hours without restart

## This Quarter
- [ ] SOMA acts as a Cognitive OS — external arbiters register and get perception for free
- [ ] MAX autonomously ships improvements to SOMA with no human code review needed
- [ ] Together they exceed human-level performance on software engineering tasks

---
*Edit this file anytime. MAX reads it during ReflectLoop to align daily work with your vision.*
`;

export class LongHorizonPlanner {
    constructor() {
        this._lastSynthesis = 0;
        this._synthEveryMs  = 6 * 60 * 60 * 1000;  // at most once per 6h
    }

    async initialize() {
        try {
            await fs.access(VISION_FILE);
        } catch {
            const dir = path.dirname(VISION_FILE);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(VISION_FILE, TEMPLATE, 'utf8');
            console.log('[LongHorizonPlanner] 📝 Created .max/vision.md — edit it to set your goals');
        }
        console.log('[LongHorizonPlanner] ✅ Ready');
    }

    /**
     * Synthesize vision-aligned goals and inject them into GoalEngine.
     * Called from ReflectLoop. Returns a one-line summary or null if nothing added.
     */
    async synthesize(max) {
        if (Date.now() - this._lastSynthesis < this._synthEveryMs) return null;
        if (!max.brain?._ready || !max.goals) return null;

        let visionText = '';
        try {
            visionText = await fs.readFile(VISION_FILE, 'utf8');
        } catch {
            return null;
        }

        const activeGoals = max.goals.listActive()
            .map(g => `- ${g.title}`)
            .join('\n') || 'none';

        const result = await max.brain.think(
            `You are MAX's strategic planning system. Given the user's long-term vision,\n` +
            `identify 1-2 specific goals MAX can make progress on TODAY that align with that vision.\n\n` +
            `VISION:\n${visionText.slice(0, 2000)}\n\n` +
            `CURRENT ACTIVE GOALS (already queued — do NOT duplicate these):\n${activeGoals}\n\n` +
            `Rules:\n` +
            `- Goals must be executable with MAX's tools (file, shell, web, git, brain)\n` +
            `- Goals must be completable in one session (30 min or less)\n` +
            `- If current goals already cover the vision well, return []\n\n` +
            `Return ONLY a JSON array:\n` +
            `[{"title": "...", "description": "specific action to take", "type": "task|improvement|fix|research", "priority": 0.1-0.9}]`,
            { temperature: 0.3, maxTokens: 400, tier: 'smart' }
        ).catch(() => null);

        if (!result?.text) return null;

        try {
            const match = result.text.match(/\[[\s\S]*\]/);
            if (!match) return null;

            const goals = JSON.parse(match[0]);
            let added   = 0;

            for (const g of goals.slice(0, 2)) {
                if (!g?.title || typeof g.title !== 'string' || g.title.trim().length < 4) continue;
                const validTypes = new Set(['task', 'improvement', 'fix', 'research']);
                max.goals.addGoal({
                    title:       g.title.trim().slice(0, 120),
                    description: (g.description || '').slice(0, 400),
                    type:        validTypes.has(g.type) ? g.type : 'task',
                    source:      'long_horizon',
                    priority:    typeof g.priority === 'number'
                        ? Math.max(0.3, Math.min(0.9, g.priority))
                        : 0.5
                });
                added++;
            }

            this._lastSynthesis = Date.now();

            if (added > 0) {
                console.log(`[LongHorizonPlanner] 🎯 Injected ${added} vision-aligned goal(s)`);
                return `Added ${added} long-horizon goal(s) from vision.md`;
            }
            return null;
        } catch {
            return null;
        }
    }
}
