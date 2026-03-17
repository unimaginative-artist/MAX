// ═══════════════════════════════════════════════════════════════════════════
// SomaController.js — MAX's mechanical interface to SOMA's server
// Handles: stop, start, health polling, git checkpoint, file apply, revert
// NO LLM reasoning in this file. Every action is deterministic and scripted.
// ═══════════════════════════════════════════════════════════════════════════

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, rename, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

const execAsync = promisify(exec);

const SOMA_DIR   = process.env.SOMA_DIR   || 'C:/Users/barry/Desktop/SOMA';
const SOMA_URL   = process.env.SOMA_URL   || 'http://127.0.0.1:3001';
const SOMA_START = process.env.SOMA_START || 'launcher_ULTRA.mjs';

let somaProcess = null;

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

        // Force kill any lingering Node process on SOMA's port (Windows)
        await execAsync(`for /f "tokens=5" %a in ('netstat -aon ^| find ":3001"') do taskkill /f /pid %a`).catch(() => {});
    } catch {
        // Best-effort — continue regardless
    }
    console.log('[SomaController] SOMA stopped.');
}

// ─── Start SOMA ───────────────────────────────────────────────────────────
export async function startSoma() {
    somaProcess = spawn('node', ['launcher_ULTRA.mjs'], {
        cwd: SOMA_DIR,
        detached: false,
        stdio: 'ignore'
    });
    somaProcess.on('error', err => console.error('[SomaController] SOMA spawn error:', err.message));
    console.log('[SomaController] SOMA starting...');
}

// ─── Git checkpoint ────────────────────────────────────────────────────────
export async function gitCheckpoint(taskId, filePath) {
    try {
        await execAsync(`git -C "${SOMA_DIR}" add "${filePath}"`);
        await execAsync(`git -C "${SOMA_DIR}" commit -m "checkpoint: before SOMA self-mod ${taskId.slice(0, 8)}" --allow-empty`);
        console.log(`[SomaController] Git checkpoint created for ${filePath}`);
        return true;
    } catch (err) {
        console.error('[SomaController] Git checkpoint failed:', err.message);
        return false;
    }
}

// ─── Apply file change (atomic write) ────────────────────────────────────
export async function applyChange(filePath, newCode) {
    const absPath = join(SOMA_DIR, filePath);
    const tmpPath = absPath + '.soma_tmp';
    await writeFile(tmpPath, newCode, 'utf8');
    await rename(tmpPath, absPath); // atomic on same filesystem
    console.log(`[SomaController] File written: ${filePath}`);
}

// ─── Syntax check (no execution) ──────────────────────────────────────────
export async function syntaxCheck(filePath, newCode) {
    const tmpPath = join(SOMA_DIR, filePath + '.check_tmp');
    try {
        await writeFile(tmpPath, newCode, 'utf8');
        await execAsync(`node --check "${tmpPath}"`);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.stderr || err.message };
    } finally {
        await execAsync(`del "${tmpPath}"`).catch(() => {});
    }
}

// ─── Git revert last commit ───────────────────────────────────────────────
export async function revertLast() {
    try {
        await execAsync(`git -C "${SOMA_DIR}" revert HEAD --no-edit`);
        console.log('[SomaController] Reverted last git commit.');
        return true;
    } catch (err) {
        console.error('[SomaController] Git revert failed:', err.message);
        return false;
    }
}

// ─── Full apply flow (the whole pipeline in one call) ────────────────────
export async function applyProposal(proposal, onLog = console.log) {
    const { taskId, file, newCode } = proposal;

    onLog(`[MAX] 🔧 Beginning apply for ${file} (task ${taskId.slice(0, 8)})`);

    // 1. Syntax check — never touch SOMA if code is broken
    onLog('[MAX] Step 1/6: Syntax check...');
    const syntax = await syntaxCheck(file, newCode);
    if (!syntax.ok) {
        onLog(`[MAX] ❌ Syntax check failed — aborting. ${syntax.error}`);
        return { applied: false, reason: 'syntax_error', error: syntax.error };
    }
    onLog('[MAX] ✅ Syntax OK');

    // 2. Git checkpoint
    onLog('[MAX] Step 2/6: Creating git checkpoint...');
    const checkpointed = await gitCheckpoint(taskId, file);
    if (!checkpointed) {
        onLog('[MAX] ⚠️  Git checkpoint failed — continuing (risky)');
    }

    // 3. Apply file change
    onLog('[MAX] Step 3/6: Writing file...');
    await applyChange(file, newCode);
    onLog('[MAX] ✅ File written');

    // 4. Stop SOMA
    onLog('[MAX] Step 4/6: Stopping SOMA...');
    await stopSoma();

    // 5. Start SOMA
    onLog('[MAX] Step 5/6: Starting SOMA...');
    await startSoma();

    // 6. Health check
    onLog('[MAX] Step 6/6: Waiting for SOMA to come back up (45s max)...');
    const healthy = await pollReady(45000);

    if (!healthy) {
        onLog('[MAX] ❌ SOMA failed to restart — reverting...');
        await revertLast();
        await stopSoma();
        await startSoma();
        const recoveryHealthy = await pollReady(45000);
        onLog(recoveryHealthy
            ? '[MAX] ✅ Reverted and SOMA is back up on old code.'
            : '[MAX] ⚠️  Recovery restart also failed. Manual intervention needed.');
        return { applied: false, revertedDueToFailure: true, reason: 'soma_failed_to_start' };
    }

    onLog(`[MAX] ✅ SOMA is healthy. Change applied successfully.`);
    return { applied: true };
}
