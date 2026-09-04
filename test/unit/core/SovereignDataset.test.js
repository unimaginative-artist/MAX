import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Sovereign 3-Tier Dataset verification', async (t) => {
    const dataDir = path.join(process.cwd(), '.max', 'dataset');
    const alpacaPath = path.join(dataDir, 'sovereign_v2_alpaca.json');
    const shareGptPath = path.join(dataDir, 'sovereign_v2_sharegpt.json');
    const dpoPath = path.join(dataDir, 'sovereign_v2_dpo.json');

    await t.test('Alpaca format dataset exists and is non-empty', () => {
        assert.ok(fs.existsSync(alpacaPath), 'Alpaca file must exist');
        const data = JSON.parse(fs.readFileSync(alpacaPath, 'utf8'));
        assert.ok(Array.isArray(data) && data.length > 500, 'Must have >500 records');
        assert.ok(data[0].instruction);
        assert.ok(data[0].output);
    });

    await t.test('ShareGPT format dataset exists and has system turns', () => {
        assert.ok(fs.existsSync(shareGptPath), 'ShareGPT file must exist');
        const data = JSON.parse(fs.readFileSync(shareGptPath, 'utf8'));
        assert.ok(Array.isArray(data) && data.length > 500, 'Must have >500 records');
        assert.ok(data[0].conversations);
        assert.equal(data[0].conversations[0].from, 'system');
    });

    await t.test('DPO format dataset contains valid contrastive pairs', () => {
        assert.ok(fs.existsSync(dpoPath), 'DPO file must exist');
        const data = JSON.parse(fs.readFileSync(dpoPath, 'utf8'));
        assert.ok(Array.isArray(data) && data.length > 500, 'Must have >500 pairs');
        assert.ok(data[0].prompt);
        assert.ok(data[0].chosen);
        assert.ok(data[0].rejected);
        assert.notEqual(data[0].chosen, data[0].rejected, 'Chosen and rejected must be distinct');
    });
});
