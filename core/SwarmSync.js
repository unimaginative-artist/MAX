// ═══════════════════════════════════════════════════════════════════════════
// SwarmSync.js — Cross-agent knowledge exchange
//
// Periodically synchronizes memories, discoveries, and outcomes between
// MAX and his child agents (like Agent0). 
// ═══════════════════════════════════════════════════════════════════════════

export class SwarmSync {
    constructor(max) {
        this.max = max;
    }

    /**
     * Run a synchronization cycle.
     */
    async sync() {
        const agents = this.max.agentManager?.list() || [];
        if (agents.length === 0) return;

        console.log(`[SwarmSync] 🔄 Synchronizing ${agents.length} agents...`);

        for (const agentInfo of agents) {
            const agent = this.max.agentManager.get(agentInfo.name);
            if (!agent) continue;

            // 1. Pull discoveries from child agent
            await this._pullDiscoveries(agent);

            // 2. Push global blueprints to child agent
            await this._pushBlueprints(agent);
        }
    }

    /**
     * Child -> Parent: Extract learnings from child agent
     */
    async _pullDiscoveries(child) {
        try {
            // Find completed tasks or new memory entries in child
            const tasks = child.profile?.getStats()?.tasks || [];
            const newLearnings = tasks.filter(t => t.completed && !t.synced);

            for (const learning of newLearnings) {
                console.log(`[SwarmSync] 📥 Pulling discovery from ${child.name}: "${learning.text}"`);
                
                // Add to MAX's memory
                await this.max.memory.remember(
                    `Discovery from ${child.name}: ${learning.text}`,
                    { source: child.name, type: 'swarm_discovery' },
                    { importance: 0.7 }
                );

                // Mark as synced in child (if supported)
                learning.synced = true;
            }
        } catch (err) {
            console.warn(`[SwarmSync] ⚠️ Failed to pull from ${child.name}:`, err.message);
        }
    }

    /**
     * Parent -> Child: Push global knowledge to child agent
     */
    async _pushBlueprints(child) {
        try {
            // Push recent "Lessons" from MAX's reflection engine to child KnowledgeBase
            const lessons = this.max.reflection?.getStatus()?.lessons || [];
            if (lessons.length > 0) {
                console.log(`[SwarmSync] 📤 Pushing ${lessons.length} lessons to ${child.name}`);
                for (const lesson of lessons) {
                    await child.kb.ingestText(
                        `Lesson from MAX: ${lesson.content}`,
                        { name: `Lesson_${Date.now()}`, type: 'swarm_push' }
                    );
                }
            }
        } catch (err) {
            console.warn(`[SwarmSync] ⚠️ Failed to push to ${child.name}:`, err.message);
        }
    }
}
