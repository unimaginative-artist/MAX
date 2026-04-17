
import fs from 'fs/promises';
import path from 'path';

/**
 * RepoGraph — The structural map of the project.
 * Tracks files, classes, functions, and their inter-dependencies.
 */
export class RepoGraph {
    constructor(max) {
        this.max = max;
        this.nodes = new Map(); // id -> { type, name, path, metadata }
        this.edges = [];        // Array of { from, to, type }
    }

    /**
     * Clear and rebuild the graph.
     */
    async rebuild() {
        this.nodes.clear();
        this.edges = [];
        // The Indexer now calls addNode/addEdge during its crawl
    }

    addNode(id, data) {
        // Standardize on forward slashes for cross-platform consistency
        const normalizedId = id.replace(/\\/g, '/');
        this.nodes.set(normalizedId, { id: normalizedId, ...data });
    }

    addEdge(from, to, type) {
        const normalizedFrom = from.replace(/\\/g, '/');
        const normalizedTo   = to.replace(/\\/g, '/');
        
        // Prevent duplicate edges
        const exists = this.edges.some(e => e.from === normalizedFrom && e.to === normalizedTo && e.type === type);
        if (!exists) {
            this.edges.push({ from: normalizedFrom, to: normalizedTo, type });
        }
    }

    /**
     * Find everything that depends on a specific file (recursive).
     * This is the "Blast Radius" of a change.
     */
    getImpact(filePath, visited = new Set()) {
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (visited.has(normalizedPath)) return [];
        visited.add(normalizedPath);

        const directDependents = this.edges
            .filter(e => e.to === normalizedPath)
            .map(e => e.from);

        let recursiveImpact = [...directDependents];
        for (const dep of directDependents) {
            recursiveImpact = recursiveImpact.concat(this.getImpact(dep, visited));
        }

        return [...new Set(recursiveImpact)];
    }

    /**
     * Trace the dependency chain for a file (what it needs to run).
     */
    getDependencies(filePath, visited = new Set()) {
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (visited.has(normalizedPath)) return [];
        visited.add(normalizedPath);

        const directDeps = this.edges
            .filter(e => e.from === normalizedPath)
            .map(e => e.to);

        let recursiveDeps = [...directDeps];
        for (const dep of directDeps) {
            recursiveDeps = recursiveDeps.concat(this.getDependencies(dep, visited));
        }

        return [...new Set(recursiveDeps)];
    }

    /**
     * Get a structural summary for the LLM.
     */
    getSummary() {
        return {
            nodeCount: this.nodes.size,
            edgeCount: this.edges.length,
            entryPoints: Array.from(this.nodes.values())
                .filter(n => n.type === 'file' && !this.edges.some(e => e.to === n.id))
                .map(n => n.name)
        };
    }
}
