import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutiveCoderSupervisor } from '../../../core/ExecutiveCoderSupervisor.js';
import { SomaMemoryMiner } from '../../../tools/SomaMemoryMiner.js';

test('ExecutiveCoderSupervisor unit tests', async (t) => {
    const supervisor = new ExecutiveCoderSupervisor();

    await t.test('validates valid JavaScript syntax', () => {
        const validCode = `
            function add(a, b) {
                return a + b;
            }
            export default add;
        `;
        const res = supervisor.validateSyntax(validCode, 'test.js');
        assert.equal(res.valid, true);
        assert.equal(res.language, 'javascript');
    });

    await t.test('detects malformed JavaScript syntax and returns line error', () => {
        const brokenCode = `
            function broken() {
                const x = 10;
                if (x > 5 {
                    return true;
                }
            }
        `;
        const res = supervisor.validateSyntax(brokenCode, 'broken.js');
        assert.equal(res.valid, false);
        assert.ok(res.error.length > 0);
    });

    await t.test('validates and rejects broken JSON', () => {
        const validJson = '{"key": "value", "count": 42}';
        const brokenJson = '{"key": "value", count: 42}';
        
        assert.equal(supervisor.validateSyntax(validJson, 'config.json').valid, true);
        assert.equal(supervisor.validateSyntax(brokenJson, 'config.json').valid, false);
    });

    await t.test('extracts function and class signatures cleanly', () => {
        const source = `
            import { Brain } from './Brain.js';
            export class TestEngine extends BaseEngine {
                constructor() {}
                async executeTask(params) {
                    return true;
                }
            }
            export function helperFn(a, b) {
                return a * b;
            }
        `;
        const sigs = supervisor.extractSignatures(source);
        assert.ok(sigs.includes('import { Brain } from \'./Brain.js\';'));
        assert.ok(sigs.includes('export class TestEngine extends BaseEngine'));
        assert.ok(sigs.includes('async executeTask(params)'));
        assert.ok(sigs.includes('export function helperFn(a, b)'));
    });

    await t.test('decomposes full file proposal into minimal replacement chunk', () => {
        const original = [
            'function alpha() { return 1; }',
            'function target() { return "old"; }',
            'function beta() { return 2; }'
        ].join('\n');

        const proposal = [
            'function alpha() { return 1; }',
            'function target() { return "NEW_UPGRADE"; }',
            'function beta() { return 2; }'
        ].join('\n');

        const diff = supervisor.decomposeToReplacement(original, proposal);
        assert.equal(diff.modified, true);
        assert.equal(diff.startLine, 2);
        assert.equal(diff.endLine, 2);
        assert.equal(diff.targetContent, 'function target() { return "old"; }');
        assert.equal(diff.replacementContent, 'function target() { return "NEW_UPGRADE"; }');
    });
});

test('SomaMemoryMiner discovery tests', async (t) => {
    const miner = new SomaMemoryMiner();
    const discovery = miner.discoverSomaAssets();
    assert.equal(discovery.found, true);
    assert.ok(discovery.assets.arbiters.length > 50);
    assert.ok(discovery.assets.tests.length > 10);
});
