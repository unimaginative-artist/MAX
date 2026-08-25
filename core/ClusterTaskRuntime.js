import { createHash, createHmac, randomUUID } from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import os from 'os';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);
const KINDS = new Set(['reason', 'verify', 'swarm', 'soma_improvement']);
const clip = (value, max = 40_000) => String(value ?? '').slice(0, max);

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function hash(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function within(root, candidate) {
    const base = path.resolve(root);
    const target = path.resolve(candidate);
    const baseKey = process.platform === 'win32' ? base.toLowerCase() : base;
    const targetKey = process.platform === 'win32' ? target.toLowerCase() : target;
    return targetKey === baseKey || targetKey.startsWith(baseKey + path.sep);
}

function errorWithCode(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

export class ClusterTaskRuntime {
    constructor(max, options = {}) {
        this.max = max;
        this.role = String(options.role || process.env.MAX_CLUSTER_ROLE || 'standalone').toLowerCase();
        this.nodeId = String(options.nodeId || process.env.MAX_NODE_ID || `max-${process.env.COMPUTERNAME || 'local'}`).slice(0, 100);
        this.stateDir = path.resolve(options.stateDir || path.join(process.cwd(), '.max', 'cluster-tasks'));
        this.maxConcurrent = Math.max(1, Math.min(4, Number(options.maxConcurrent || process.env.MAX_WORKER_CONCURRENCY || 1)));
        this.defaultLeaseMs = Math.max(10_000, Math.min(15 * 60_000, Number(options.defaultLeaseMs || 120_000)));
        this.workerCloudAllowed = options.workerCloudAllowed ?? process.env.MAX_WORKER_ALLOW_CLOUD === 'true';
        this.secret = String(options.secret || process.env.MAX_CLUSTER_SECRET || '');
        this.tasks = new Map();
        this.idempotency = new Map();
        this.controllers = new Map();
        this.running = 0;
        this.initialized = false;
        const configuredRoots = String(options.allowedRoots || process.env.MAX_WORKER_ALLOWED_ROOTS || '')
            .split(';').map(item => item.trim()).filter(Boolean);
        this.allowedRoots = [...new Set([
            process.cwd(),
            path.resolve(process.cwd(), '..', 'SOMA'),
            ...configuredRoots
        ].map(item => path.resolve(item)))];
    }

    async initialize() {
        if (this.initialized) return;
        await fsp.mkdir(this.stateDir, { recursive: true });
        const files = await fsp.readdir(this.stateDir).catch(() => []);
        for (const name of files.filter(file => file.endsWith('.json'))) {
            try {
                const task = JSON.parse(await fsp.readFile(path.join(this.stateDir, name), 'utf8'));
                if (!task?.id) continue;
                if (task.status === 'running' || task.status === 'queued') {
                    task.status = 'failed';
                    task.error = 'Worker restarted before the task produced a receipt';
                    task.finishedAt = new Date().toISOString();
                }
                this.tasks.set(task.id, task);
                if (task.idempotencyKey) this.idempotency.set(task.idempotencyKey, task.id);
            } catch { /* ignore corrupt receipt; it is not executable evidence */ }
        }
        this.initialized = true;
    }

    getStatus() {
        const counts = {};
        for (const task of this.tasks.values()) counts[task.status] = (counts[task.status] || 0) + 1;
        return {
            role: this.role,
            nodeId: this.nodeId,
            ready: this.initialized,
            cloudAllowed: this.role !== 'worker' || this.workerCloudAllowed,
            maxConcurrent: this.maxConcurrent,
            running: this.running,
            counts,
            capabilities: ['reason', 'verify', 'swarm', 'soma_improvement'],
            resources: { cpuCores: os.cpus().length, freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem(), platform: process.platform },
            models: [this.max?.brain?.getStatus?.().fast?.model, this.max?.agentBrain?.getStatus?.().fast?.model].filter(Boolean),
            protocolVersion: 2
        };
    }

    getTask(id) {
        const task = this.tasks.get(String(id));
        return task ? this._publicTask(task) : null;
    }

    async submit(payload = {}, context = {}) {
        await this.initialize();
        if (this.role !== 'worker') throw errorWithCode('This MAX node is not configured as a worker', 'ROLE_CONFLICT');
        const kind = String(payload.kind || 'reason').toLowerCase();
        if (!KINDS.has(kind)) throw errorWithCode(`Unsupported cluster task kind: ${kind}`, 'INVALID_TASK');
        const prompt = clip(payload.prompt || payload.description || payload.title, 80_000).trim();
        if (!prompt && kind !== 'verify') throw errorWithCode('Task prompt or description is required', 'INVALID_TASK');

        const normalized = {
            kind,
            title: clip(payload.title || kind, 300),
            prompt,
            command: clip(payload.command, 2_000),
            cwd: clip(payload.cwd, 1_000),
            files: Array.isArray(payload.files) ? payload.files.slice(0, 12).map(file => clip(file, 1_000)) : [],
            context: clip(payload.context, 60_000),
            task: payload.task && typeof payload.task === 'object' ? payload.task : null,
            requestedTier: clip(payload.tier || 'fast', 20),
            maxTokens: Math.max(64, Math.min(8_192, Number(payload.maxTokens || 2_048)))
        };
        const idempotencyKey = clip(context.idempotencyKey || payload.idempotencyKey || hash(normalized), 128);
        const existingId = this.idempotency.get(idempotencyKey);
        if (existingId) {
            const existing = this.tasks.get(existingId);
            if (existing) return { task: this._publicTask(existing), deduplicated: true };
        }

        const now = Date.now();
        const leaseMs = Math.max(10_000, Math.min(15 * 60_000, Number(context.leaseMs || this.defaultLeaseMs)));
        const task = {
            id: randomUUID(),
            idempotencyKey,
            kind,
            title: normalized.title,
            payload: normalized,
            status: 'queued',
            coordinatorId: clip(context.coordinatorId || 'unknown-coordinator', 100),
            workerId: this.nodeId,
            leaseOwner: clip(context.leaseOwner || context.coordinatorId || 'unknown-coordinator', 100),
            leaseExpiresAt: now + leaseMs,
            createdAt: new Date(now).toISOString(),
            startedAt: null,
            finishedAt: null,
            receipt: null,
            error: null
        };
        this.tasks.set(task.id, task);
        this.idempotency.set(idempotencyKey, task.id);
        await this._persist(task);
        queueMicrotask(() => this._drain());
        return { task: this._publicTask(task), deduplicated: false };
    }

    async renew(id, leaseOwner, leaseMs = this.defaultLeaseMs) {
        const task = this.tasks.get(String(id));
        if (!task) throw errorWithCode('Task not found', 'NOT_FOUND');
        if (TERMINAL.has(task.status)) return this._publicTask(task);
        if (task.leaseOwner && task.leaseOwner !== leaseOwner) throw errorWithCode('Lease is owned by another coordinator', 'LEASE_CONFLICT');
        task.leaseOwner = clip(leaseOwner, 100);
        task.leaseExpiresAt = Date.now() + Math.max(10_000, Math.min(15 * 60_000, Number(leaseMs || this.defaultLeaseMs)));
        await this._persist(task);
        return this._publicTask(task);
    }

    async cancel(id, reason = 'Cancelled by coordinator') {
        const task = this.tasks.get(String(id));
        if (!task) throw errorWithCode('Task not found', 'NOT_FOUND');
        if (TERMINAL.has(task.status)) return this._publicTask(task);
        this.controllers.get(task.id)?.abort();
        task.status = 'cancelled';
        task.error = clip(reason, 2_000);
        task.finishedAt = new Date().toISOString();
        await this._persist(task);
        return this._publicTask(task);
    }

    async _drain() {
        if (this.running >= this.maxConcurrent) return;
        const next = [...this.tasks.values()].find(task => task.status === 'queued');
        if (!next) return;
        if (next.leaseExpiresAt <= Date.now()) {
            next.status = 'expired';
            next.error = 'Coordinator lease expired before execution started';
            next.finishedAt = new Date().toISOString();
            await this._persist(next);
            queueMicrotask(() => this._drain());
            return;
        }
        this.running++;
        this._execute(next).finally(() => {
            this.running--;
            queueMicrotask(() => this._drain());
        });
    }

    async _execute(task) {
        const controller = new AbortController();
        this.controllers.set(task.id, controller);
        task.status = 'running';
        task.startedAt = new Date().toISOString();
        await this._persist(task);
        const leaseTimer = setInterval(() => {
            if (task.leaseExpiresAt <= Date.now()) controller.abort();
        }, 1_000);
        leaseTimer.unref?.();

        try {
            const result = await this._runPayload(task.payload, controller.signal);
            if (controller.signal.aborted) throw errorWithCode('Task lease expired or task was cancelled', 'LEASE_EXPIRED');
            const resultHash = hash(result);
            task.status = 'completed';
            const promotionBundle = task.kind === 'soma_improvement' ? await this._promotionBundle(task.payload, result) : null;
            const receipt = {
                protocolVersion: 2,
                taskId: task.id,
                idempotencyKey: task.idempotencyKey,
                coordinatorId: task.coordinatorId,
                workerId: this.nodeId,
                kind: task.kind,
                result,
                resultHash,
                promotionBundle,
                verifiedAt: new Date().toISOString(),
                governance: task.kind === 'soma_improvement'
                    ? { promotionAllowed: false, requiresSomaPipeline: true }
                    : null
            };
            const signedFields = { taskId: receipt.taskId, workerId: receipt.workerId, kind: receipt.kind, resultHash, verifiedAt: receipt.verifiedAt, promotionBundle };
            receipt.signatureAlgorithm = 'hmac-sha256';
            receipt.signature = this.secret ? createHmac('sha256', this.secret).update(JSON.stringify(stable(signedFields))).digest('hex') : null;
            task.receipt = receipt;
            task.error = null;
        } catch (error) {
            if (task.status !== 'cancelled') {
                task.status = error?.code === 'LEASE_EXPIRED' || controller.signal.aborted ? 'expired' : 'failed';
                task.error = clip(error?.message || error, 4_000);
            }
        } finally {
            clearInterval(leaseTimer);
            this.controllers.delete(task.id);
            task.finishedAt = task.finishedAt || new Date().toISOString();
            await this._persist(task);
        }
    }

    async _runPayload(payload, signal) {
        if (payload.kind === 'verify') return this._runVerification(payload);
        if (payload.kind === 'swarm') {
            if (!this.max?.swarm?.run) throw new Error('Worker swarm runtime is unavailable');
            const swarmTask = payload.task || { name: payload.title, subtasks: [{ id: 'worker', prompt: payload.prompt, tier: 'fast' }] };
            swarmTask.subtasks = (swarmTask.subtasks || []).slice(0, 4).map(subtask => ({ ...subtask, tier: this.workerCloudAllowed ? (subtask.tier || 'fast') : 'fast' }));
            return this.max.swarm.run(swarmTask);
        }

        let evidence = payload.context || '';
        if (payload.files.length) evidence += await this._readEvidence(payload.files);
        const tier = this.workerCloudAllowed ? payload.requestedTier : 'fast';
        const systemPrompt = payload.kind === 'soma_improvement'
            ? 'You are a remote MAX engineering worker. Produce an evidence-grounded SOMA improvement proposal, not an applied change. State files inspected, root cause, exact patch strategy, tests, risks, and rollback. Never claim a file was changed. The coordinator must submit any patch through SOMA governance.'
            : 'You are a remote MAX worker. Return a concrete, evidence-grounded result. Do not claim tools or files were used unless they appear in the supplied evidence.';
        const prompt = payload.kind === 'soma_improvement'
            ? `SOMA IMPROVEMENT REQUEST\n${payload.prompt}\n\nWORKER EVIDENCE\n${clip(evidence, 80_000)}`
            : `${payload.prompt}\n\nEVIDENCE\n${clip(evidence, 80_000)}`;
        const answer = await this.max?.agentBrain?.think?.(prompt, { systemPrompt, tier, maxTokens: payload.maxTokens, signal });
        const text = clip(answer?.text, 120_000).trim();
        if (!text) throw new Error('Worker model returned no result');
        return { text, model: answer?.metadata?.model || null, backend: answer?.metadata?.backend || null, tokens: answer?.metadata?.tokens || 0 };
    }

    async _readEvidence(files) {
        const chunks = [];
        for (const requested of files) {
            const candidate = path.resolve(requested);
            if (!this.allowedRoots.some(root => within(root, candidate))) throw new Error(`File is outside worker allowlist: ${requested}`);
            const stat = await fsp.stat(candidate);
            if (!stat.isFile()) throw new Error(`Evidence path is not a file: ${requested}`);
            const content = await fsp.readFile(candidate, 'utf8');
            chunks.push(`\n\nFILE ${candidate}\n${clip(content, 24_000)}`);
        }
        return chunks.join('');
    }

    async _promotionBundle(payload, result) {
        const sources = [];
        for (const requested of payload.files || []) {
            const candidate = path.resolve(requested);
            if (!this.allowedRoots.some(root => within(root, candidate))) continue;
            const content = await fsp.readFile(candidate).catch(() => null);
            if (content) sources.push({ path: candidate, sha256: createHash('sha256').update(content).digest('hex') });
        }
        return {
            schemaVersion: 1,
            requestHash: hash({ prompt: payload.prompt, context: payload.context }),
            proposalHash: hash(result),
            sources,
            requiredTests: Array.isArray(payload.requiredTests) ? payload.requiredTests.slice(0, 20) : [],
            rollback: { required: true, strategy: 'SOMA governed transaction rollback' },
            risk: payload.risk || 'unassessed',
            staleIfSourceHashChanges: true
        };
    }

    async _runVerification(payload) {
        const command = payload.command.trim();
        if (!command) throw new Error('Verification command is required');
        if (/[;&|><`]/.test(command) || !/^(npm\s+(test|run\s+[\w:.-]+)|node\s+(--test|--check)\b|git\s+(status|diff)\b|npx\s+jest\b)/i.test(command)) {
            throw new Error('Verification command is outside the remote-worker allowlist');
        }
        const cwd = path.resolve(payload.cwd || process.cwd());
        if (!this.allowedRoots.some(root => within(root, cwd))) throw new Error('Verification cwd is outside the worker allowlist');
        const result = await this.max?.tools?.execute?.('shell', 'run', { command, cwd, timeoutMs: 15 * 60_000 });
        if (!result || result.success === false || Number(result.code ?? 0) !== 0) throw new Error(`Verification failed: ${clip(result?.stderr || result?.error || result?.stdout, 8_000)}`);
        return { command, cwd, code: Number(result.code || 0), stdout: clip(result.stdout, 40_000), stderr: clip(result.stderr, 8_000) };
    }

    _publicTask(task) {
        return {
            id: task.id,
            idempotencyKey: task.idempotencyKey,
            kind: task.kind,
            title: task.title,
            status: task.status,
            coordinatorId: task.coordinatorId,
            workerId: task.workerId,
            leaseOwner: task.leaseOwner,
            leaseExpiresAt: task.leaseExpiresAt,
            createdAt: task.createdAt,
            startedAt: task.startedAt,
            finishedAt: task.finishedAt,
            receipt: task.receipt,
            error: task.error
        };
    }

    async _persist(task) {
        await fsp.mkdir(this.stateDir, { recursive: true });
        const target = path.join(this.stateDir, `${task.id}.json`);
        const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
        await fsp.writeFile(temp, JSON.stringify(task, null, 2));
        await fsp.rename(temp, target);
    }
}

export default ClusterTaskRuntime;
