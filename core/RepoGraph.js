
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
        console.log('[RepoGraph] 🗺️  Building project cognition graph...');
        // Logic will be populated by the Indexer
    }

    addNode(id, data) {
        this.nodes.set(id, { id, ...data });
    }

    addEdge(from, to, type) {
        this.edges.push({ from, to, type });
    }

    /**
     * Find everything that depends on a specific file.
     * Crucial for "Impact Analysis" before self-evolution.
     */
    getDependents(filePath) {
        return this.edges
            .filter(e => e.to === filePath && e.type === 'imports')
            .map(e => e.from);
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
