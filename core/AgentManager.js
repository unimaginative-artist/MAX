// ═══════════════════════════════════════════════════════════════════════════
// AgentManager.js — MAX's orchestration layer for child agents
// 
// Tracks and manages instances of child agents (like Agent0). 
// Prevents redundant boots and allows for shared resource management.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath } from 'url';
import { Choko } from '../Choko/Agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class AgentManager {
    constructor(max) {
        this.max = max;
        this.agents = new Map(); // name -> agent instance
    }

    /**
     * Boot up a child agent by name.
     */
    async boot(name = 'Choko', config = {}) {
        if (this.agents.has(name)) {
            console.log(`[AgentManager] 🤖 Agent "${name}" is already online.`);
            return this.agents.get(name);
        }

        console.log(`[AgentManager] 🤖 Booting child agent: ${name}...`);

        let agent;
        if (name === 'Choko') {
            agent = new Choko({
                ...config,
                userName: this.max.profile?.getName() || 'User',
                economics: this.max.economics
            });
        } else {
            throw new Error(`Unknown agent type: ${name}`);
        }


        await agent.initialize();
        this.agents.set(name, agent);
        
        return agent;
    }

    /**
     * Inject a goal directly into a child agent's queue.
     */
    async injectGoal(name, goal) {
        const agent = this.agents.get(name);
        if (!agent) throw new Error(`Agent "${name}" not found or not online.`);

        console.log(`[AgentManager] 💉 Injecting goal into ${name}: "${goal.title}"`);
        
        // Add to child's goal engine
        const id = agent.goals.addGoal({
            ...goal,
            source: 'parent'
        });

        // Trigger child's loop immediately
        setImmediate(() => agent.agentLoop?.runCycle().catch(() => {}));

        return id;
    }

    /**
     * Get an active agent instance.
     */
    get(name) {
        return this.agents.get(name);
    }

    /**
     * List all active agents.
     */
    list() {
        return Array.from(this.agents.keys()).map(name => {
            const agent = this.agents.get(name);
            return {
                name,
                status: agent.getStatus(),
                activeGoals: agent.goals?.listActive() || []
            };
        });
    }

    /**
     * Shut down an agent.
     */
    async shutdown(name) {
        const agent = this.agents.get(name);
        if (agent) {
            agent.heartbeat?.stop();
            this.agents.delete(name);
            console.log(`[AgentManager] 🤖 Agent "${name}" shut down.`);
            return true;
        }
        return false;
    }

    getStatus() {
        return {
            activeCount: this.agents.size,
            agents: this.list()
        };
    }
}
