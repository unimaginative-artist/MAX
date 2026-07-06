import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { VirtualShell } from '../../../core/VirtualShell.js';

describe('VirtualShell explicit cwd', () => {
    let shell;
    let tempDir;

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'max-shell-'));
        shell = new VirtualShell();
        shell.start();
    });

    afterEach(async () => {
        shell.stop();
        await rm(tempDir, { recursive: true, force: true });
    });

    it('runs in the requested directory without changing persistent cwd', async () => {
        const command = 'node -e "console.log(process.cwd())"';
        const scoped = await shell.run(command, 10_000, null, false, tempDir);
        const persistent = await shell.run(command, 10_000);
        expect(path.resolve(scoped.stdout.trim())).toBe(path.resolve(tempDir));
        expect(path.resolve(persistent.stdout.trim())).toBe(path.resolve(process.cwd()));
    });
});
