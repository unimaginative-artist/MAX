// ═══════════════════════════════════════════════════════════════════════════
// RoadmapEngine.js — MAX's strategic focus
// Parses plan.md and frontier_map.md into a long-term execution graph.
// Injects high-level strategic goals into the GoalEngine.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

export class RoadmapEngine {
    constructor(max, config = {}) {
        this.max    = max;
        this.config = {
            planFile:     path.join(process.cwd(), 'plan.md'),
            frontierFile: path.join(process.cwd(), 'frontier_map.md'),
            syncInterval: config.syncInterval || 60 * 60 * 1000, // 1h
            ...config
        };

        this.roadmap = {
            objectives: [],
            milestones: [],
            lastSync:   null
        };
    }

    /**
     * Initial sync at boot.
     */
    async initialize() {
        await this.sync();
        console.log(`[Roadmap] 🗺️ Strategic engine ready. ${this.roadmap.objectives.length} objectives parsed.`);
    }

    /**
     * Parse the Markdown plans and update the internal graph.
     */
    async sync() {
        if (!this.max.brain?._ready) return;

        const planContent = this._read(this.config.planFile);
        const frontierContent = this._read(this.config.frontierFile);

        const prompt = `You are MAX's strategic roadmap analyzer. Parse these planning documents into a structured dependency graph.

PLAN:
${planContent.slice(0, 2000)}

FRONTIER MAP:
${frontierContent.slice(0, 1500)}

Extract:
1. High-level objectives (Phase names)
2. Concrete milestones/tasks
3. Their status (todo, in-progress, done)
4. Dependencies (which tasks must come first)

Return JSON ONLY:
{
  "objectives": [{ "name": "...", "priority": 0.1-1.0 }],
  "milestones": [{ "id": "...", "title": "...", "status": "todo|done", "objective": "...", "dependsOn": [] }]
}`;

        try {
            const result = await this.max.brain.think(prompt, { temperature: 0.2, tier: 'smart' });
            const match  = result.text.match(/\{[\s\S]*\}/);
            if (match) {
                this.roadmap = JSON.parse(match[0]);
                this.roadmap.lastSync = new Date().toISOString();
                this._injectStrategicGoals();
            }
        } catch (err) {
            console.error('[Roadmap] Sync error:', err.message);
        }
    }

    /**
     * Find the next 'todo' milestone that has all dependencies met and queue it.
     */
    _injectStrategicGoals() {
        if (!this.max.goals) return;

        const todo = this.roadmap.milestones.filter(m => m.status === 'todo');
        const done = new Set(this.roadmap.milestones.filter(m => m.status === 'done').map(m => m.id));

        for (const m of todo) {
            const depsMet = (m.dependsOn || []).every(d => done.has(d));
            if (depsMet) {
                // Check if already queued
                const alreadyQueued = this.max.goals.listActive().some(g => g.title === m.title);
                if (!alreadyQueued) {
                    this.max.goals.addGoal({
                        title:       m.title,
                        description: `Strategic Milestone: ${m.title} (from roadmap)`,
                        type:        'improvement',
                        priority:    0.7,
                        source:      'roadmap'
                    });
                    console.log(`[Roadmap] 🎯 Injected strategic goal: "${m.title}"`);
                }
            }
        }
    }

    _read(filePath) {
        try { return fs.readFileSync(filePath, 'utf8'); }
        catch { return ''; }
    }

    getStatus() {
        return {
            lastSync: this.roadmap.lastSync,
            objectivesCount: this.roadmap.objectives?.length || 0,
            todoMilestones: (this.roadmap.milestones || []).filter(m => m.status === 'todo').length
        };
    }
}
