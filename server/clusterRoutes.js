import express from 'express';
import { timingSafeEqual } from 'crypto';

function sameSecret(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function createClusterRoutes(max, options = {}) {
    const router = express.Router();
    const clusterSecret = String(options.clusterSecret || process.env.MAX_CLUSTER_SECRET || '');
    const previousSecret = String(process.env.MAX_CLUSTER_SECRET_PREVIOUS || '');
    const apiKey = String(options.apiKey || '');
    const allowlist = String(process.env.MAX_CLUSTER_ALLOWLIST || '').split(',').map(v => v.trim()).filter(Boolean);
    const rate = new Map();

    router.use((req, res, next) => {
        const ip = String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
        if (allowlist.length && !allowlist.includes(ip)) return res.status(403).json({ error: 'Cluster source is not allowlisted' });
        const now = Date.now();
        const bucket = rate.get(ip) || { start: now, count: 0 };
        if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0; }
        bucket.count++;
        rate.set(ip, bucket);
        if (bucket.count > 120) return res.status(429).json({ error: 'Cluster rate limit exceeded' });
        const auth = String(req.headers.authorization || '');
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        const providedCluster = req.headers['x-max-cluster-secret'] || req.headers['x-cluster-secret'];
        let coordinatorHost = '192.168.1.254';
        try {
            if (process.env.SOMA_URL) coordinatorHost = new URL(process.env.SOMA_URL).hostname;
        } catch {}
        const nodeId = String(req.headers['x-max-node-id'] || req.headers['x-coordinator-id'] || '');
        const isCoordinator = (ip === '192.168.1.254' || ip === coordinatorHost || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') &&
            Boolean(nodeId);

        const primeKey = process.env.MAX_PRIME_API_KEY || '';
        const envApiKey = process.env.MAX_API_KEY || '';
        const isAuthorizedSecret = sameSecret(providedCluster, clusterSecret) ||
            sameSecret(providedCluster, previousSecret) ||
            sameSecret(bearer || req.headers['x-api-key'], apiKey) ||
            (primeKey && sameSecret(bearer || req.headers['x-api-key'], primeKey)) ||
            (envApiKey && sameSecret(bearer || req.headers['x-api-key'], envApiKey));

        if (isAuthorizedSecret || isCoordinator) return next();
        return res.status(401).json({ error: 'Unauthorized cluster request' });

    });

    router.get('/status', (_req, res) => {
        res.json({
            ...(max.clusterTasks?.getStatus?.() || { role: max.clusterRole || 'standalone', ready: false }),
            coordinator: max.remoteSwarm?.getStatus?.() || null
            ,controlPlane: max.clusterControl?.status?.() || null
        });
    });

    // SOMA calls the coordinator here.  The remote worker may analyze and
    // propose, but its receipt explicitly forbids direct promotion.
    router.post('/soma-improvement', async (req, res) => {
        try {
            if (String(max.clusterRole || '').toLowerCase() === 'worker') {
                return res.status(409).json({ error: 'Worker nodes cannot coordinate SOMA improvements' });
            }
            if (max.clusterControl && !max.clusterControl.acquireLeadership('coordinator')) return res.status(409).json({ error: 'This node does not hold the coordinator lease' });
            const request = String(req.body?.request || '').trim();
            if (!request) return res.status(400).json({ error: 'request is required' });

            let worker = max.remoteSwarm?.selectWorker?.('soma_improvement');
            if (!worker && max.remoteSwarm?.remoteWorkers) {
                await Promise.allSettled([...max.remoteSwarm.remoteWorkers.keys()].map(id => max.remoteSwarm.refreshWorker(id)));
                worker = max.remoteSwarm.selectWorker('soma_improvement');
            }
            if (!worker) return res.status(503).json({ error: 'No online SOMA improvement worker is available' });

            const task = await max.remoteSwarm.dispatchSomaImprovement(worker.id, request, {
                title: req.body.title,
                files: Array.isArray(req.body.files) ? req.body.files : [],
                context: req.body.context,
                timeoutMs: req.body.timeoutMs,
                idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey
            });
            res.json({ success: true, workerId: worker.id, task });
        } catch (error) {
            res.status(502).json({ error: error.message, code: 'REMOTE_SOMA_DELEGATION_FAILED' });
        }
    });

    router.post('/control/:action', async (req, res) => {
        try {
            if (String(max.clusterRole || '').toLowerCase() === 'worker') return res.status(409).json({ error: 'Worker nodes cannot coordinate controls' });
            const action = req.params.action;
            if (action === 'pause') return res.json({ success: true, coordinator: max.remoteSwarm.setPaused(true) });
            if (action === 'resume') return res.json({ success: true, coordinator: max.remoteSwarm.setPaused(false) });
            if (action === 'refresh') {
                const workers = await Promise.all([...max.remoteSwarm.remoteWorkers.keys()].map(id => max.remoteSwarm.refreshWorker(id)));
                return res.json({ success: true, workers });
            }
            if (action === 'cancel') return res.json({ success: true, result: await max.remoteSwarm.cancelRemoteTask(req.body.workerId, req.body.taskId, req.body.reason) });
            return res.status(400).json({ error: 'Unknown cluster control action' });
        } catch (error) {
            return res.status(502).json({ error: error.message });
        }
    });

    router.post('/tasks', async (req, res) => {
        try {
            if (Buffer.byteLength(JSON.stringify(req.body || {})) > 512 * 1024) return res.status(413).json({ error: 'Cluster task payload exceeds 512KB' });
            const result = await max.clusterTasks.submit(req.body, {
                coordinatorId: req.headers['x-max-node-id'] || req.body.coordinatorId,
                leaseOwner: req.headers['x-max-node-id'] || req.body.leaseOwner,
                idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey,
                leaseMs: req.body.leaseMs
            });
            res.status(result.deduplicated ? 200 : 202).json(result);
        } catch (error) {
            const status = error.code === 'ROLE_CONFLICT' ? 409 : error.code === 'INVALID_TASK' ? 400 : 500;
            res.status(status).json({ error: error.message, code: error.code || 'CLUSTER_TASK_ERROR' });
        }
    });

    router.get('/tasks/:id', (req, res) => {
        const task = max.clusterTasks?.getTask?.(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json({ task });
    });

    router.post('/tasks/:id/lease', async (req, res) => {
        try {
            const owner = req.headers['x-max-node-id'] || req.body.leaseOwner;
            const task = await max.clusterTasks.renew(req.params.id, String(owner || ''), req.body.leaseMs);
            res.json({ task });
        } catch (error) {
            const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'LEASE_CONFLICT' ? 409 : 500;
            res.status(status).json({ error: error.message, code: error.code });
        }
    });

    router.post('/tasks/:id/cancel', async (req, res) => {
        try {
            const task = await max.clusterTasks.cancel(req.params.id, req.body.reason);
            res.json({ task });
        } catch (error) {
            res.status(error.code === 'NOT_FOUND' ? 404 : 500).json({ error: error.message, code: error.code });
        }
    });

    return router;
}

export default createClusterRoutes;
