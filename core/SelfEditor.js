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
            { temperature: 0.1, maxTokens: 6000, tier: 'smart' }
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
            const proc = spawn('node', ['--check', entry.stagePath], { timeout: 10_000 });
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
            const proc = spawn(process.execPath, ['--input-type=module'], { timeout: 15_000 });
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

        const hunks   = [];
        const maxLen  = Math.max(origLines.length, stageLines.length);
        let   changes = 0;
        let   hunk    = [];

        const flushHunk = () => {
            if (hunk.length > 0) { hunks.push(hunk.join('\n')); hunk = []; }
        };

        for (let i = 0; i < maxLen; i++) {
            const o = origLines[i];
            const s = stageLines[i];
            if (o === undefined)    { hunk.push(`+ ${s}`);  changes++; }
            else if (s === undefined) { hunk.push(`- ${o}`); changes++; }
            else if (o !== s)       { hunk.push(`- ${o}`); hunk.push(`+ ${s}`); changes++; }
            else if (hunk.length > 0) {
                hunk.push(`  ${o}`);
                if (hunk.filter(l => !l.startsWith('  ')).length === 0) flushHunk();
            }
        }
        flushHunk();

        return { diff: hunks.join('\n---\n'), changes, addedLines: stageLines.length - origLines.length };
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
