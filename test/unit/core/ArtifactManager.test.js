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

// SENTINEL_END
