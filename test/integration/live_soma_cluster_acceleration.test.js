import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import { createServer } from 'http';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { RemoteSwarmWorker } from '../../core/RemoteSwarmWorker.js';
import { ClusterTaskRuntime } from '../../core/ClusterTaskRuntime.js';
import { createClusterRoutes } from '../../server/clusterRoutes.js';

describe('SOMA improvement cluster integration', () => {
    let workerServer, primeServer, stateDir;
    const secret = 'soma-cluster-integration-secret';

    beforeAll(async () => {
        stateDir = await mkdtemp(path.join(os.tmpdir(), 'max-soma-worker-'));
        const worker = {
            clusterRole: 'worker',
            agentBrain: { think: async () => ({ text: 'proposal with tests and rollback', metadata: { backend: 'ollama', model: 'local-test' } }) },
            tools: { execute: async () => ({ success: true, code: 0 }) }
        };
        worker.clusterTasks = new ClusterTaskRuntime(worker, { role: 'worker', nodeId: 'machine_b', stateDir, secret });
        await worker.clusterTasks.initialize();
        const workerApp = express();
        workerApp.use(express.json());
        workerApp.use('/api/swarm', createClusterRoutes(worker, { clusterSecret: secret }));
        workerServer = createServer(workerApp);
        await new Promise(resolve => workerServer.listen(0, '127.0.0.1', resolve));

        const remoteSwarm = new RemoteSwarmWorker({ clusterRole: 'coordinator' }, { nodeId: 'prime', secret, pollMs: 10 });
        remoteSwarm.registerRemoteWorker('machine_b', `http://127.0.0.1:${workerServer.address().port}`, ['soma_improvement']);
        await remoteSwarm.refreshWorker('machine_b');
        const prime = { clusterRole: 'coordinator', remoteSwarm, clusterTasks: { getStatus: () => ({ role: 'coordinator', ready: true }) } };
        const primeApp = express();
        primeApp.use(express.json());
        primeApp.use('/api/swarm', createClusterRoutes(prime, { apiKey: 'prime-api-key', clusterSecret: secret }));
        primeServer = createServer(primeApp);
        await new Promise(resolve => primeServer.listen(0, '127.0.0.1', resolve));
    });

    afterAll(async () => {
        await new Promise(resolve => primeServer.close(resolve));
        await new Promise(resolve => workerServer.close(resolve));
        await rm(stateDir, { recursive: true, force: true });
    });

    test('Prime delegates SOMA analysis while forbidding worker promotion', async () => {
        const response = await fetch(`http://127.0.0.1:${primeServer.address().port}/api/swarm/soma-improvement`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer prime-api-key' },
            body: JSON.stringify({ request: 'Improve the business planning pipeline', context: 'source evidence' })
        });
        const result = await response.json();
        expect(response.status).toBe(200);
        expect(result.workerId).toBe('machine_b');
        expect(result.task.receipt.resultHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.task.receipt.governance).toEqual({ promotionAllowed: false, requiresSomaPipeline: true });
    });
});
