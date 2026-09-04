import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordUIFactory } from '../../../core/DiscordUIFactory.js';
import { DiscordCodeEvaluator } from '../../../core/DiscordCodeEvaluator.js';
import { DiscordDPOHarvester } from '../../../core/DiscordDPOHarvester.js';
import { DiscordStandupScheduler } from '../../../core/DiscordStandupScheduler.js';
import { DiscordFinanceRadar } from '../../../core/DiscordFinanceRadar.js';
import fs from 'node:fs';
import path from 'node:path';

test('DiscordUIFactory component generation', async (t) => {
    await t.test('creates formatted status embed with live gauges', () => {
        const embed = DiscordUIFactory.createStatusEmbed({
            clusterRole: 'coordinator',
            nodeId: 'max-prime',
            economics: { getTodaySpend: () => 0.00, dailyBudget: 1.00 }
        }, { somaUptimeHours: 183.5 });

        assert.ok(embed);
        assert.ok(embed.data.title.includes('MAX Sovereign Cluster Status'));
        assert.ok(embed.data.fields.length >= 3);
    });

    await t.test('creates action row with hot-deploy and sandbox buttons', () => {
        const row = DiscordUIFactory.createProposalActionRow('prop_123');
        assert.ok(row);
        assert.equal(row.components.length, 3);
        assert.equal(row.components[0].data.custom_id, 'btn_deploy_soma:prop_123');
        assert.equal(row.components[1].data.custom_id, 'btn_run_tests:prop_123');
    });

    await t.test('creates finance signal embed with color coding', () => {
        const buySignal = DiscordUIFactory.createFinanceSignalEmbed({
            symbol: 'SOL/USDT',
            action: 'buy',
            price: '185.50',
            confidence: 92,
            indicator: 'EMA Golden Cross'
        });
        assert.ok(buySignal);
        assert.ok(buySignal.data.title.includes('SOL/USDT'));
    });

    await t.test('creates daily standup embed with metrics', () => {
        const standup = DiscordUIFactory.createStandupEmbed({
            researchCount: 15,
            testsRun: 21,
            repairsCount: 4
        });
        assert.ok(standup);
        assert.ok(standup.data.title.includes('Sovereign Morning Standup'));
    });
});

test('DiscordCodeEvaluator sandboxed runner', async (t) => {
    await t.test('evaluates simple expressions and returns value', async () => {
        const code = 'const a = 10; const b = 20; a + b;';
        const res = await DiscordCodeEvaluator.evaluate(code);
        assert.equal(res.success, true);
        assert.equal(res.result, '30');
        assert.ok(res.executionTimeMs >= 0);
    });

    await t.test('captures console.log and error output in stdout', async () => {
        const code = 'console.log("Hello from VM!"); console.error("Test error message"); "done";';
        const res = await DiscordCodeEvaluator.evaluate(code);
        assert.equal(res.success, true);
        assert.ok(res.stdout.includes('Hello from VM!'));
        assert.ok(res.stdout.includes('[ERROR] Test error message'));
    });

    await t.test('extracts code blocks from markdown formatting', () => {
        const rawMsg = '@Max run this:\n```javascript\nconst x = 5 * 5;\nx;\n```';
        const extracted = DiscordCodeEvaluator.extractCode(rawMsg);
        assert.equal(extracted, 'const x = 5 * 5;\nx;');
    });
});

test('DiscordDPOHarvester active learning', async (t) => {
    const testDb = path.join(process.cwd(), '.max', 'dataset', 'test_dpo.json');
    const harvester = new DiscordDPOHarvester({ datasetPath: testDb });

    const mockReaction = {
        emoji: { name: '👍' },
        message: {
            id: 'msg_999',
            content: 'Here is the SOMA arbiter code.',
            channelId: 'ch_1',
            reference: null
        }
    };
    const mockUser = { id: 'user_barry', bot: false };
    const mockHistory = [{ role: 'user', content: 'Write a SOMA arbiter' }];

    const result = await harvester.handleReaction(mockReaction, mockUser, mockHistory);
    assert.equal(result.harvested, true);
    assert.equal(result.isPositive, true);
    assert.equal(result.entry.prompt, 'Write a SOMA arbiter');
    assert.equal(result.entry.chosen, 'Here is the SOMA arbiter code.');

    // Cleanup test db
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
});

test('DiscordStandupScheduler and FinanceRadar', async (t) => {
    const standupScheduler = new DiscordStandupScheduler();
    const standupEmbed = standupScheduler.buildStandupEmbed();
    assert.ok(standupEmbed);

    const radar = new DiscordFinanceRadar();
    const signalRes = await radar.dispatchSignal({
        symbol: 'BTC/USDT',
        action: 'breakout',
        price: '95000.00'
    });
    assert.ok(radar.signalsHistory.length > 0);
});
