import { jest } from '@jest/globals';
import { ClusterTaskRuntime } from '../../../core/ClusterTaskRuntime.js';

describe('ClusterTaskRuntime rolling-upgrade compatibility', () => {
    test('verification uses the registered shell action when an older registry lacks resolveCall', async () => {
        const run = jest.fn(async () => ({ success: true, code: 0, stdout: 'syntax ok', stderr: '' }));
        const legacyRegistry = {
            execute: jest.fn(async () => ({ success: false, error: 'this.tools.resolveCall is not a function' })),
            get: name => name === 'shell' ? { actions: { run } } : null
        };
        const runtime = new ClusterTaskRuntime({ tools: legacyRegistry }, {
            role: 'worker',
            allowedRoots: process.cwd()
        });

        const result = await runtime._runVerification({
            command: 'node --check core/MAX.js',
            cwd: process.cwd()
        });

        expect(result.code).toBe(0);
        expect(result.stdout).toBe('syntax ok');
        expect(run).toHaveBeenCalledWith(expect.objectContaining({
            command: 'node --check core/MAX.js',
            cwd: process.cwd()
        }));
        expect(legacyRegistry.execute).not.toHaveBeenCalled();
    });
});
