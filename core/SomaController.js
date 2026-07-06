// ═══════════════════════════════════════════════════════════════════════════
// SomaController.js — MAX's mechanical interface to SOMA's server
// Handles: stop, start, health polling, git checkpoint, file apply, revert
// NO LLM reasoning in this file. Every action is deterministic and scripted.
// ═══════════════════════════════════════════════════════════════════════════

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, extname, relative, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function resolveDefaultSomaDir() {
    if (process.env.SOMA_DIR && existsSync(process.env.SOMA_DIR)) return process.env.SOMA_DIR;

    const candidates = [
        join(__dirname, '../../SOMA'),
        'C:/Users/barry/Desktop/The Stack/SOMA',
        'C:/Users/barry/Desktop/SOMA'
    ];

    return candidates.find(candidate => existsSync(candidate)) || candidates[0];
}

let resolvedSomaDir = resolveDefaultSomaDir();

const SOMA_DIR   = resolvedSomaDir;
const SOMA_URL   = process.env.SOMA_URL   || 'http://127.0.0.1:3001';
const SOMA_START = process.env.SOMA_START || 'launcher_ULTRA.mjs';
const SOMA_LOG_DIR = process.env.MAX_SOMA_LOG_DIR || join(__dirname, '../.max/logs');
const SOMA_LOG = join(SOMA_LOG_DIR, 'soma.log');
const SOMA_LOG_MAX_BYTES = Number(process.env.MAX_SOMA_LOG_MAX_BYTES) || 2_000_000;
const SOMA_DEPLOYMENT_DIR = process.env.MAX_SOMA_DEPLOYMENT_DIR || join(__dirname, '../.max/soma-deployments');

let somaProcess = null;
let somaLogStream = null;
let lastSpawnError = null;
let lastExit = null;

function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}

function safeId(value = '') {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || `deployment-${Date.now()}`;
}

export function resolveSomaFilePath(rootDir, filePath) {
    const root = resolve(rootDir);
    const absolute = resolve(root, filePath);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`SOMA file path outside root: ${filePath}`);
    }
    return { absolute, relative: rel.replace(/\\/g, '/') };
}

