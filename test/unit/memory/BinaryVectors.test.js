import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { MaxMemory } from '../../../memory/MaxMemory.js';
import { KnowledgeBase } from '../../../memory/KnowledgeBase.js';

const TEST_DIR = path.join(process.cwd(), '.max', 'test_binary_vectors');

describe('SQLite BLOB Binary Vector Storage', () => {
    beforeEach(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
    });

    afterEach(() => {
        try {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {}
    });

    it('MaxMemory stores and loads vectors as SQLite BLOBs incrementally', async () => {
        const dbPath = path.join(TEST_DIR, 'memory.db');
        const vectorPath = path.join(TEST_DIR, 'vectors.json');

        const mem = new MaxMemory({ dbPath, vectorPath });
        await mem.initialize();

        // Inject 2 test vectors
        const vec1 = new Float32Array(384).fill(0.5);
        const vec2 = new Float32Array(384).fill(0.1);
        mem._vectors.set('mem_1', vec1);
        mem._vectors.set('mem_2', vec2);
        mem._dirtyVectorIds.add('mem_1');
        mem._dirtyVectorIds.add('mem_2');

        // Persist vectors
        await mem._persistVectors();

        // Verify dirty set is cleared
        expect(mem._dirtyVectorIds.size).toBe(0);

        // Verify SQLite table has 2 rows
        const count = mem._db.prepare('SELECT COUNT(*) as c FROM memory_vectors').get().c;
        expect(count).toBe(2);

        // Verify raw BLOB length is exactly 384 * 4 = 1536 bytes
        const row = mem._db.prepare('SELECT vector FROM memory_vectors WHERE id = ?').get('mem_1');
        expect(row.vector.length).toBe(1536);

        await mem.shutdown();

        // Create a new instance and initialize to test loading from SQLite BLOB
        const mem2 = new MaxMemory({ dbPath, vectorPath });
        await mem2.initialize();

        expect(mem2._vectors.size).toBe(2);
        const loadedVec = mem2._vectors.get('mem_1');
        expect(loadedVec).toBeInstanceOf(Float32Array);
        expect(loadedVec.length).toBe(384);
        expect(loadedVec[0]).toBeCloseTo(0.5);

        await mem2.shutdown();
    });

    it('MaxMemory migrates legacy JSON vectors to SQLite BLOB and renames file', async () => {
        const dbPath = path.join(TEST_DIR, 'mig_memory.db');
        const vectorPath = path.join(TEST_DIR, 'vectors.json');

        // Write mock legacy vectors.json
        const mockJson = {
            'legacy_1': Array.from(new Float32Array(384).fill(0.7)),
            'legacy_2': Array.from(new Float32Array(384).fill(0.3))
        };
        fs.writeFileSync(vectorPath, JSON.stringify(mockJson));

        const mem = new MaxMemory({ dbPath, vectorPath });
        await mem.initialize();

        expect(mem._vectors.size).toBe(2);
        expect(fs.existsSync(vectorPath + '.migrated')).toBe(true);

        const count = mem._db.prepare('SELECT COUNT(*) as c FROM memory_vectors').get().c;
        expect(count).toBe(2);

        await mem.shutdown();
    });

    it('KnowledgeBase stores and loads vectors as SQLite BLOBs incrementally', async () => {
        const dbPath = path.join(TEST_DIR, 'knowledge.db');

        const kb = new KnowledgeBase({ dbPath });
        await kb.initialize();

        const vec = new Float32Array(384).fill(0.8);
        kb._vectors.set('chunk_1', vec);
        kb._dirtyVectorIds.add('chunk_1');

        kb._saveVectors();

        const count = kb._db.prepare('SELECT COUNT(*) as c FROM kb_vectors').get().c;
        expect(count).toBe(1);

        const row = kb._db.prepare('SELECT vector FROM kb_vectors WHERE id = ?').get('chunk_1');
        expect(row.vector.length).toBe(1536);

        // Reload in new instance
        const kb2 = new KnowledgeBase({ dbPath });
        await kb2.initialize();

        expect(kb2._vectors.size).toBe(1);
        const loadedVec = kb2._vectors.get('chunk_1');
        expect(loadedVec).toBeInstanceOf(Float32Array);
        expect(loadedVec[0]).toBeCloseTo(0.8);
    });
});
