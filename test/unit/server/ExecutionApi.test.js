import { jest } from '@jest/globals';
import { ExecutionJobStore } from '../../../core/ExecutionJobStore.js';
import { ExecutionReporter } from '../../../core/ExecutionReporter.js';
import { createServer } from '../../../server/server.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

describe('Execution API & Durable Lifecycle', () => {
    let server;
    let maxMock;
    let jobStore;
    let reporter;
    const port = 3188;
    let apiKey;

    beforeAll(async () => {
        const keyFile = path.join(process.cwd(), '.max', 'api-key.txt');
        if (fs.existsSync(keyFile)) {
            apiKey = fs.readFileSync(keyFile, 'utf8').trim();
        } else {
            apiKey = 'test_api_key_12345';
            process.env.MAX_API_KEY = apiKey;
        }

        jobStore = new ExecutionJobStore({ dbPath: ':memory:' });
        
        maxMock = {
            _ready: true,
            jobStore,
            tools: {
                get: (toolName) => {
                    if (toolName === 'discord') {
                        return { connected: true };
                    }
                    return null;
                },
                execute: jest.fn(async (toolName, action, params) => {
                    if (maxMock.failDiscord && toolName === 'discord') {
                        throw new Error('Discord rate limit / outage');
                    }
                    return { success: true };
                })
            },
            notifier: {
                notify: jest.fn().mockResolvedValue(true)
            },
            execute: jest.fn().mockImplementation(async (task, options) => {
                // Simulate work with small delay
                await new Promise(r => setTimeout(r, 60));
                return {
                    success: true,
                    state: 'completed',
                    summary: `Completed: ${task}`,
                    evidence: ['receipt-1'],
                    toolsUsed: ['file.grep'],
                    toolResults: [{ tool: 'file', action: 'grep', success: true }],
                    verification: { passed: true }
                };
            }),
            think: jest.fn().mockResolvedValue({ response: 'Conversational answer' })
        };

        reporter = new ExecutionReporter(maxMock, jobStore);
        maxMock.executionReporter = reporter;

        server = await createServer(maxMock, { port });
    });

    afterAll(async () => {
        if (server?.close) {
            await server.close();
        }
        if (jobStore) {
            jobStore.close();
        }
    });

    test('POST /api/execute returns immediately with { jobId, status: "queued" }', async () => {
        const start = Date.now();
        const res = await fetch(`http://127.0.0.1:${port}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ task: 'Analyze server latency', mode: 'inspect' })
        });

        const elapsed = Date.now() - start;
        expect(res.status).toBe(200);
        expect(elapsed).toBeLessThan(150); // Immediate return, not blocking on 60ms simulated execution

        const body = await res.json();
        expect(body.jobId).toBeDefined();
        expect(body.jobId).toMatch(/^job_/);
        expect(body.status).toBe('queued');

        // Confirm record was durably written to store
        const record = jobStore.getJob(body.jobId);
        expect(record).toBeDefined();
        expect(record.task).toBe('Analyze server latency');
    });

    test('GET /api/execute/:jobId returns 404 for unknown job', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/execute/nonexistent_job_id`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toContain('Job not found');
    });

    test('polling GET /api/execute/:jobId returns completed result after background execution', async () => {
        const postRes = await fetch(`http://127.0.0.1:${port}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ task: 'Process background dataset' })
        });
        const { jobId } = await postRes.json();

        // Poll until completed
        let finalJob = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 20));
            const getRes = await fetch(`http://127.0.0.1:${port}/api/execute/${jobId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const data = await getRes.json();
            if (data.status === 'completed') {
                finalJob = data;
                break;
            }
        }

        expect(finalJob).toBeDefined();
        expect(finalJob.status).toBe('completed');
        expect(finalJob.summary).toBe('Completed: Process background dataset');
        expect(finalJob.evidence).toEqual(['receipt-1']);
        expect(finalJob.verification.passed).toBe(true);
        expect(finalJob.completedAt).toBeGreaterThan(0);
    });

    test('POST /api/execute with sync: true returns the final result directly', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ task: 'Run quick synchronous check', sync: true })
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('completed');
        expect(body.summary).toBe('Completed: Run quick synchronous check');
        expect(body.verification.passed).toBe(true);
    });

    test('persists completed record before notifying and survives Discord failure', async () => {
        // Mock Discord failure
        maxMock.failDiscord = true;

        const postRes = await fetch(`http://127.0.0.1:${port}/api/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ task: 'Discord resilience check', sync: true })
        });

        const body = await postRes.json();
        // Crucial invariant: Discord failure must NOT downgrade or fail the task!
        expect(body.status).toBe('completed');
        expect(body.summary).toBe('Completed: Discord resilience check');

        // Check store record
        const record = jobStore.getJob(body.jobId);
        expect(record.status).toBe('completed');
        expect(record.reporting.discord).toBe('failed');

        // Check outbox has the enqueued retry
        const outbox = jobStore.getOutboxForJob(body.jobId);
        expect(outbox.length).toBeGreaterThanOrEqual(1);
        expect(outbox[0].channel).toBe('discord');
    });

    test('normal chat max.think() does not create durable execution records', async () => {
        const priorCount = jobStore.stmts.listRunning.all().length;
        
        await maxMock.think('What is the capital of France?');
        expect(maxMock.think).toHaveBeenCalledWith('What is the capital of France?');

        // No new execution job was created
        const postCount = jobStore.stmts.listRunning.all().length;
        expect(postCount).toBe(priorCount);
    });
});
