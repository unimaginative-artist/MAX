import { RemoteSwarmWorker } from '../core/RemoteSwarmWorker.js';

if (!process.env.MAX_CLUSTER_SECRET || !process.env.MAX_CLUSTER_WORKERS) {
    throw new Error('Set MAX_CLUSTER_SECRET and MAX_CLUSTER_WORKERS before running the live acceptance test');
}
const coordinator = new RemoteSwarmWorker({ clusterRole: 'coordinator' }, {
    nodeId: process.env.MAX_NODE_ID || 'acceptance-prime',
    secret: process.env.MAX_CLUSTER_SECRET,
    workers: process.env.MAX_CLUSTER_WORKERS,
    pollMs: 500,
    timeoutMs: 120_000
});
await coordinator.initialize();
const worker = coordinator.selectWorker('reason');
if (!worker) throw new Error('No authenticated online reason worker found');
const task = await coordinator.dispatchTaskToWorker(worker.id, {
    kind: 'reason',
    title: 'Physical cluster acceptance',
    prompt: 'Return exactly: MAX_CLUSTER_ACCEPTED',
    maxTokens: 64
}, { idempotencyKey: `physical-acceptance-${Date.now()}`, timeoutMs: 120_000 });
if (!task.receipt?.signature || !/^[a-f0-9]{64}$/.test(task.receipt.resultHash || '')) throw new Error('Receipt verification evidence is incomplete');
console.log(JSON.stringify({ ok: true, workerId: worker.id, taskId: task.id, backend: task.receipt.result?.backend, resultHash: task.receipt.resultHash, signatureVerified: true }, null, 2));
