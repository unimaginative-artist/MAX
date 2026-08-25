import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
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

    beforeAll(async () => {
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

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(stateDir, { recursive: true, force: true });
    });

    test('registers and probes a real worker endpoint', async () => {
        const worker = client.registerRemoteWorker('worker_b', url, ['reason', 'verify', 'soma_improvement']);
        expect(worker.status).toBe('unknown');
        const refreshed = await client.refreshWorker('worker_b');
        expect(refreshed.status).toBe('online');
        expect(refreshed.runtime.role).toBe('worker');
    });

    test('dispatches over HTTP and requires a hashed completion receipt', async () => {
        const result = await client.dispatchTaskToWorker('worker_b', {
            kind: 'reason', title: 'Remote audit', prompt: 'Inspect the architecture'
        });
        expect(result.status).toBe('completed');
        expect(result.workerId).toBe('worker_b');
        expect(result.receipt.result.text).toBe('Grounded remote result');
        expect(result.receipt.resultHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.receipt.signature).toMatch(/^[a-f0-9]{64}$/);
        expect(calls).toHaveLength(1);
        expect(calls[0].options.tier).toBe('fast');
    });

    test('deduplicates the same task instead of spending twice', async () => {
        const payload = { kind: 'reason', title: 'Same task', prompt: 'Do this once', idempotencyKey: 'same-task-key' };
        const first = await client.dispatchTaskToWorker('worker_b', payload);
        const second = await client.dispatchTaskToWorker('worker_b', payload);
        expect(second.id).toBe(first.id);
        expect(second.deduplicated).toBe(true);
        expect(calls.filter(call => call.prompt.includes('Do this once'))).toHaveLength(1);
    });

    test('coordinates SOMA improvement analysis through the Prime endpoint', async () => {
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
            expect(response.status).toBe(200);
            expect(result.workerId).toBe('worker_b');
            expect(result.task.receipt.resultHash).toMatch(/^[a-f0-9]{64}$/);
            expect(result.task.receipt.governance).toEqual({ promotionAllowed: false, requiresSomaPipeline: true });
            expect(result.task.receipt.promotionBundle.staleIfSourceHashChanges).toBe(true);
        } finally {
            await new Promise(resolve => coordinatorServer.close(resolve));
        }
    });

    test('rejects unauthenticated cluster requests', async () => {
        const response = await fetch(`${url}/api/swarm/status`);
        expect(response.status).toBe(401);
    });
});
