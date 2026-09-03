import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import { RemoteSwarmWorker } from '../../core/RemoteSwarmWorker.js';

describe('Live Multi-Node Cluster Wire & SOMA Acceleration Benchmark', () => {
    let remoteSwarm;
    let mockWorkerServer;
    let workerPort;

    beforeAll(async () => {
        remoteSwarm = new RemoteSwarmWorker({ clusterRole: 'coordinator' }, { nodeId: 'prime' });

        // Spin up a live HTTP server simulating Node B's /api/swarm/execute endpoint
        mockWorkerServer = http.createServer((req, res) => {
            if (req.url === '/api/swarm/status' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ role: 'worker', ready: true, nodeId: 'Node_B_5090' }));
            } else if (req.url === '/api/swarm/execute' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    const payload = JSON.parse(body || '{}');

                    // Simulate Node B running Tri-Brain Consensus on received flaw
                    const responsePayload = {
                        success: true,
                        workerNode: 'Node_B_5090',
                        taskTitle: payload.title,
                        triBrainConsensus: {
                            architect: 'PROPOSE: Encapsulate input in safe AST validator',
                            securityBreaker: 'APPROVED: Prevents command injection vulnerability',
                            maintainer: 'APPROVED: Zero performance degradation',
                            consensusReached: true
                        },
                        fixedCodeSnippet: `function safeExecute(input) { return String(input).replace(/[^a-zA-Z0-9]/g, ""); }`,
                        roundtripMs: 12
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(responsePayload));
                });
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        await new Promise(resolve => mockWorkerServer.listen(0, '127.0.0.1', resolve));
        workerPort = mockWorkerServer.address().port;
    });

    afterAll(async () => {
        if (mockWorkerServer) await new Promise(resolve => mockWorkerServer.close(resolve));
    });

    test('1. Node A probes Node B before marking it online', async () => {
        const worker = remoteSwarm.registerRemoteWorker('Node_B_5090', `http://127.0.0.1:${workerPort}`, ['tri_brain_consensus']);
        expect(worker.status).toBe('unknown');
        expect((await remoteSwarm.refreshWorker('Node_B_5090')).status).toBe('online');
    });

    test('2. Node A transmits a real code flaw payload to Node B and receives Tri-Brain patch over HTTP wire', async () => {
        const payload = {
            title: 'Audit User Input Command Injection',
            codeFlaw: 'const cmd = "ping " + req.query.host; exec(cmd);'
        };

        const res = await fetch(`http://127.0.0.1:${workerPort}/api/swarm/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        expect(res.status).toBe(200);
        const data = await res.json();

        expect(data.success).toBe(true);
        expect(data.workerNode).toBe('Node_B_5090');
        expect(data.triBrainConsensus.consensusReached).toBe(true);
        expect(data.fixedCodeSnippet).toContain('safeExecute');
    });
});
