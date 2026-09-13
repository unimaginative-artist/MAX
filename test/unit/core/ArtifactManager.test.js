import { jest } from '@jest/globals';
import fs   from 'fs/promises';
import os   from 'os';
import path from 'path';

import { ArtifactManager } from '../../../core/ArtifactManager.js';

let tmpDir;
let manager;

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir  = await fs.mkdtemp(path.join(os.tmpdir(), 'artifacts-test-'));
    manager = new ArtifactManager({});
    manager._dir = tmpDir;
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

test('stores and retrieves an artifact', () => {
    const pointer = manager.store('test_snippet', 'console.log("hello")', 'code');
    expect(pointer).toContain('[ARTIFACT:');
    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('test_snippet');
    const retrieved = manager.get(list[0].id);
    expect(retrieved.content).toBe('console.log("hello")');
});

// SENTINEL_END
