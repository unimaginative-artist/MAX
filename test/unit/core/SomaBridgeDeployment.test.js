import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { SomaBridge } from '../../../core/SomaBridge.js';

describe('SomaBridge verified deployment', () => {
    let dir;
    let bridge;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'max-soma-bridge-'));
        bridge = new SomaBridge({ taskLedger: { dbPath: path.join(dir, 'tasks.db') } });
        bridge._available = true;
    });

    afterEach(async () => {
        bridge.tasks.close();
        await rm(dir, { recursive: true, force: true });
    });

    test('rejects invalid candidate code instead of claiming a staged success', async () => {
        const result = await bridge.deployToSoma('core/invalid-candidate.js', 'export const broken = ;');
        expect(result.success).toBe(false);
        expect(result.applied).toBe(false);
        expect(result.error).toMatch(/syntax failed/i);
        expect(bridge.tasks.get(result.taskId).status).toBe('failed');
    });
});
