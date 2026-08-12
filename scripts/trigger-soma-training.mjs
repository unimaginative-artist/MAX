// ═══════════════════════════════════════════════════════════════════════════
// trigger-soma-training.mjs — the MISSING agency step.
//
// MAX's pipeline used to accumulate DPO pairs to 50 and then print
// "🟢 READY FOR LOCAL GPU FINE-TUNING" and exit(0). That "ready" was a
// console.log, never an action. This module makes it an action:
//   MAX's RLAIF pairs → SOMA's DPO format → spawn the REAL trainer
//   (SOMA/scripts/finetune_gemma3.py --dpo), which produces a real adapter
//   and real metrics — verified working end-to-end 2026-08-11.
//
// Polite by default: a GPU preflight defers training if SOMA is busy on the
// GPU, so autonomous training never starves her Discord responsiveness.
//
// Usage (standalone):  node scripts/trigger-soma-training.mjs [--lobe prometheus] [--max-steps N]
// Usage (from pipeline): import { triggerSomaTraining } from './trigger-soma-training.mjs'
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_ROOT = path.resolve(__dirname, '..');
const SOMA_ROOT = process.env.SOMA_ROOT || path.resolve(MAX_ROOT, '..', 'SOMA');

const MAX_PAIRS_FILE = process.env.MAX_DPO_DATASET || path.join(MAX_ROOT, '.max', 'soma_rlaif_dataset.jsonl');
const SOMA_DPO_DIR = path.join(SOMA_ROOT, 'SOMA', 'training-data', 'dpo');
const TRAINER = path.join(SOMA_ROOT, 'scripts', 'finetune_gemma3.py');
const PREFLIGHT = path.join(SOMA_ROOT, 'scripts', 'training_preflight.py');
const MIN_PAIRS = Number(process.env.MAX_DPO_MIN_PAIRS || 50);
const MIN_FREE_GPU_GB = Number(process.env.MAX_TRAIN_MIN_FREE_GB || 6);

function resolvePython() {
  const candidates = [
    path.join(SOMA_ROOT, '.soma_venv', 'Scripts', 'python.exe'),
    path.join(SOMA_ROOT, '.soma_venv', 'bin', 'python'),
  ];
  return process.env.SOMA_PYTHON || candidates.find(p => fs.existsSync(p))
    || (process.platform === 'win32' ? 'python' : 'python3');
}

// Convert MAX's RLAIF pairs → SOMA's DPO format ({prompt, chosen, rejected})
// written where finetune_gemma3.py --dpo reads them (revision-pairs-*.jsonl).
export function convertPairs() {
  if (!fs.existsSync(MAX_PAIRS_FILE)) {
    return { ok: false, error: `MAX pairs file not found: ${MAX_PAIRS_FILE}`, count: 0 };
  }
  const lines = fs.readFileSync(MAX_PAIRS_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const p = JSON.parse(line);
      if (p.prompt && p.chosen && p.rejected) {
        // No `score` field → SOMA's loader keeps it (it only skips score > 0.6).
        out.push(JSON.stringify({
          prompt: p.prompt, chosen: p.chosen, rejected: p.rejected,
          margin: p.margin, ts: p.ts, source: 'max_rlaif',
        }));
      }
    } catch { /* skip malformed */ }
  }
  if (out.length === 0) return { ok: false, error: 'no valid pairs after conversion', count: 0 };
  fs.mkdirSync(SOMA_DPO_DIR, { recursive: true });
  const dest = path.join(SOMA_DPO_DIR, `revision-pairs-max-${Date.now()}.jsonl`);
  fs.writeFileSync(dest, out.join('\n'), 'utf8');
  return { ok: true, count: out.length, dest };
}

// GPU preflight — reuse SOMA's training_preflight.py so we defer (not fail) when
// the GPU is busy. Returns { ok, reason }. If preflight is absent, allow.
function gpuPreflight(python) {
  return new Promise((resolve) => {
    if (!fs.existsSync(PREFLIGHT)) return resolve({ ok: true, reason: 'no preflight script; allowing' });
    let stdout = '';
    const proc = spawn(python, [PREFLIGHT, '--require-free-gb', String(MIN_FREE_GPU_GB)], { cwd: SOMA_ROOT });
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.on('error', () => resolve({ ok: true, reason: 'preflight spawn failed; allowing' }));
    proc.on('close', () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      try {
        const r = JSON.parse(last);
        resolve({ ok: !!r.ok, reason: r.ok ? 'gpu ok' : (r.errors || ['gpu busy']).join('; ') });
      } catch { resolve({ ok: true, reason: 'unparseable preflight; allowing' }); }
    });
  });
}

