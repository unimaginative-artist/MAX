import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
    createFileCheckpoint,
    resolveSomaFilePath,
    restoreFileCheckpoint,
    verifySomaWorkingTree,
} from '../../../core/SomaController.js';

describe('SomaController deployment safety', () => {
    let root;
    let backups;

    beforeEach(async () => {
        root = await mkdtemp(path.join(os.tmpdir(), 'max-soma-root-'));
        backups = await mkdtemp(path.join(os.tmpdir(), 'max-soma-backups-'));
    });

    afterEach(async () => {
        await Promise.all([
            rm(root, { recursive: true, force: true }),
            rm(backups, { recursive: true, force: true }),
        ]);
    });

    it('rejects parent traversal and sibling-prefix paths', () => {
        expect(() => resolveSomaFilePath(root, '../outside.js')).toThrow(/outside root/);
        expect(() => resolveSomaFilePath(root, `${root}-evil/file.js`)).toThrow(/outside root/);
    });

    it('restores the exact pre-change bytes from a checkpoint', async () => {
        const target = path.join(root, 'module.js');
        const original = Buffer.from('export const value = 1;\r\n', 'utf8');
        await writeFile(target, original);

        const checkpoint = await createFileCheckpoint({
            rootDir: root,
            filePath: 'module.js',
            backupDir: backups,
            taskId: 'test-checkpoint',
            gitHead: 'abc123',
        });
        await writeFile(target, 'export const value = 999;\n');
        const result = await restoreFileCheckpoint(checkpoint);

        expect(result.restored).toBe(true);
        expect(await readFile(target)).toEqual(original);
    });

    it('runs syntax and the real project smoke command', async () => {
        await writeFile(path.join(root, 'module.js'), 'export const value = 1;\n');
        await writeFile(path.join(root, 'smoke.mjs'), 'console.log("smoke passed");\n');
        await writeFile(path.join(root, 'package.json'), JSON.stringify({
            type: 'module',
            scripts: { 'soma:test': 'node smoke.mjs' },
        }));

        const result = await verifySomaWorkingTree(root, 'module.js');
        expect(result.passed).toBe(true);
        expect(result.checks.map(check => check.name)).toEqual(['syntax', 'soma_smoke']);
    });

    it('rejects a candidate when the project smoke command fails', async () => {
        await writeFile(path.join(root, 'module.js'), 'export const value = 1;\n');
        await writeFile(path.join(root, 'smoke.mjs'), 'process.exit(7);\n');
        await writeFile(path.join(root, 'package.json'), JSON.stringify({
            type: 'module',
            scripts: { 'soma:test': 'node smoke.mjs' },
        }));

        const result = await verifySomaWorkingTree(root, 'module.js');
        expect(result.passed).toBe(false);
        expect(result.checks.find(check => check.name === 'soma_smoke')?.passed).toBe(false);
    });
});
