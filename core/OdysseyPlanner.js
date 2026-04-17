
import fs from 'fs/promises';
import path from 'path';

/**
 * THE ODYSSEY PROTOCOL
 * v0.1 — Long Horizon Planning via Directed Acyclic Graphs (DAG)
 * 
 * Manages complex, multi-week engineering projects by tracking 
 * prerequisites, milestones, and system checkpoints.
 */
export class OdysseyPlanner {
    constructor(max, config = {}) {
        this.max = max;
        this.storagePath = path.join(process.cwd(), '.max', 'odyssey_maps.json');
        
        // Maps: Map of projectId -> { title, nodes: [], edges: [], status: 'active|done' }
        this.maps = new Map();
        this._ready = false;
    }

    async initialize() {
        await this.load();
        console.log(`[ODYSSEY] 🧭 Navigator online. ${this.maps.size} strategic maps loaded.`);
        this._ready = true;
    }

    /**
     * Start a new grand project using the Cartographer (Brain)
     */
    async mapGrandGoal(goal, description) {
        console.log(`[ODYSSEY] 🗺️  The Cartographer is mapping: "${goal}"...`);
        
        const prompt = `Perform a POSEIDON architectural breakdown for a long-horizon project.
PROJECT: ${goal}
DESCRIPTION: ${description}

Convert this project into a Directed Acyclic Graph (DAG) of technical prerequisites.
Nodes represent specific milestones (3-6 total).
Edges represent dependency flow (A must be done before B).

Return ONLY JSON:
{
  "projectId": "unique-slug",
  "title": "...",
  "nodes": [
    { "id": "node1", "label": "...", "task": "detailed instructions", "type": "research|implementation|testing" }
  ],
  "edges": [
    { "from": "node1", "to": "node2" }
  ]
}`;

        try {
            const result = await this.max.brain.think(prompt, { tier: 'smart', temperature: 0.2 });
            const map = JSON.parse(result.text.match(/\{[\s\S]*\}/)[0]);
            
            // Initialize node status
            map.nodes = map.nodes.map(n => ({ ...n, status: 'pending', attempts: 0 }));
            map.status = 'active';
            map.createdAt = Date.now();

            this.maps.set(map.projectId, map);
            await this.save();
            
            console.log(`[ODYSSEY] 📍 New map created: ${map.title} (${map.nodes.length} milestones)`);
            return map.projectId;
        } catch (err) {
            console.error('[ODYSSEY] ❌ Cartography failed:', err.message);
            return null;
        }
    }

    /**
     * Identify the next executable milestones (nodes with all prerequisites met)
     */
    getNextNodes(projectId) {
        const map = this.maps.get(projectId);
        if (!map || map.status !== 'active') return [];

        return map.nodes.filter(node => {
            if (node.status !== 'pending') return false;

            // Find all nodes that point TO this node
            const prerequisites = map.edges
                .filter(e => e.to === node.id)
                .map(e => map.nodes.find(n => n.id === e.from));

            // True if all prerequisites are 'completed'
            return prerequisites.every(p => p.status === 'completed');
        });
    }

    /**
     * Mark a node as completed and trigger a system checkpoint
     */
    async completeNode(projectId, nodeId, result) {
        const map = this.maps.get(projectId);
        if (!map) return;

        const node = map.nodes.find(n => n.id === nodeId);
        if (node) {
            node.status = 'completed';
            node.completedAt = Date.now();
            node.resultSummary = typeof result === 'string' ? result.slice(0, 500) : 'Done.';
            
            console.log(`[ODYSSEY] 🚩 Milestone Reached: ${node.label}`);
            
            // Check if project is finished
            if (map.nodes.every(n => n.status === 'completed')) {
                map.status = 'done';
                console.log(`[ODYSSEY] 🏆 Project Odyssey Complete: ${map.title}`);
            }

            await this.save();
            await this._createCheckpoint(projectId, nodeId);
        }
    }

    /**
     * Create a recovery checkpoint (Git SHA + state dump)
     */
    async _createCheckpoint(projectId, nodeId) {
        try {
            const git = await this.max.tools.execute('git', 'status', {});
            const checkpoint = {
                ts: Date.now(),
                projectId,
                nodeId,
                gitStatus: git.branch || 'unknown'
            };
            
            const checkpointPath = path.join(process.cwd(), '.max', 'checkpoints', `${projectId}_${nodeId}.json`);
            await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
            await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
            
            console.log(`[ODYSSEY] 💾 Checkpoint saved at node ${nodeId}`);
        } catch { /* non-fatal */ }
    }

    async save() {
        const data = Array.from(this.maps.entries());
        await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
    }

    async load() {
        try {
            const raw = await fs.readFile(this.storagePath, 'utf8');
            this.maps = new Map(JSON.parse(raw));
        } catch { /* new file */ }
    }
}