export async function createFileCheckpoint({ rootDir, filePath, backupDir, taskId, gitHead = null }) {
    const target = resolveSomaFilePath(rootDir, filePath);
    const original = await readFile(target.absolute);
    const checkpointDir = join(backupDir, safeId(taskId));
    await mkdir(checkpointDir, { recursive: true });
    const backupPath = join(checkpointDir, `${safeId(target.relative)}.original`);
    await writeFile(backupPath, original);

    const checkpoint = {
        taskId,
        file: target.relative,
        targetPath: target.absolute,
        backupPath,
        originalHash: sha256(original),
        originalBytes: original.length,
        gitHead,
        createdAt: new Date().toISOString(),
    };
    checkpoint.manifestPath = join(checkpointDir, 'checkpoint.json');
    await writeFile(checkpoint.manifestPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    return checkpoint;
}

export async function restoreFileCheckpoint(checkpoint) {
    if (!checkpoint?.backupPath || !checkpoint?.targetPath) throw new Error('Invalid SOMA checkpoint');
    const original = await readFile(checkpoint.backupPath);
    if (sha256(original) !== checkpoint.originalHash) throw new Error('Checkpoint backup hash mismatch');
    const tempPath = `${checkpoint.targetPath}.max-restore-${process.pid}`;
    await writeFile(tempPath, original);
    await rename(tempPath, checkpoint.targetPath);
    const restored = await readFile(checkpoint.targetPath);
    if (sha256(restored) !== checkpoint.originalHash) throw new Error('Restored SOMA file hash mismatch');
    return { restored: true, hash: checkpoint.originalHash, bytes: restored.length };
}

export async function verifySomaWorkingTree(rootDir, filePath, { runSmoke = true, timeoutMs = 120_000 } = {}) {
    const target = resolveSomaFilePath(rootDir, filePath);
    const extension = extname(target.absolute).toLowerCase();
    const checks = [];
    const run = async (name, executable, args, timeout = timeoutMs) => {
        const started = Date.now();
        try {
            const result = await execFileAsync(executable, args, { cwd: rootDir, timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
            checks.push({ name, passed: true, durationMs: Date.now() - started, stdout: String(result.stdout || '').slice(-3000), stderr: String(result.stderr || '').slice(-3000) });
        } catch (error) {
            checks.push({ name, passed: false, durationMs: Date.now() - started, stdout: String(error.stdout || '').slice(-3000), stderr: String(error.stderr || error.message || '').slice(-3000) });
        }
    };

    if (['.js', '.cjs', '.mjs'].includes(extension)) {
        await run('syntax', process.execPath, ['--check', target.absolute], 30_000);
    } else if (extension === '.json') {
        try {
            JSON.parse(await readFile(target.absolute, 'utf8'));
            checks.push({ name: 'json_parse', passed: true, durationMs: 0, stdout: '', stderr: '' });
        } catch (error) {
            checks.push({ name: 'json_parse', passed: false, durationMs: 0, stdout: '', stderr: error.message });
        }
    } else {
        checks.push({ name: 'supported_file_type', passed: false, durationMs: 0, stdout: '', stderr: `Unsupported SOMA deployment type: ${extension || '(none)'}` });
    }

    if (runSmoke && checks.every(check => check.passed)) {
        if (process.platform === 'win32') {
            await run('soma_smoke', process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', 'run', 'soma:test']);
        } else {
            await run('soma_smoke', 'npm', ['run', 'soma:test']);
        }
    }

    return { passed: checks.length > 0 && checks.every(check => check.passed), file: target.relative, checks };
}

function getSomaEndpoint() {
    try {
        const url = new URL(SOMA_URL);
        return {
            host: url.hostname,
            port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
            local: ['localhost', '127.0.0.1', '::1'].includes(url.hostname),
        };
    } catch {
        return { host: '127.0.0.1', port: 3001, local: true };
    }
}

async function rotateSomaLog() {
    await mkdir(SOMA_LOG_DIR, { recursive: true });
    try {
        const info = await stat(SOMA_LOG);
        if (info.size < SOMA_LOG_MAX_BYTES) return;
        await unlink(`${SOMA_LOG}.1`).catch(() => {});
        await rename(SOMA_LOG, `${SOMA_LOG}.1`);
    } catch { /* no existing log */ }
}

async function createReadyLogStream(logPath) {
    const stream = createWriteStream(logPath, { flags: 'a' });
    await new Promise((resolveOpen, rejectOpen) => {
        stream.once('open', resolveOpen);
        stream.once('error', rejectOpen);
    });
    return stream;
}

async function killWindowsListeners(port) {
    if (process.platform !== 'win32') return;
    const { stdout = '' } = await execFileAsync('netstat', ['-ano', '-p', 'tcp']).catch(() => ({ stdout: '' }));
    const pids = new Set();
    for (const line of stdout.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        const localAddress = columns[1] || '';
        const state = columns[3] || '';
        const pid = columns[4] || '';
        if (localAddress.endsWith(`:${port}`) && state.toUpperCase() === 'LISTENING' && /^\d+$/.test(pid)) {
            pids.add(pid);
        }
    }
    await Promise.all([...pids].map(pid =>
        execFileAsync('taskkill', ['/f', '/t', '/pid', pid]).catch(() => {})
    ));
}

// ─── Health check ─────────────────────────────────────────────────────────
export async function isSomaHealthy(timeoutMs = 5000) {
    try {
        const res = await Promise.race([
            fetch(`${SOMA_URL}/health`),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
        ]);
        const data = await res.json().catch(() => ({}));
        return res.ok && data.status === 'healthy';
    } catch {
        return false;
    }
}

// ─── Poll until healthy or timeout ────────────────────────────────────────
export async function pollReady(totalMs = 45000, intervalMs = 2000) {
    const deadline = Date.now() + totalMs;
    while (Date.now() < deadline) {
        if (await isSomaHealthy()) return true;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

// ─── Stop SOMA ────────────────────────────────────────────────────────────
export async function stopSoma() {
    try {
        // Try graceful shutdown first
        await fetch(`${SOMA_URL}/api/shutdown`, { method: 'POST' }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        if (somaProcess) {
            try { somaProcess.kill(); } catch {}
            somaProcess = null;
        }
        const endpoint = getSomaEndpoint();
        if (endpoint.local) await killWindowsListeners(endpoint.port);
    } catch {
        // Best-effort — continue regardless
    }
    console.log('[SomaController] SOMA stopped.');
}

// ─── Start SOMA ───────────────────────────────────────────────────────────
export async function startSoma() {
    if (await isSomaHealthy()) {
        return { started: false, alreadyRunning: true, healthy: true, url: SOMA_URL };
    }

    const launcherPath = join(SOMA_DIR, SOMA_START);
    if (!existsSync(SOMA_DIR)) {
        throw new Error(`SOMA directory does not exist: ${SOMA_DIR}`);
    }
    if (!existsSync(launcherPath)) {
        throw new Error(`SOMA launcher does not exist: ${launcherPath}`);
    }
    if (somaProcess?.exitCode === null && !somaProcess.killed) {
        return { started: false, alreadyStarting: true, healthy: false, url: SOMA_URL };
    }

    await rotateSomaLog();
    somaLogStream = await createReadyLogStream(SOMA_LOG);
    somaLogStream.write(`\n[${new Date().toISOString()}] MAX starting SOMA from ${launcherPath}\n`);
    lastSpawnError = null;
    somaProcess = spawn(process.execPath, [SOMA_START], {
        cwd: SOMA_DIR,
        detached: true,
        stdio: ['ignore', somaLogStream, somaLogStream],
        windowsHide: true,
    });
    somaProcess.unref();
    somaProcess.on('error', err => {
        lastSpawnError = err.message;
        console.error('[SomaController] SOMA spawn error:', err.message);
    });
    somaProcess.on('exit', (code, signal) => {
        lastExit = { code, signal, ts: new Date().toISOString() };
        somaProcess = null;
        somaLogStream?.end();
        somaLogStream = null;
    });
    console.log('[SomaController] SOMA starting...');
    return { started: true, pid: somaProcess.pid, healthy: false, url: SOMA_URL };
}

export function getSomaConfig() {
    const endpoint = getSomaEndpoint();
    return { directory: SOMA_DIR, launcher: SOMA_START, url: SOMA_URL, ...endpoint, logPath: SOMA_LOG };
}

export async function getSomaDiagnostics(lines = 40) {
    const content = await readFile(SOMA_LOG, 'utf8').catch(() => '');
    return {
        ...getSomaConfig(),
        pid: somaProcess?.pid || null,
        managedRunning: !!somaProcess && somaProcess.exitCode === null && !somaProcess.killed,
        lastSpawnError,
        lastExit,
        recentLog: content.split(/\r?\n/).slice(-Math.max(1, lines)).join('\n').trim(),
    };
}

export async function probeSomaHealth(timeoutMs = 5000) {
    const started = Date.now();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${SOMA_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        const body = await response.json().catch(() => ({}));
        return { healthy: response.ok && body.status === 'healthy', status: response.status, latencyMs: Date.now() - started, body };
    } catch (error) {
        return { healthy: false, status: null, latencyMs: Date.now() - started, error: error.message };
    }
}

async function writeDeploymentReceipt(receipt) {
    await mkdir(SOMA_DEPLOYMENT_DIR, { recursive: true });
    const receiptPath = join(SOMA_DEPLOYMENT_DIR, `${safeId(receipt.taskId)}-${Date.now()}.json`);
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
    return receiptPath;
}

// ─── Byte-exact checkpoint with Git provenance ───────────────────────────
export async function gitCheckpoint(taskId, filePath) {
    const gitHeadResult = await execFileAsync('git', ['-C', SOMA_DIR, 'rev-parse', 'HEAD'], { windowsHide: true }).catch(() => null);
    const checkpoint = await createFileCheckpoint({
        rootDir: SOMA_DIR,
        filePath,
        backupDir: SOMA_DEPLOYMENT_DIR,
        taskId,
        gitHead: gitHeadResult?.stdout?.trim() || null,
    });
    console.log(`[SomaController] Checkpoint created for ${checkpoint.file} (${checkpoint.originalHash.slice(0, 12)})`);
    return checkpoint;
}

// ─── Apply file change (atomic write) ────────────────────────────────────
export async function applyChange(filePath, newCode) {
    const target = resolveSomaFilePath(SOMA_DIR, filePath);
    const tmpPath = `${target.absolute}.soma_tmp_${process.pid}`;
    await writeFile(tmpPath, newCode, 'utf8');
    await rename(tmpPath, target.absolute);
    console.log(`[SomaController] File written: ${target.relative}`);
}

// ─── Syntax check (no execution) ──────────────────────────────────────────
export async function syntaxCheck(filePath, newCode) {
    const target = resolveSomaFilePath(SOMA_DIR, filePath);
    const extension = extname(target.absolute).toLowerCase();
    await mkdir(join(SOMA_DEPLOYMENT_DIR, 'candidates'), { recursive: true });
    const tmpPath = join(SOMA_DEPLOYMENT_DIR, 'candidates', `${safeId(filePath)}-${Date.now()}${extension}`);
    try {
        await writeFile(tmpPath, newCode, 'utf8');
        if (['.js', '.cjs', '.mjs'].includes(extension)) {
            await execFileAsync(process.execPath, ['--check', tmpPath], { timeout: 30_000, windowsHide: true });
        } else if (extension === '.json') {
            JSON.parse(newCode);
        } else {
            return { ok: false, error: `Unsupported SOMA deployment type: ${extension || '(none)'}` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.stderr || err.message };
    } finally {
        await unlink(tmpPath).catch(() => {});
    }
}

// ─── Exact restore from checkpoint ────────────────────────────────────────
export async function revertLast(checkpoint) {
    try {
        await restoreFileCheckpoint(checkpoint);
        console.log(`[SomaController] Restored ${checkpoint.file} from checkpoint.`);
        return true;
    } catch (err) {
        console.error('[SomaController] Checkpoint restore failed:', err.message);
        return false;
    }
}

// ─── Full apply flow (the whole pipeline in one call) ────────────────────
// A change may lower the score by pure benchmark noise (latency jitter); only a
// drop beyond this counts as a real regression worth an automatic rollback.
const COGNITION_REGRESSION_TOLERANCE = 0.03;

/**
 * Run SOMA's deterministic cognition benchmark in --compare mode (does not
 * overwrite the standing baseline) and parse the composite + delta. Fail-open:
 * an infra error returns { measured: false } so a benchmark that can't run never
 * blocks a deploy whose health check already passed.
 */
async function runCognitionBenchmark(onLog = console.log) {
    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            ['scripts/cognition-benchmark.mjs', '--compare'],
            { cwd: SOMA_DIR, timeout: 180_000, windowsHide: true }
        );
        const composite = Number(stdout.match(/composite:\s*([0-9.]+)/)?.[1]);
        const deltaMatch = stdout.match(/composite:.*Δ\s*([+-]?[0-9.]+)\s*vs\s*([0-9.]+)/);
        const delta = deltaMatch ? Number(deltaMatch[1]) : NaN;
        const previousComposite = deltaMatch ? Number(deltaMatch[2]) : null;
        if (!Number.isFinite(composite)) {
            onLog('[MAX] Cognition benchmark produced no parseable score — gate skipped (fail-open).');
            return { measured: false };
        }
        onLog(`[MAX] Cognition composite ${composite}${Number.isFinite(delta) ? ` (Δ ${delta} vs ${previousComposite})` : ' (no prior baseline)'}`);
        return { measured: true, composite, delta, previousComposite };
    } catch (e) {
        onLog(`[MAX] Cognition benchmark could not run (${e.message}) — gate skipped (fail-open).`);
        return { measured: false, error: e.message };
    }
}

export async function applyProposal(proposal, onLog = console.log) {
    const { taskId, file, newCode } = proposal;
    if (!taskId || !file || typeof newCode !== 'string') {
        return { applied: false, reason: 'invalid_proposal', error: 'taskId, file, and newCode are required' };
    }

    const receipt = { taskId, file, startedAt: new Date().toISOString(), rationale: proposal.rationale || null };
    let checkpoint = null;
    let runtimeRestartAttempted = false;
    onLog(`[MAX] Beginning verified SOMA deployment for ${file} (task ${taskId.slice(0, 8)})`);

    try {
        onLog('[MAX] Step 1/8: Validating candidate syntax...');
        const syntax = await syntaxCheck(file, newCode);
        receipt.candidateSyntax = syntax;
        if (!syntax.ok) throw new Error(`Candidate syntax failed: ${syntax.error}`);

        onLog('[MAX] Step 2/8: Capturing runtime baseline...');
        receipt.baselineHealth = await probeSomaHealth();

        onLog('[MAX] Step 3/8: Creating byte-exact checkpoint...');
        checkpoint = await gitCheckpoint(taskId, file);
        receipt.checkpoint = checkpoint;

        onLog('[MAX] Step 4/8: Applying candidate atomically...');
        await applyChange(file, newCode);
        receipt.candidateHash = sha256(await readFile(resolveSomaFilePath(SOMA_DIR, file).absolute));

        onLog('[MAX] Step 5/8: Running independent SOMA verification...');
        receipt.verification = await verifySomaWorkingTree(SOMA_DIR, file);
        if (!receipt.verification.passed) throw new Error('Independent SOMA verification failed');

        onLog('[MAX] Step 6/8: Restarting SOMA...');
        runtimeRestartAttempted = true;
        await stopSoma();
        await startSoma();

        onLog('[MAX] Step 7/8: Verifying post-restart health...');
        if (!await pollReady(45_000)) throw new Error('SOMA failed post-deployment health check');
        receipt.postHealth = await probeSomaHealth();
        if (!receipt.postHealth.healthy) throw new Error('SOMA health endpoint is not healthy after restart');
        const baselineLatency = receipt.baselineHealth?.latencyMs;
        const postLatency = receipt.postHealth.latencyMs;
        const latencyLimit = Number.isFinite(baselineLatency)
            ? Math.max(baselineLatency * 3, baselineLatency + 2000)
            : null;
        receipt.healthComparison = {
            baselineLatencyMs: baselineLatency ?? null,
            postLatencyMs: postLatency,
            latencyLimitMs: latencyLimit,
            severeRegression: latencyLimit != null && postLatency > latencyLimit,
        };
        if (receipt.healthComparison.severeRegression) {
            throw new Error(`SOMA health latency regressed from ${baselineLatency}ms to ${postLatency}ms`);
        }

        onLog('[MAX] Step 7.5/8: Cognition-fitness regression gate...');
        // The ASI flywheel: a change can boot cleanly and still make SOMA dumber.
        // Re-run her deterministic benchmark and roll back on a real regression.
        // Fail-OPEN on benchmark infra errors (health already passed) — roll back
        // ONLY on a measured composite drop beyond tolerance.
        receipt.cognition = await runCognitionBenchmark(onLog);
        if (receipt.cognition?.measured && Number.isFinite(receipt.cognition.delta)
            && receipt.cognition.delta < -COGNITION_REGRESSION_TOLERANCE) {
            throw new Error(`Cognition regression: composite ${receipt.cognition.previousComposite} → ${receipt.cognition.composite} (Δ ${receipt.cognition.delta})`);
        }

        onLog('[MAX] Step 8/8: Recording deployment evidence...');
        receipt.applied = true;
        receipt.completedAt = new Date().toISOString();
        receipt.receiptPath = await writeDeploymentReceipt(receipt);
        onLog(`[MAX] SOMA deployment verified. Receipt: ${receipt.receiptPath}`);
        return { applied: true, checkpoint, verification: receipt.verification, baselineHealth: receipt.baselineHealth, postHealth: receipt.postHealth, receiptPath: receipt.receiptPath };
    } catch (error) {
        receipt.applied = false;
        receipt.error = error.message;
        let restored = false;
        if (checkpoint) {
            onLog(`[MAX] Deployment failed: ${error.message}. Restoring exact checkpoint...`);
            restored = await revertLast(checkpoint);
            receipt.rollback = { attempted: true, restored };
        } else {
            receipt.rollback = { attempted: false, restored: false };
        }

        let recoveryHealthy = receipt.baselineHealth?.healthy ?? false;
        if (runtimeRestartAttempted && restored) {
            await stopSoma();
            await startSoma();
            recoveryHealthy = await pollReady(45_000);
        }
        receipt.recoveryHealthy = recoveryHealthy;
        receipt.completedAt = new Date().toISOString();
        receipt.receiptPath = await writeDeploymentReceipt(receipt).catch(() => null);
        return { applied: false, reason: 'deployment_failed', error: error.message, revertedDueToFailure: restored, recoveryHealthy, checkpoint, verification: receipt.verification || null, receiptPath: receipt.receiptPath };
    }
}
