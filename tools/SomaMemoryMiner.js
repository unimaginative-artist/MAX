// ═══════════════════════════════════════════════════════════════════════════
// SomaMemoryMiner.js — Harvester for SOMA Codebase, Arbiters, & Memories
// Ingests high-yield cognitive architecture patterns and historical memories
// into MAX's vector knowledge base to power 2B specialized coding reasoning.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export class SomaMemoryMiner {
    constructor(max = null, options = {}) {
        this.max = max;
        this.somaPath = path.resolve(options.somaPath || 'C:\\Users\\barry\\Desktop\\SOMA');
    }

    /**
     * Scan local SOMA repository and extract high-value architecture code files.
     */
    discoverSomaAssets() {
        if (!fs.existsSync(this.somaPath)) {
            return { found: false, error: `SOMA directory not found at: ${this.somaPath}` };
        }

        const assets = {
            arbiters: [],
            tests: [],
            blueprints: [],
            databases: []
        };

        const topFiles = fs.readdirSync(this.somaPath, { withFileTypes: true });
        for (const entry of topFiles) {
            if (entry.isFile()) {
                const name = entry.name;
                const fullPath = path.join(this.somaPath, name);
                if (/arbiter/i.test(name) && name.endsWith('.js')) {
                    assets.arbiters.push(fullPath);
                } else if (/^test[-_].*\.(mjs|cjs|js)$/i.test(name)) {
                    assets.tests.push(fullPath);
                } else if (name.endsWith('.md') && /blueprint|architecture|roadmap/i.test(name)) {
                    assets.blueprints.push(fullPath);
                } else if (name === 'soma-memory.db') {
                    assets.databases.push(fullPath);
                }
            }
        }

        // Also scan arbiters/ and capabilities/ subdirectories if present
        const subdirs = ['arbiters', 'capabilities', 'core', 'hippocampus'];
        for (const sub of subdirs) {
            const subPath = path.join(this.somaPath, sub);
            if (fs.existsSync(subPath)) {
                try {
                    const entries = fs.readdirSync(subPath, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
                            assets.arbiters.push(path.join(subPath, entry.name));
                        }
                    }
                } catch {}
            }
        }

        return { found: true, assets };
    }

    /**
     * Mine historical memories from SOMA's SQLite database.
     */
    mineSomaDatabase(limit = 100) {
        const dbPath = path.join(this.somaPath, 'soma-memory.db');
        if (!fs.existsSync(dbPath)) return [];

        try {
            const db = new Database(dbPath, { readonly: true });
            // Inspect tables
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
            const memories = [];

            if (tables.includes('memories')) {
                const rows = db.prepare("SELECT * FROM memories ORDER BY rowid DESC LIMIT ?").all(limit);
                for (const row of rows) {
                    const content = row.content || row.text || row.summary;
                    if (content) {
                        memories.push({
                            source: 'soma_sqlite_memories',
                            category: row.category || row.type || 'historical_memory',
                            content: String(content).slice(0, 1000)
                        });
                    }
                }
            }
            db.close();
            return memories;
        } catch (err) {
            console.warn('[SomaMemoryMiner] Could not query soma-memory.db:', err.message);
            return [];
        }
    }

    /**
     * Ingest discovered SOMA assets into MAX's KnowledgeBase vectors.
     */
    async ingestIntoKnowledgeBase(kb = null) {
        const targetKb = kb || this.max?.knowledge;
        if (!targetKb) return { success: false, error: 'KnowledgeBase instance not provided' };

        const discovery = this.discoverSomaAssets();
        if (!discovery.found) return { success: false, error: discovery.error };

        let ingestedCount = 0;
        const allFiles = [...discovery.assets.arbiters, ...discovery.assets.tests, ...discovery.assets.blueprints];

        for (const filePath of allFiles) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const relName = 'SOMA/' + path.basename(filePath);
                if (typeof targetKb.ingestDocument === 'function') {
                    await targetKb.ingestDocument(relName, content);
                    ingestedCount++;
                }
            } catch {}
        }

        const dbMemories = this.mineSomaDatabase(50);
        for (const mem of dbMemories) {
            try {
                if (typeof targetKb.ingestDocument === 'function') {
                    await targetKb.ingestDocument(`SOMA/Memory_${mem.category}`, mem.content);
                    ingestedCount++;
                }
            } catch {}
        }

        return {
            success: true,
            filesIngested: ingestedCount,
            arbitersFound: discovery.assets.arbiters.length,
            testsFound: discovery.assets.tests.length,
            dbMemoriesHarvested: dbMemories.length
        };
    }
}
