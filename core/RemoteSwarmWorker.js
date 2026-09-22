import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('Remote worker URL is required');
    return (/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).replace(/\/$/, '');
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function hash(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export class RemoteSwarmWorker {
    constructor(max, config = {}) {
        this.max = max;
        this.config = config;
        this.nodeId = String(config.nodeId || process.env.MAX_NODE_ID || `max-${process.env.COMPUTERNAME || 'prime'}`);
        this.secret = String(config.secret || process.env.MAX_CLUSTER_SECRET || '');
        this.remoteWorkers = new Map();
        this.dispatchedTasks = [];
        this.workersCount = 0;
        this.pollMs = Math.max(200, Number(config.pollMs || 1_000));
        this.defaultTimeoutMs = Math.max(10_000, Number(config.timeoutMs || 20 * 60_000));
        this.leaseMs = Math.max(10_000, Number(config.leaseMs || 120_000));
        this.ledgerPath = path.resolve(config.ledgerPath || path.join(process.cwd(), '.max', 'cluster-dispatches.jsonl'));
        this.controlPlane = config.controlPlane || max?.clusterControl || null;
        this.paused = false;
    }

    async initialize() {
        const raw = String(this.config.workers || process.env.MAX_CLUSTER_WORKERS || '').trim();
        if (!raw) return this.getStatus();
        let workers;
        try {
            workers = JSON.parse(raw);
        } catch {
            workers = raw.split(',').map(item => {
                const [id, ...url] = item.split('=');
                return { id: id.trim(), url: url.join('=').trim() };
            });
        }
        for (const worker of Array.isArray(workers) ? workers : []) {
            if (!worker?.id || !(worker.url || worker.ipAddress)) continue;
            this.registerRemoteWorker(worker.id, worker.url || worker.ipAddress, worker.capabilities, worker);
        }
        await Promise.allSettled([...this.remoteWorkers.keys()].map(id => this.refreshWorker(id)));
        return this.getStatus();
    }

    registerRemoteWorker(workerId, ipAddress, capabilities = ['reason', 'verify', 'soma_improvement'], options = {}) {
        if (!workerId) throw new Error('workerId is required');
        const url = normalizeUrl(options.url || ipAddress);
        const existing = this.remoteWorkers.get(workerId);
        const workerRecord = {
            id: String(workerId),
            ipAddress: url,
            url,
            capabilities: Array.isArray(capabilities) && capabilities.length ? capabilities : ['reason', 'verify', 'soma_improvement'],
            status: existing?.status || 'unknown',
            registeredAt: existing?.registeredAt || new Date().toISOString(),
            lastSeenAt: existing?.lastSeenAt || null,
            completedTasks: existing?.completedTasks || 0,
            failedTasks: existing?.failedTasks || 0,
            apiKey: String(options.apiKey || ''),
            secret: String(options.secret || this.secret || '')
        };
        this.remoteWorkers.set(workerRecord.id, workerRecord);
        this.workersCount = this.remoteWorkers.size;
        console.log(`[RemoteSwarmWorker] Registered ${workerRecord.id} at ${workerRecord.url}`);
        return this._publicWorker(workerRecord);
    }

    async refreshWorker(workerId) {
        const worker = this._requireWorker(workerId);
        try {
            const response = await this._request(worker, 'GET', '/api/swarm/status', null, 8_000);
            worker.status = response.role === 'worker' && response.ready ? 'online' : 'misconfigured';
            worker.lastSeenAt = new Date().toISOString();
            worker.runtime = response;
        } catch (error) {
            worker.status = 'offline';
            worker.lastError = error.message;
        }
        return this._publicWorker(worker);
    }

    async dispatchTaskToWorker(workerId, taskPayload = {}, options = {}) {
        if (this.paused) throw new Error('Cluster dispatch is paused by the operator');
        const worker = this._requireWorker(workerId);
        const dispatchId = randomUUID();
        const idempotencyKey = String(options.idempotencyKey || taskPayload.idempotencyKey || hash({ workerId, taskPayload }));
        const timeoutMs = Math.max(10_000, Number(options.timeoutMs || taskPayload.timeoutMs || this.defaultTimeoutMs));
        const startedAt = Date.now();
        const record = {
            id: dispatchId,
            workerId,
            title: taskPayload.title || taskPayload.kind || 'Remote task',
            kind: taskPayload.kind || 'reason',
            idempotencyKey,
            status: 'dispatching',
            startedAt: new Date(startedAt).toISOString(),
            finishedAt: null,
            taskId: null,
            receipt: null,
            error: null
        };
        this.dispatchedTasks.push(record);
        this.controlPlane?.recordDispatch?.(record);
        this._appendLedger({ event: 'dispatch_started', ...record });

        try {
            const submission = await this._request(worker, 'POST', '/api/swarm/tasks', {
                ...taskPayload,
                coordinatorId: this.nodeId,
                leaseMs: this.leaseMs
            }, 20_000, { 'Idempotency-Key': idempotencyKey });
            const task = submission.task;
            if (!task?.id) throw new Error('Worker accepted the request without returning a task ID');
            record.taskId = task.id;
            record.status = task.status;

            let latest = task;
            let nextLeaseAt = Date.now() + Math.floor(this.leaseMs / 3);
            while (!TERMINAL.has(latest.status)) {
                if (Date.now() - startedAt > timeoutMs) {
                    await this._request(worker, 'POST', `/api/swarm/tasks/${task.id}/cancel`, { reason: `Coordinator timeout after ${timeoutMs}ms` }, 8_000).catch(() => {});
                    throw new Error(`Remote task timed out after ${timeoutMs}ms`);
                }
                if (Date.now() >= nextLeaseAt) {
                    const renewed = await this._request(worker, 'POST', `/api/swarm/tasks/${task.id}/lease`, { leaseMs: this.leaseMs }, 8_000);
                    latest = renewed.task || latest;
                    nextLeaseAt = Date.now() + Math.floor(this.leaseMs / 3);
                }
                await sleep(this.pollMs);
                const polled = await this._request(worker, 'GET', `/api/swarm/tasks/${task.id}`, null, 8_000);
                latest = polled.task;
            }

            record.status = latest.status;
            record.finishedAt = latest.finishedAt || new Date().toISOString();
            record.receipt = latest.receipt || null;
            record.error = latest.error || null;
            worker.lastSeenAt = new Date().toISOString();
            if (latest.status === 'completed' && latest.receipt?.resultHash) {
                this._verifyReceipt(worker, latest.receipt);
                worker.completedTasks++;
            }
            else worker.failedTasks++;
            this._appendLedger({ event: 'dispatch_finished', ...record });
            this.controlPlane?.recordDispatch?.(record);
            if (latest.status !== 'completed' || !latest.receipt?.resultHash) throw new Error(latest.error || `Remote task ended with status ${latest.status}`);
            return { ...latest, workerId, dispatchId, deduplicated: Boolean(submission.deduplicated) };
        } catch (error) {
            record.status = 'failed';
            record.error = error.message;
            record.finishedAt = new Date().toISOString();
            worker.status = 'degraded';
            worker.lastError = error.message;
            worker.failedTasks++;
            this._appendLedger({ event: 'dispatch_failed', ...record });
            this.controlPlane?.recordDispatch?.(record);
            throw error;
        }
    }

    async dispatchSomaImprovement(workerId, request, options = {}) {
        return this.dispatchTaskToWorker(workerId, {
            kind: 'soma_improvement',
            title: options.title || 'SOMA improvement analysis',
            prompt: request,
            files: options.files || [],
            context: options.context || '',
            maxTokens: options.maxTokens || 3_000,
            tier: options.tier || 'fast'
        }, options);
    }

    selectWorker(capability = null) {
        const candidates = [...this.remoteWorkers.values()]
            .filter(worker => worker.status === 'online' && (!capability || worker.capabilities.includes(capability)))
            .sort((a, b) => this._workerScore(b, capability) - this._workerScore(a, capability));
        return candidates[0] ? this._publicWorker(candidates[0]) : null;
    }

    _workerScore(worker) {
        const runtime = worker.runtime || {};
        const resources = runtime.resources || {};
        const freeGb = Number(resources.freeMemoryBytes || 0) / (1024 ** 3);
        const loadPenalty = Number(runtime.running || 0) / Math.max(1, Number(runtime.maxConcurrent || 1));
        return Math.min(8, freeGb) + Math.min(8, Number(resources.cpuCores || 0) / 2)
            + Math.min(5, worker.completedTasks * 0.1) - worker.failedTasks * 2 - loadPenalty * 5;
    }

    _verifyReceipt(worker, receipt) {
        if (!worker.secret) throw new Error('Cannot verify worker receipt without a cluster secret');
        if (receipt.signatureAlgorithm !== 'hmac-sha256' || !receipt.signature) throw new Error('Worker returned an unsigned receipt');
        const signedFields = { taskId: receipt.taskId, workerId: receipt.workerId, kind: receipt.kind, resultHash: receipt.resultHash, verifiedAt: receipt.verifiedAt, promotionBundle: receipt.promotionBundle || null };
        const expected = createHmac('sha256', worker.secret).update(JSON.stringify(stable(signedFields))).digest();
        const provided = Buffer.from(receipt.signature, 'hex');
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error('Worker receipt signature verification failed');
    }

    getStatus() {
        return {
            role: this.max?.clusterRole || process.env.MAX_CLUSTER_ROLE || 'standalone',
            nodeId: this.nodeId,
            activeRemoteWorkers: [...this.remoteWorkers.values()].filter(worker => worker.status === 'online').length,
            totalRemoteWorkers: this.remoteWorkers.size,
            totalTasksDispatched: this.dispatchedTasks.length,
            paused: this.paused,
            workers: [...this.remoteWorkers.values()].map(worker => this._publicWorker(worker)),
            recentTasks: this.dispatchedTasks.slice(-20)
        };
    }

    setPaused(paused) { this.paused = Boolean(paused); return this.getStatus(); }

    async cancelRemoteTask(workerId, taskId, reason = 'Operator emergency stop') {
        const worker = this._requireWorker(workerId);
        return this._request(worker, 'POST', `/api/swarm/tasks/${taskId}/cancel`, { reason }, 8_000);
    }

    _requireWorker(workerId) {
        const worker = this.remoteWorkers.get(String(workerId));
        if (!worker) throw new Error(`Remote worker node [${workerId}] is not registered`);
        return worker;
    }

    _headers(worker, extra = {}) {
        const headers = { 'Content-Type': 'application/json', 'X-Max-Node-Id': this.nodeId, ...extra };
        const secret = worker.secret || this.secret || process.env.MAX_CLUSTER_SECRET;
        const key = worker.apiKey || this.max?.apiKey || process.env.MAX_API_KEY || process.env.MAX_PRIME_API_KEY;
        if (secret) headers['X-Max-Cluster-Secret'] = secret;
        if (key) {
            headers.Authorization = `Bearer ${key}`;
            headers['X-Api-Key'] = key;
        }
        return headers;
    }

    async _request(worker, method, requestPath, body = null, timeoutMs = 10_000, extraHeaders = {}) {
        const response = await fetch(`${worker.url}${requestPath}`, {
            method,
            headers: this._headers(worker, extraHeaders),
            body: body == null ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs)
        });
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
        if (!response.ok) throw new Error(data.error || `Worker HTTP ${response.status}`);
        return data;
    }

    _publicWorker(worker) {
        const { secret, apiKey, ...safe } = worker;
        return safe;
    }

    _appendLedger(event) {
        try {
            mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
            if (existsSync(this.ledgerPath) && statSync(this.ledgerPath).size > 10 * 1024 * 1024) {
                const retained = readFileSync(this.ledgerPath, 'utf8').trim().split('\n').slice(-2_000).join('\n');
                writeFileSync(this.ledgerPath, retained ? `${retained}\n` : '');
            }
            appendFileSync(this.ledgerPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
        } catch { /* telemetry must not break dispatch */ }
    }
}

export default RemoteSwarmWorker;
