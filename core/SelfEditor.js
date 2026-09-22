// ═══════════════════════════════════════════════════════════════════════════
// SelfEditor.js — MAX's self-modification capability
//
// Lets MAX read, propose edits to, validate, and (with human approval) replace
// his own source files. The pipeline:
//
//   1. Read source file
//   2. Brain generates modified version (full file replacement)
//   3. Stage to .max/staging/ — never touches originals yet
//   4. Syntax check: node --check <staged>
//   5. Import test: child process dynamic import — catches runtime errors
//   6. Open VS Code diff (original ↔ staged) for human review
//   7. Human types /self commit → backup original → replace
//         or types /self rollback → discard staged
//
// Security:
//   - Only paths within PROJECT_ROOT are allowed (no path traversal)
//   - Commit always backs up original to .max/backups/ first
//   - Agent tools can read/propose/test — but NOT commit (human gate)
// ═══════════════════════════════════════════════════════════════════════════

import fs          from 'fs/promises';
import { existsSync } from 'fs';
import path        from 'path';
import { spawn }   from 'child_process';

const PROJECT_ROOT = process.cwd();
const STAGING_DIR  = path.join(PROJECT_ROOT, '.max', 'staging');
const BACKUP_DIR   = path.join(PROJECT_ROOT, '.max', 'backups');

export class SelfEditor {
    constructor() {
        this._staged = new Map();  // relPath → { stagePath, newCode }
    }

    async initialize() {
        await fs.mkdir(STAGING_DIR, { recursive: true });
        await fs.mkdir(BACKUP_DIR,  { recursive: true });
        console.log('[SelfEditor] ✅ Ready');
    }

    // ─── Read a source file ───────────────────────────────────────────────
    async readSource(relPath) {
        const abs  = this._resolve(relPath);
        const code = await fs.readFile(abs, 'utf8');
        return { path: relPath, code, lines: code.split('\n').length };
    }

    // ─── Propose an edit via brain — returns proposed new code ───────────
    async proposeEdit(relPath, instruction, brain) {
        const { code } = await this.readSource(relPath);

        // Attempt 1: Fast, surgical block-level edit (Senior dev approach / Poseidon Rule 1)
        try {
            const surgicalPrompt = `You are a software engineer applying an autonomous edit to your own source code.
FILE: ${relPath}
INSTRUCTION: ${instruction}

Analyze the file and provide the surgical modification.
CRITICAL: The resulting file MUST be 100% syntactically valid JavaScript. If modifying an object literal, ensure correct comma separation between properties/methods and balanced brackets.
You MUST output valid JSON with this exact schema:
{
  "mode": "replace" | "insert_after" | "insert_before",
  "target": "exact lines from CURRENT CODE to match",
  "content": "new code to insert or replace with"
}

CURRENT CODE:
\`\`\`javascript
${code}
\`\`\`

Return ONLY the raw JSON object. No explanation, no markdown backticks.`;

            const surgicalRes = await brain.think(surgicalPrompt, { temperature: 0.1, maxTokens: 1200, tier: 'code' });
            const cleaned = surgicalRes.text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
                const spec = JSON.parse(match[0]);
                if (spec.target && spec.content !== undefined && code.includes(spec.target)) {
                    let surgicalCode = code;
                    if (spec.mode === 'insert_after') {
                        surgicalCode = code.replace(spec.target, spec.target + '\n' + spec.content);
                    } else if (spec.mode === 'insert_before') {
                        surgicalCode = code.replace(spec.target, spec.content + '\n' + spec.target);
                    } else {
                        surgicalCode = code.replace(spec.target, spec.content);
                    }

                    // Pre-validate syntax of surgical candidate
                    const stageName = relPath.replace(/[\\/]/g, '__');
                    const stagePath = path.join(STAGING_DIR, stageName);
                    await fs.mkdir(STAGING_DIR, { recursive: true });
                    await fs.writeFile(stagePath, surgicalCode, 'utf8');

                    const checkProc = await new Promise(res => {
                        const proc = spawn('node', ['--check', stagePath], { timeout: 5000, windowsHide: true });
                        let errStr = '';
                        proc.stderr.on('data', d => { errStr += d.toString(); });
                        proc.on('close', c => res({ ok: c === 0, error: errStr.trim() }));
                        proc.on('error', err => res({ ok: false, error: err.message }));
                    });

                    if (checkProc.ok) {
                        console.log(`[SelfEditor] ⚡ Applied surgical block edit (${spec.mode || 'replace'}) to ${relPath}`);
                        return surgicalCode;
                    } else {
                        console.warn(`[SelfEditor] Surgical block had syntax error (${checkProc.error.split('\n')[0]}), falling back to full-file generation...`);
                    }
                }
            }
        } catch (e) {
            console.warn(`[SelfEditor] Surgical edit failed (${e.message}), falling back to full-file generation...`);
        }

