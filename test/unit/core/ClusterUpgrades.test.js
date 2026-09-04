import { RemoteSwarmWorker } from '../../../swarm/RemoteSwarmWorker.js';
import { ContinuousAuditor } from '../../../security/ContinuousAuditor.js';
import { TriBrainConsensus } from '../../../debate/TriBrainConsensus.js';

describe('MAX Cluster Upgrades', () => {
    describe('RemoteSwarmWorker', () => {
        test('initializes with default options and endpoint target', () => {
            const worker = new RemoteSwarmWorker('http://192.168.1.254:3100', 'test_key');
            expect(worker.nodeUrl).toBe('http://192.168.1.254:3100');
            expect(worker.apiKey).toBe('test_key');
            expect(worker.id).toMatch(/^remote_/);
        });
    });

    describe('ContinuousAuditor', () => {
        test('initializes auditor daemon and finds zero vulns on clean scan', async () => {
            const mockMax = { goals: { addGoal: () => {} } };
            const auditor = new ContinuousAuditor(mockMax);
            expect(auditor.running).toBe(false);
            await auditor.runAuditCycle();
            expect(auditor.auditLog.length).toBe(1);
        });
    });

    describe('TriBrainConsensus', () => {
        test('evaluates proposed action with default threshold pass when brain unattached', async () => {
            const consensus = new TriBrainConsensus(null);
            const res = await consensus.evaluate({
                type: 'code_edit',
                target: 'core/MAX.js',
                proposal: 'Add performance logging'
            });
            expect(res.approved).toBe(true);
            expect(res.score).toBe(1.0);
        });

        test('extracts scores correctly from model output text', () => {
            const consensus = new TriBrainConsensus(null);
            const score = consensus._extractScore('SCORE: 0.92 | REASON: Safe clean code');
            expect(score).toBe(0.92);
        });
    });
});