// The real trigger: convert pairs → preflight → spawn finetune_gemma3.py --dpo.
export async function triggerSomaTraining(opts = {}) {
  const lobe = (opts.lobe || process.env.MAX_TRAIN_LOBE || 'prometheus').toLowerCase();
  const maxSteps = Number(opts.maxSteps || process.env.MAX_TRAIN_MAX_STEPS || 0);
  const dryRun = opts.dryRun || process.env.MAX_TRAIN_DRY_RUN === '1';

  if (!fs.existsSync(TRAINER)) {
    return { ok: false, error: `SOMA trainer not found: ${TRAINER}` };
  }

  // 1. Enough pairs?
  const pairLines = fs.existsSync(MAX_PAIRS_FILE)
    ? fs.readFileSync(MAX_PAIRS_FILE, 'utf8').split('\n').filter(l => l.trim()).length : 0;
  if (pairLines < MIN_PAIRS) {
    return { ok: false, deferred: true, reason: `only ${pairLines}/${MIN_PAIRS} pairs — not training yet` };
  }

  // 2. Convert to SOMA's DPO format.
  const conv = convertPairs();
  if (!conv.ok) return { ok: false, error: conv.error };
  console.log(`[trigger-soma-training] Converted ${conv.count} pairs → ${conv.dest}`);

  const python = resolvePython();

  // 3. GPU preflight (be polite to SOMA's live GPU use).
  if (!dryRun) {
    const pf = await gpuPreflight(python);
    if (!pf.ok) {
      return { ok: false, deferred: true, reason: `GPU preflight deferred training: ${pf.reason}` };
    }
    console.log(`[trigger-soma-training] GPU preflight: ${pf.reason}`);
  }

  // 4. Spawn the REAL trainer (DPO mode).
  const resultFile = path.join(os.tmpdir(), `max-soma-train-${Date.now()}.json`);
  const args = [TRAINER, '--lobe', lobe, '--dpo', '--dpo-data', SOMA_DPO_DIR, '--yes', '--json-result', resultFile];
  if (maxSteps > 0) args.push('--max-steps', String(maxSteps));
  if (dryRun) args.push('--dry-run');

  console.log(`[trigger-soma-training] 🚀 Training SOMA ${lobe.toUpperCase()} lobe (DPO): ${python} ${args.join(' ')}`);

  const result = await new Promise((resolve) => {
    let stdout = '', stderr = '';
    const proc = spawn(python, args, { cwd: SOMA_ROOT });
    proc.stdout.on('data', d => {
      const s = d.toString(); stdout += s;
      for (const l of s.split('\n')) { const t = l.trim(); if (t && !t.startsWith('__SOMA_TRAIN_RESULT__')) console.log(`  [trainer] ${t.slice(0, 200)}`); }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => resolve({ ok: false, error: `spawn failed: ${err.message}` }));
    proc.on('close', code => {
      if (code !== 0) return resolve({ ok: false, error: `trainer exited ${code}: ${stderr.trim().slice(-400)}` });
      try {
        let raw = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8') : null;
        if (!raw) { const m = stdout.match(/__SOMA_TRAIN_RESULT__(\{.*\})/); if (m) raw = m[1]; }
        try { if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile); } catch {}
        resolve(raw ? JSON.parse(raw) : { ok: false, error: 'no result JSON' });
      } catch (e) { resolve({ ok: false, error: `parse failed: ${e.message}` }); }
    });
  });

  return result;
}

// Standalone execution
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('trigger-soma-training.mjs')) {
  const argv = process.argv.slice(2);
  const getArg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const opts = {
    lobe: getArg('--lobe', undefined),
    maxSteps: getArg('--max-steps', undefined),
    dryRun: argv.includes('--dry-run'),
  };
  triggerSomaTraining(opts).then(r => {
    console.log('\n[trigger-soma-training] RESULT:', JSON.stringify(r));
    process.exit(r.ok || r.deferred ? 0 : 1);
  }).catch(e => { console.error('[trigger-soma-training] ERROR:', e.stack || e); process.exit(1); });
}
