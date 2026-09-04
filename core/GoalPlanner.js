// ═══════════════════════════════════════════════════════════════════════════
// GoalPlanner.js — MAX Autonomous Goal Planning & Task Orchestration Bridge
// Connects MAX's cognitive loop to SOMA's GoalPlannerArbiter for autonomous
// background engineering goal discovery, tracking, and execution.
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export class GoalPlanner {
    constructor(somaUrl = 'http://127.0.0.1:3001') {
        this.somaUrl = somaUrl.replace(/\/$/, '');
        this.activeGoals = new Map();
        this.planningInterval = 1800000; // 30 mins
        this.timer = null;
    }

    async initialize() {
        console.log('[GoalPlanner] 🎯 MAX Autonomous Goal Planning Bridge initializing...');
        await this.syncGoals();
    }

    async syncGoals() {
        try {
            const res = await fetch(`${this.somaUrl}/api/goals`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                const data = await res.json();
                const goals = data.goals || data || [];
                if (Array.isArray(goals)) {
                    goals.forEach(g => this.activeGoals.set(g.id || g.title, g));
                    console.log(`[GoalPlanner] 🎯 Synced ${goals.length} autonomous goals from SOMA core.`);
                }
            }
        } catch (e) {
            console.log(`[GoalPlanner] ℹ️ Goal sync standby: ${e.message}`);
        }
    }

    async createGoal(title, description, priority = 'normal') {
        const goal = {
            id: `goal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            title,
            description,
            priority,
            status: 'active',
            progress: 0,
            createdAt: Date.now()
        };

        this.activeGoals.set(goal.id, goal);

        try {
            await fetch(`${this.somaUrl}/api/goals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(goal),
                signal: AbortSignal.timeout(3000)
            });
        } catch (e) {}

        return goal;
    }

    getActiveGoals() {
        return Array.from(this.activeGoals.values()).filter(g => g.status === 'active');
    }
}