        // Attempt 2: Full-file regeneration fallback
        const result = await brain.think(
            `You are editing your own source code. Apply the instruction precisely.

FILE: ${relPath}
INSTRUCTION: ${instruction}

CURRENT CODE:
\`\`\`javascript
${code}
\`\`\`

Return ONLY the complete modified file. No explanation. No markdown fences.
No truncation — output the entire file even if most lines are unchanged.
The output must be valid JavaScript that can directly replace the original file.`,
            { temperature: 0.1, maxTokens: 6000, tier: 'code' }
        );

        // Strip accidental markdown fences
        let newCode = result.text.trim();
        newCode = newCode.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '');

        return newCode;
    }

    // ─── Stage a proposed version ─────────────────────────────────────────
    async stage(relPath, newCode) {
        const stageName = relPath.replace(/[\\/]/g, '__');
        const stagePath = path.join(STAGING_DIR, stageName);
        await fs.writeFile(stagePath, newCode, 'utf8');
        this._staged.set(relPath, { stagePath, newCode });
        return stagePath;
    }

    // ─── Syntax check via node --check ────────────────────────────────────
    async validateSyntax(relPath) {
        const entry = this._staged.get(relPath);
        if (!entry) throw new Error(`No staged version of ${relPath}`);

        return new Promise(resolve => {
            const proc = spawn('node', ['--check', entry.stagePath], { timeout: 10_000, windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => resolve({ ok: code === 0, error: stderr.trim() }));
            proc.on('error', err => resolve({ ok: false, error: err.message }));
        });
    }

    // ─── Import test — child process catches runtime init errors ──────────
    async validateImport(relPath) {
        const entry = this._staged.get(relPath);
        if (!entry) throw new Error(`No staged version of ${relPath}`);

        // Use file:// URL so dynamic import works on Windows
        const fileUrl = 'file:///' + entry.stagePath.replace(/\\/g, '/');
        const script  = `import(${JSON.stringify(fileUrl)}).then(()=>process.exit(0)).catch(e=>{process.stderr.write(e.message);process.exit(1)})`;

        return new Promise(resolve => {
            const proc = spawn(process.execPath, ['--input-type=module'], { timeout: 15_000, windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.stdin.write(script);
            proc.stdin.end();
            proc.on('close', code => resolve({ ok: code === 0, error: stderr.trim().slice(0, 300) }));
            proc.on('error', err => resolve({ ok: false, error: err.message }));
        });
    }

    // ─── Full validation pipeline ─────────────────────────────────────────
    async validate(relPath) {
        const syntax = await this.validateSyntax(relPath);
        if (!syntax.ok) return { ok: false, stage: 'syntax', error: syntax.error };

        const imp = await this.validateImport(relPath);
        if (!imp.ok) return { ok: false, stage: 'import', error: imp.error };

        return { ok: true };
    }

    // ─── Text diff (original ↔ staged) ────────────────────────────────────
    async diff(relPath) {
        const entry = this._staged.get(relPath);
        if (!entry) return null;

        const { code: original } = await this.readSource(relPath);
        const origLines  = original.split('\n');
        const stageLines = entry.newCode.split('\n');

        const n = origLines.length;
        const m = stageLines.length;

        // DP table for LCS
        const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < m; j++) {
                if (origLines[i] === stageLines[j]) {
                    dp[i + 1][j + 1] = dp[i][j] + 1;
                } else {
                    dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        // Backtrack to assemble diff operations
        const ops = [];
        let i = n, j = m;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && origLines[i - 1] === stageLines[j - 1]) {
                ops.push({ type: ' ', text: origLines[i - 1], origIdx: i - 1, stageIdx: j - 1 });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                ops.push({ type: '+', text: stageLines[j - 1], stageIdx: j - 1 });
                j--;
            } else {
                ops.push({ type: '-', text: origLines[i - 1], origIdx: i - 1 });
                i--;
            }
        }
        ops.reverse();

        // Calculate changes count (number of edit blocks)
        let changes = 0;
        let inChange = false;
        for (const op of ops) {
            if (op.type !== ' ') {
                if (!inChange) {
                    changes++;
                    inChange = true;
                }
            } else {
                inChange = false;
            }
        }

        if (changes === 0) {
            return { diff: '', changes: 0, addedLines: stageLines.length - origLines.length };
        }

        // Group into hunks with 3 context lines
        const CONTEXT = 3;
        const hunks = [];

        for (let k = 0; k < ops.length; k++) {
            const op = ops[k];
            if (op.type !== ' ') {
                let startK = Math.max(0, k - CONTEXT);
                let endK = k;
                while (endK < ops.length) {
                    if (ops[endK].type !== ' ') {
                        endK++;
                    } else {
                        let hasMoreChange = false;
                        for (let look = 1; look <= CONTEXT * 2 && endK + look < ops.length; look++) {
                            if (ops[endK + look].type !== ' ') {
                                hasMoreChange = true;
                                break;
                            }
                        }
                        if (hasMoreChange) {
                            endK++;
                        } else {
                            break;
                        }
                    }
                }
                const hunkEndK = Math.min(ops.length - 1, (endK - 1) + CONTEXT);
                const hunkOps = ops.slice(startK, hunkEndK + 1);

                let origCount = 0;
                let stageCount = 0;
                let origStart = 0;
                let stageStart = 0;
                let foundOrigStart = false;
                let foundStageStart = false;

                for (const hOp of hunkOps) {
                    if (hOp.type === ' ' || hOp.type === '-') {
                        origCount++;
                        if (!foundOrigStart && hOp.origIdx !== undefined) {
                            origStart = hOp.origIdx + 1;
                            foundOrigStart = true;
                        }
                    }
                    if (hOp.type === ' ' || hOp.type === '+') {
                        stageCount++;
                        if (!foundStageStart && hOp.stageIdx !== undefined) {
                            stageStart = hOp.stageIdx + 1;
                            foundStageStart = true;
                        }
                    }
                }

                if (!foundOrigStart) origStart = 1;
                if (!foundStageStart) stageStart = 1;

                const header = `@@ -${origStart},${origCount} +${stageStart},${stageCount} @@`;
                const lines = [header];
                for (const hOp of hunkOps) {
                    lines.push(`${hOp.type === ' ' ? ' ' : hOp.type} ${hOp.text}`);
                }
                hunks.push(lines.join('\n'));

                k = hunkEndK;
            }
        }

        return { diff: hunks.join('\n'), changes, addedLines: stageLines.length - origLines.length };
    }

    // ─── Open VS Code diff view ───────────────────────────────────────────
    async openDiff(relPath) {
        const entry = this._staged.get(relPath);
        if (!entry) throw new Error(`No staged version of ${relPath}`);
        const abs = this._resolve(relPath);

        return new Promise(resolve => {
            // Try VS Code diff
            const proc = spawn('code', ['--diff', abs, entry.stagePath], {
                detached: true, stdio: 'ignore', shell: true
            });
            proc.on('error', () => {
                // Fallback: open staged file in system default editor
                spawn('cmd', ['/c', 'start', '', entry.stagePath], {
                    detached: true, stdio: 'ignore', shell: true
                }).unref();
                resolve({ method: 'system', stagePath: entry.stagePath });
            });
            proc.unref();
            resolve({ method: 'vscode', original: abs, staged: entry.stagePath });
        });
    }

    // ─── Commit — backup original, replace with staged version ───────────
    async commit(relPath) {
        const entry = this._staged.get(relPath);
        if (!entry) throw new Error(`No staged version of ${relPath} — nothing to commit`);

        const abs        = this._resolve(relPath);
        const backupName = `${relPath.replace(/[\\/]/g, '__')}_${Date.now()}.bak`;
        const backupPath = path.join(BACKUP_DIR, backupName);

        await fs.copyFile(abs, backupPath);
        await fs.writeFile(abs, entry.newCode, 'utf8');
        await fs.unlink(entry.stagePath).catch(() => {});
        this._staged.delete(relPath);

        console.log(`[SelfEditor] ✅ Committed: ${relPath}  (backup → ${backupName})`);
        return { committed: relPath, backup: backupPath };
    }

    // ─── Rollback — discard staged changes ───────────────────────────────
    async rollback(relPath) {
        const entry = this._staged.get(relPath);
        if (entry) {
            await fs.unlink(entry.stagePath).catch(() => {});
            this._staged.delete(relPath);
        }
        console.log(`[SelfEditor] ↩️  Rolled back: ${relPath}`);
        return { rolledBack: relPath };
    }

    // ─── Restore from a backup file ───────────────────────────────────────
    async restore(backupName) {
        const backupPath = path.join(BACKUP_DIR, backupName);
        if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupName}`);

        // Reconstruct original path from backup name convention
        // Format: path__to__file_js_<timestamp>.bak
        const withoutTs  = backupName.replace(/_\d+\.bak$/, '');
        const relPath    = withoutTs.replace(/__/g, '/');
        const abs        = path.resolve(PROJECT_ROOT, relPath);

        await fs.copyFile(backupPath, abs);
        console.log(`[SelfEditor] 🔄 Restored ${relPath} from backup`);
        return { restored: relPath };
    }

    listStaged()  { return [...this._staged.keys()]; }

    async listBackups() {
        try {
            const files = await fs.readdir(BACKUP_DIR);
            return files.filter(f => f.endsWith('.bak')).sort().reverse();
        } catch { return []; }
    }

    // ─── Security: resolve and validate path is within project ───────────
    _resolve(relPath) {
        const abs = path.resolve(PROJECT_ROOT, relPath);
        if (!abs.startsWith(PROJECT_ROOT + path.sep) && abs !== PROJECT_ROOT) {
            throw new Error(`Path traversal denied: ${relPath}`);
        }
        if (!existsSync(abs)) {
            throw new Error(`File not found: ${relPath}`);
        }
        return abs;
    }
}
