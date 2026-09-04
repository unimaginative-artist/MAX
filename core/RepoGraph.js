
import fs from 'fs/promises';
import path from 'path';

/**
 * RepoGraph — Architectural intelligence engine.
 * Maps project structure, detects risks (cycles, hubs), and analyzes impact.
 */
export class RepoGraph {
    constructor(max) {
        this.max = max;
        this.nodes = new Map(); // id -> { id, label, type, fanIn, fanOut, hubness }
        this.edges = [];        // Array of { source, target, type }
        this.lastRebuild = 0;
    }

    /**
     * Clear and rebuild the graph by scanning the filesystem.
     */
    async rebuild() {
        this.nodes.clear();
        this.edges = [];
        
        const root = process.cwd();
        const files = await this._getJsFiles(root);

        for (const file of files) {
            const rel = path.relative(root, file).replace(/\\/g, '/');
            this.nodes.set(rel, { 
                id: rel, 
                label: path.basename(file), 
                type: 'file',
                fanIn: 0,
                fanOut: 0
            });
        }

        // Second pass: extract edges
        for (const file of files) {
            const rel = path.relative(root, file).replace(/\\/g, '/');
            await this._extractDependencies(file, rel, root, files);
        }

        this._calculateMetrics();
        this.lastRebuild = Date.now();
        console.log(`[RepoGraph] 🏗️  Rebuild complete: ${this.nodes.size} nodes, ${this.edges.length} edges.`);
    }

    async _getJsFiles(dir, depth = 0) {
        if (depth > 6) return [];
        const skip = new Set(['node_modules', '.git', '.max', 'dist', 'build', 'coverage']);
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
        
        let results = [];
        for (const e of entries) {
            if (skip.has(e.name) || e.name.startsWith('.')) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                results = results.concat(await this._getJsFiles(full, depth + 1));
            } else if (/\.(js|mjs|ts|tsx|jsx)$/.test(e.name)) {
                results.push(full);
            }
        }
        return results;
    }

    async _extractDependencies(file, rel, root, allFiles) {
        try {
            const src = await fs.readFile(file, 'utf8');
            // Hardened regex for imports/requires
            const importRe = /(?:import|require|from)\s*[\('"]*([^'"\)\s\n]+)['"]/g;
            let m;
            while ((m = importRe.exec(src)) !== null) {
                const dep = m[1].trim();
                if (!dep.startsWith('.')) continue; // ignore package deps for now

                const resolved = path.resolve(path.dirname(file), dep);
                const candidates = [
                    resolved, 
                    resolved + '.js', resolved + '.jsx', 
                    resolved + '.ts', resolved + '.tsx',
                    resolved + '.mjs', resolved + '/index.js'
                ];

                for (const c of candidates) {
                    const depRel = path.relative(root, c).replace(/\\/g, '/');
                    if (this.nodes.has(depRel)) {
                        this.addEdge(rel, depRel, 'import');
                        break;
                    }
                }
            }
        } catch {}
    }

    addNode(id, attrs = {}) {
        if (!this.nodes.has(id)) {
            this.nodes.set(id, { id, label: attrs.name ?? id, fanIn: 0, fanOut: 0, ...attrs });
        } else {
            Object.assign(this.nodes.get(id), attrs);
        }
    }

    addEdge(from, to, type = 'import') {
        if (from === to) return;
        const exists = this.edges.some(e => e.source === from && e.target === to);
        if (!exists) {
            this.edges.push({ source: from, target: to, type });
        }
    }

    _calculateMetrics() {
        // Reset metrics
        for (const node of this.nodes.values()) {
            node.fanIn = 0;
            node.fanOut = 0;
        }

        // Calculate degrees
        for (const edge of this.edges) {
            const src = this.nodes.get(edge.source);
            const dst = this.nodes.get(edge.target);
            if (src) src.fanOut++;
            if (dst) dst.fanIn++;
        }

        // Calculate Hubness (Product of Fan-In and Fan-Out)
        for (const node of this.nodes.values()) {
            node.hubness = node.fanIn * node.fanOut;
        }
    }

    /**
     * Detect circular dependencies using a simple DFS.
     */
    detectCycles() {
        const cycles = [];
        const visited = new Set();
        const stack = new Set();

        const find = (nodeId, path = []) => {
            if (stack.has(nodeId)) {
                const cycle = path.slice(path.indexOf(nodeId));
                cycles.push([...cycle, nodeId]);
                return;
            }
            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            stack.add(nodeId);
            
            const neighbors = this.edges.filter(e => e.source === nodeId).map(e => e.target);
            for (const neighbor of neighbors) {
                find(neighbor, [...path, nodeId]);
            }
            stack.delete(nodeId);
        };

        for (const nodeId of this.nodes.keys()) {
            find(nodeId);
        }

        return cycles;
    }

    getImpact(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        const impact = new Set();
        const queue = [normalized];

        while (queue.length > 0) {
            const current = queue.shift();
            for (const edge of this.edges) {
                if (edge.target === current && !impact.has(edge.source)) {
                    impact.add(edge.source);
                    queue.push(edge.source);
                }
            }
        }
        return Array.from(impact);
    }

    getVisualizationData() {
        const cycles = this.detectCycles();
        const cycleNodes = new Set(cycles.flat());

        return {
            nodes: Array.from(this.nodes.values()).map(n => ({
                ...n,
                isHub: n.hubness > 10,
                inCycle: cycleNodes.has(n.id)
            })),
            edges: this.edges,
            metrics: {
                totalNodes: this.nodes.size,
                totalEdges: this.edges.length,
                cycleCount: cycles.length,
                hubs: Array.from(this.nodes.values())
                    .filter(n => n.hubness > 10)
                    .sort((a,b) => b.hubness - a.hubness)
                    .map(n => n.id)
            }
        };
    }

    getSummary() {
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.length,
            risks: {
                cycles: this.detectCycles().length,
                hubs: Array.from(this.nodes.values()).filter(n => n.hubness > 10).length
            }
        };
    }
}
