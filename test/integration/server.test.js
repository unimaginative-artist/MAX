import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { createServer } from '../../server/server.js';

// Pin the API key so tests don't touch .max/api-key.txt
process.env.MAX_API_KEY = 'test_key_integration';

const API_KEY = 'test_key_integration';

// Any max property the server calls .on() on must be an EventEmitter (or have .on).
// Optional chaining `?.on(...)` only guards null/undefined — a plain object crashes.
function makeMax(overrides = {}) {
    const goals = {
        listActive:   jest.fn(() => []),
        addGoal:      jest.fn(() => 'goal_test_123'),
        complete:     jest.fn(() => true),
        getStatus:    jest.fn(() => ({ active: 0, completed: 0 })),
        listPending:  jest.fn(() => []),
    };

    const workspaceEdits = Object.assign(new EventEmitter(), {
        accept: jest.fn(async (id) => ({ success: true, id })),
        reject: jest.fn((id) => ({ success: true })),
    });

    const security = Object.assign(new EventEmitter(), {
        getStatus: () => ({ enabled: false }),
    });

    const swarm = Object.assign(new EventEmitter(), {
        getStatus: () => ({ activeJobs: 0 }),
    });

    return {
        _ready:         true,
        _context:       [],
        _chatQueue:     null,
        _chatBusy:      false,
        _lastError:     null,
        _ghostBuffers:  new Map(),
        goals,
        workspaceEdits,
        security,
        swarm,
        brain:     { getStatus: () => ({ fast: { ready: true }, smart: { ready: true, backend: 'ollama' }, code: { ready: true, backend: 'ollama' } }) },
        economics: { getBudgetStatus: () => ({ used: 0, cap: 10, overBudget: false }), isOverBudget: () => false },
        mcp:       { getStatus: () => ({ count: 0 }) },
        artifacts: { list: () => [] },
        getStatus:      jest.fn(() => ({
            drive:    { tension: 0.3, satisfaction: 0.7 },
            persona:  { name: 'architect' },
            kb:       { sources: 0 },
            outcomes: { totalTokens: 0, avgLatency: 0, success: 0, total: 0 },
            economics: { netProfit: '$0.00', earnings: '$0.00', totalCost: '$0.00' },
            soma:     { available: false }
        })),
        getQuickStatus: undefined,
        ...overrides
    };
}

let server, port, baseUrl;

beforeAll(async () => {
    port = 55500 + Math.floor(Math.random() * 100);
    const max = makeMax();
    server = await createServer(max, port);
    baseUrl = `http://localhost:${port}`;
}, 15000);

afterAll(async () => {
    await server?.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function get(path, opts = {}) {
    return fetch(`${baseUrl}${path}`, opts);
}
async function post(path, body, opts = {}) {
    const { headers: extraHeaders, ...rest } = opts;
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(body),
        ...rest
    });
}

const authHeaders = { 'Authorization': `Bearer ${API_KEY}` };

describe('Server integration', () => {
    describe('GET /health — public, no auth required', () => {
        it('returns 200 with status field', async () => {
            const res = await get('/health');
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe('healthy');
            expect(body.ready).toBe(true);
            expect(body.version).toBe('1.0.0');
        });

        it('includes systems.brain info', async () => {
            const res  = await get('/health');
            const body = await res.json();
            expect(body.systems.brain.fast).toBe(true);
            expect(body.systems.brain.smart).toBe(true);
        });

        it('includes memory stats', async () => {
            const res  = await get('/health');
            const body = await res.json();
            expect(typeof body.systems.memory.heapUsedMb).toBe('number');
            expect(typeof body.systems.memory.heapTotalMb).toBe('number');
        });

        it('returns 503 when max is not ready', async () => {
            const notReadyMax = makeMax({ _ready: false });
            const s = await createServer(notReadyMax, port + 50);
            try {
                const res  = await fetch(`http://localhost:${port + 50}/health`);
                const body = await res.json();
                expect(res.status).toBe(503);
                expect(body.status).toBe('degraded');
            } finally {
                await s.close();
            }
        });
    });

    describe('Auth middleware', () => {
        it('returns 401 on protected route without key', async () => {
            const res = await get('/api/me');
            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error).toBe('Unauthorized');
        });

        it('returns 200 on protected route with Bearer token', async () => {
            const res = await get('/api/me', { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.ok).toBe(true);
            expect(typeof body.keyHint).toBe('string');
        });

        it('accepts key via X-Api-Key header', async () => {
            const res = await get('/api/me', { headers: { 'X-Api-Key': API_KEY } });
            expect(res.status).toBe(200);
        });

        it('accepts key via ?apiKey query param', async () => {
            const res = await get(`/api/me?apiKey=${API_KEY}`);
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/status', () => {
        it('returns status object with cwd', async () => {
            const res  = await get('/api/status', { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(typeof body.cwd).toBe('string');
            expect(body.drive).toBeDefined();
        });
    });

    describe('Goals CRUD', () => {
        it('GET /api/goals returns empty array initially', async () => {
            const res  = await get('/api/goals', { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body)).toBe(true);
        });

        it('POST /api/goals creates a goal and returns id', async () => {
            const res  = await post('/api/goals', { title: 'Test goal', priority: 0.8 }, { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(typeof body.id).toBe('string');
            expect(body.title).toBe('Test goal');
        });

        it('POST /api/goals returns 400 when title is missing', async () => {
            const res = await post('/api/goals', { priority: 0.5 }, { headers: authHeaders });
            expect(res.status).toBe(400);
        });

        it('DELETE /api/goals/:id removes a goal', async () => {
            const res  = await fetch(`${baseUrl}/api/goals/goal_test_123`, { method: 'DELETE', headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.ok).toBe(true);
        });
    });

    describe('Workspace edit approval', () => {
        it('POST /api/workspace-edits/:id/accept calls workspaceEdits.accept()', async () => {
            const res  = await post('/api/workspace-edits/edit_test_abc/accept', {}, { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
        });

        it('POST /api/workspace-edits/:id/reject calls workspaceEdits.reject()', async () => {
            const res  = await post('/api/workspace-edits/edit_test_abc/reject', {}, { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
        });
    });

    describe('SOMA proposal queue', () => {
        it('GET /api/soma/proposals returns empty array initially', async () => {
            const res  = await get('/api/soma/proposals', { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body)).toBe(true);
        });

        it('POST /api/soma/propose queues a proposal', async () => {
            const proposal = { taskId: 'abc123def456', file: 'core/Brain.js', newCode: 'export class Brain {}', rationale: 'test' };
            const res  = await post('/api/soma/propose', proposal, { headers: authHeaders });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.received).toBe(true);
            expect(body.taskId).toBe('abc123def456');
        });

        it('POST /api/soma/propose returns 400 when required fields missing', async () => {
            const res = await post('/api/soma/propose', { taskId: 'x' }, { headers: authHeaders });
            expect(res.status).toBe(400);
        });
    });
});
