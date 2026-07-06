import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { BridgeTaskLedger } from '../../../core/BridgeTaskLedger.js';

describe('BridgeTaskLedger', () => {
    let dir;
    let ledger;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), 'max-bridge-ledger-'));
        ledger = new BridgeTaskLedger({ dbPath: path.join(dir, 'tasks.db') });
    });
    afterEach(async () => { ledger.close(); await rm(dir, { recursive: true, force: true }); });

    test('deduplicates equivalent active tasks', () => {
        const a = ledger.create({ type: 'goal.inject', payload: { title: 'Fix', priority: 1 } });
        const b = ledger.create({ type: 'goal.inject', payload: { priority: 1, title: 'Fix' } });
        expect(a.created).toBe(true);
        expect(b.created).toBe(false);
        expect(b.task.id).toBe(a.task.id);
    });

    test('records lifecycle evidence', () => {
        const { task } = ledger.create({ type: 'code.deploy', payload: { file: 'core/test.js' } });
        expect(ledger.beginAttempt(task.id).attempts).toBe(1);
        ledger.transition(task.id, 'accepted', { evidence: { receipt: 'one' } });
        const done = ledger.transition(task.id, 'completed', { evidence: { tests: 'passed' } });
        expect(done.evidence.tests).toBe('passed');
    });

    test('enforces retry and hop budgets', () => {
        const { task } = ledger.create({ type: 'goal.inject', payload: { title: 'Bounded' }, maxAttempts: 1, maxHops: 1 });
        ledger.beginAttempt(task.id);
        expect(ledger.retry(task.id, 'timeout').status).toBe('failed');
        expect(() => ledger.beginAttempt(task.id)).toThrow(/budget exhausted/);
    });

    test('expires overdue tasks', () => {
        const { task } = ledger.create({ type: 'goal.inject', payload: { title: 'Expire' }, ttlMs: 1 });
        ledger.expire(task.deadlineAt + 1);
        expect(ledger.get(task.id).status).toBe('expired');
    });
});
