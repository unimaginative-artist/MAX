import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const suiteArg = process.argv[2];
const forwardedArgs = process.argv.slice(3);

if (!suiteArg) {
    console.error('Usage: node scripts/run-jest-suite.mjs <suite-directory> [jest args]');
    process.exit(2);
}

const suiteDir = path.resolve(root, suiteArg);

function findTests(directory) {
    const tests = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) tests.push(...findTests(fullPath));
        else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.test.js')) tests.push(fullPath);
    }
    return tests;
}

const tests = findTests(suiteDir).sort();
if (tests.length === 0) {
    console.error(`No test files found under ${suiteDir}`);
    process.exit(1);
}

const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
const result = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', jestBin, '--runTestsByPath', ...tests, ...forwardedArgs],
    { cwd: root, env: process.env, stdio: 'inherit' }
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);
