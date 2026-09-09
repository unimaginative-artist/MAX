import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RemoteSwarmWorker } from '../../../core/RemoteSwarmWorker.js';
import { ClusterTaskRuntime } from '../../../core/ClusterTaskRuntime.js';
import { createClusterRoutes } from '../../../server/clusterRoutes.js';

describe('RemoteSwarmWorker real protocol', () => {
    let server;
    let url;
    let stateDir;
    let client;
    const secret = 'unit-test-cluster-secret';
    const calls = [];

    before(async () => {
        stateDir = await mkdtemp(path.join(os.tmpdir(), 'max-cluster-test-'));
        const workerMax = {
            clusterRole: 'worker',
            agentBrain: {
                think: async (prompt, options) => {
                    calls.push({ prompt, options });
                    return { text: 'Grounded remote result', metadata: { model: 'local-test', backend: 'ollama', tokens: 12 } };
                }
            },
            tools: { execute: async () => ({ success: true, code: 0, stdout: 'verified', stderr: '' }) }
        };
        workerMax.clusterTasks = new ClusterTaskRuntime(workerMax, {
            role: 'worker', nodeId: 'worker_b', stateDir, defaultLeaseMs: 10_000, secret
        });
        await workerMax.clusterTasks.initialize();

        const app = express();
        app.use(express.json());
        app.use('/api/swarm', createClusterRoutes(workerMax, { clusterSecret: secret, apiKey: 'unused-api-key' }));
        server = createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        url = `http://127.0.0.1:${server.address().port}`;

        client = new RemoteSwarmWorker({ clusterRole: 'coordinator' }, {
            nodeId: 'prime_a', secret, pollMs: 10, timeoutMs: 10_000, ledgerPath: path.join(stateDir, 'dispatches.jsonl')
        });
    });

    after(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(stateDir, { recursive: true, force: true });
    });

    it('registers and probes a real worker endpoint', async () => {
        const worker = client.registerRemoteWorker('worker_b', url, ['reason', 'verify', 'soma_improvement']);
        assert.equal(worker.status, 'unknown');
        const refreshed = await client.refreshWorker('worker_b');
        assert.equal(refreshed.status, 'online');
        assert.equal(refreshed.runtime.role, 'worker');
    });

    it('dispatches over HTTP and requires a hashed completion receipt', async () => {
        const result = await client.dispatchTaskToWorker('worker_b', {
            kind: 'reason', title: 'Remote audit', prompt: 'Inspect the architecture'
        });
        assert.equal(result.status, 'completed');
        assert.equal(result.workerId, 'worker_b');
        assert.equal(result.receipt.result.text, 'Grounded remote result');
        assert.match(result.receipt.resultHash, /^[a-f0-9]{64}$/);
        assert.match(result.receipt.signature, /^[a-f0-9]{64}$/);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.tier, 'fast');
    });

    it('deduplicates the same task instead of spending twice', async () => {
        const payload = { kind: 'reason', title: 'Same task', prompt: 'Do this once', idempotencyKey: 'same-task-key' };
        const first = await client.dispatchTaskToWorker('worker_b', payload);
        const second = await client.dispatchTaskToWorker('worker_b', payload);
        assert.equal(second.id, first.id);
        assert.equal(second.deduplicated, true);
        assert.equal(calls.filter(call => call.prompt.includes('Do this once')).length, 1);
    });

    it('coordinates SOMA improvement analysis through the Prime endpoint', async () => {
        await client.refreshWorker('worker_b');
        const coordinatorMax = {
            clusterRole: 'coordinator',
            remoteSwarm: client,
            clusterTasks: { getStatus: () => ({ role: 'coordinator', ready: true }) }
        };
        const app = express();
        app.use(express.json());
        app.use('/api/swarm', createClusterRoutes(coordinatorMax, { clusterSecret: secret, apiKey: 'prime-api-key' }));
        const coordinatorServer = createServer(app);
        await new Promise(resolve => coordinatorServer.listen(0, '127.0.0.1', resolve));
        try {
            const response = await fetch(`http://127.0.0.1:${coordinatorServer.address().port}/api/swarm/soma-improvement`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer prime-api-key' },
                body: JSON.stringify({ request: 'Audit SOMA planning', context: 'supplied source evidence' })
            });
            const result = await response.json();
            assert.equal(response.status, 200);
            assert.equal(result.workerId, 'worker_b');
            assert.equal(result.task.receipt.governance.promotionAllowed, false);
            assert.equal(result.task.receipt.governance.requiresSomaPipeline, true);
            assert.equal(result.task.receipt.promotionBundle.staleIfSourceHashChanges, true);
        } finally {
            await new Promise(resolve => coordinatorServer.close(resolve));
        }
    });

    it('rejects unauthenticated cluster requests', async () => {
        const response = await fetch(`${url}/api/swarm/status`);
        assert.equal(response.status, 401);
    });
});
