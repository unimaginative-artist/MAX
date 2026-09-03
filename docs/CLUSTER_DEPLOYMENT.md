# MAX two-computer cluster

MAX now uses a coordinator/worker topology. Only Max Prime runs autonomous schedules, creates goals, talks to paid cloud models, and submits SOMA changes. A worker accepts authenticated leased tasks and returns durable hashed receipts.

## Required configuration

Generate a fresh secret with `node scripts/generate-cluster-secret.mjs`, then set the same value in each computer's environment. Do not reuse the example from chat and do not commit it. The runtime variable is `MAX_CLUSTER_ROLE`, not `MAX_ROLE`.

On the Prime computer:

```powershell
$env:MAX_CLUSTER_SECRET = '<shared secret>'
$env:MAX_CLUSTER_WORKERS = 'machine_b=http://192.168.1.250:3100'
$env:MAX_NODE_ID = 'max-prime'
.\start-cluster-prime.bat
```

On the worker computer:

```powershell
$env:MAX_CLUSTER_SECRET = '<shared secret>'
$env:MAX_NODE_ID = 'machine_b'
$env:MAX_HOST = '0.0.0.0'
.\start-cluster-worker.bat
```

Allow inbound TCP 3100 from the Prime computer only. Do not expose port 3100 to the public internet.

## Runtime contract

- `GET /api/swarm/status` reports role, node identity, capabilities, and queue state.
- `POST /api/swarm/tasks` creates or deduplicates a leased task.
- `POST /api/swarm/tasks/:id/lease` renews ownership while the coordinator polls.
- `GET /api/swarm/tasks/:id` returns state and, only after real execution, a SHA-256 result receipt.
- `POST /api/swarm/tasks/:id/cancel` aborts work after coordinator timeout.
- `POST /api/swarm/soma-improvement` makes Prime select a healthy worker and waits for a receipt-backed advisory proposal.

Worker mode disables heartbeat, Scheduler, Oracle, SovereignLoop, external integrations, and eager goals. Cloud fallback is disabled unless `MAX_WORKER_ALLOW_CLOUD=true` is explicitly set.

## SOMA improvement flow

SOMA's existing `MaintenanceBridge` now calls Max Prime automatically. Prime selects Machine B, obtains an evidence-grounded analysis, and injects the verified receipt and proposal into its SOMA goal. If Machine B is offline, Prime continues without remote assistance. The worker may produce a patch strategy, tests, risks, and rollback instructions, but its receipt explicitly forbids promotion. Prime must send any resulting change through SOMA's `SelfModificationPipeline`, where isolation, independent review, probation, and rollback remain authoritative.

## Verification

From Prime, ask Max for `TOOL:cluster:status:{}` and verify Machine B is `online`. Then dispatch a small local-only task. A successful response must include a 64-character `receipt.resultHash`; a registration message alone is not proof of execution.

For the physical acceptance test run `node scripts/test-cluster-live.mjs` on Prime. Success requires authenticated execution on Machine B plus a verified HMAC receipt. The Command Bridge **MAX Cluster** tab exposes worker resources, queues, receipts, refresh, and emergency pause.

## Safe synchronization

Do not use `git add .` in a dirty MAX worktree. Commit only reviewed cluster files, or transfer the reviewed folder through an existing trusted sync mechanism. Bind port 3100 to the LAN only behind Windows Firewall or a WireGuard/private network. Alternatively set `MAX_TLS_CERT` and `MAX_TLS_KEY` to enable HTTPS directly, and use an `https://` worker URL. Set `MAX_CLUSTER_ALLOWLIST` to Prime's LAN address. Rotate secrets by placing the old value temporarily in `MAX_CLUSTER_SECRET_PREVIOUS`, restarting both nodes with the new primary secret, and then removing the previous value.
