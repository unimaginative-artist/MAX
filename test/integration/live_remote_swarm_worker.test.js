import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RemoteSwarmWorker } from '../../core/RemoteSwarmWorker.js';
import { ClusterTaskRuntime } from '../../core/ClusterTaskRuntime.js';
import { createClusterRoutes } from '../../server/clusterRoutes.js';

describe('Remote swarm HTTP integration', () => {
    let server, client, stateDir;
    const secret = 'integration-cluster-secret';

    beforeAll(async () => {
        stateDir = await mkdtemp(path.join(os.tmpdir(), 'max-live-worker-'));
        const workerMax = {
            clusterRole: 'worker',
            agentBrain: { think: async () => ({ text: 'remote audit complete', metadata: { backend: 'ollama', model: 'local-test' } }) },
            tools: { execute: async () => ({ success: true, code: 0, stdout: 'ok' }) }
        };
        workerMax.clusterTasks = new ClusterTaskRuntime(workerMax, { role: 'worker', nodeId: 'machine_b', stateDir, secret });
        await workerMax.clusterTasks.initialize();
        const app = express();
        app.use(express.json());
        app.use('/api/swarm', createClusterRoutes(workerMax, { clusterSecret: secret }));
        server = createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        client = new RemoteSwarmWorker({ clusterRole: 'coordinator' }, { nodeId: 'prime', secret, pollMs: 10 });
        client.registerRemoteWorker('machine_b', `http://127.0.0.1:${server.address().port}`, ['reason', 'verify']);
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(stateDir, { recursive: true, force: true });
    });

    test('probes before declaring a registered worker online', async () => {
        expect(client.getStatus().workers[0].status).toBe('unknown');
        expect((await client.refreshWorker('machine_b')).status).toBe('online');
    });

    test('dispatches a leased task and receives a verifiable receipt', async () => {
        const task = await client.dispatchTaskToWorker('machine_b', { kind: 'reason', title: 'Distributed AST audit', prompt: 'Audit this evidence' });
        expect(task.status).toBe('completed');
        expect(task.receipt.result.text).toBe('remote audit complete');
        expect(task.receipt.resultHash).toMatch(/^[a-f0-9]{64}$/);
    });
});
