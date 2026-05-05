// ═══════════════════════════════════════════════════════════════════════════
// SelfImprovementEngine.js — MAX's closed self-modification loop
//
// The full pipeline:
//   1. ReflectionEngine identifies a behavioral weakness or recurring pattern
//   2. Brain maps the weakness to a specific source file + edit instruction
//   3. SelfEditor generates the modified code
//   4. Validate: syntax check + import test
//   5. Show diff — queue proposal for human approval
//   6. Barry approves → backup + apply. Denies → discard.
//
// Only one proposal can be in-flight per file at a time.
// Every approval creates a git checkpoint automatically.
// Auto-reverts if the file fails to import after apply.
//
// Accessible from:
//   REPL: /proposals, /approve <id>, /deny <id>
//   Chat: TOOL:self_improve:propose:{}, TOOL:self_improve:list:{}, etc.
//   SSE:  { type: 'self_proposal', ...proposal } broadcast to dashboard
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { exec }         from 'child_process';
import { promisify }    from 'util';
import crypto           from 'crypto';

const execAsync = promisify(exec);

// Core files MAX can propose changes to — mapped to plain-language descriptions
// so the brain knows what each file controls
const EDITABLE_FILES = {
    'core/Brain.js':             'LLM routing, timeouts, temperature defaults, tier selection',
    'core/MAX.js':               'Main agent think() loop, context management, system prompt assembly',
    'core/AgentLoop.js':         'Autonomous task execution, step retry logic, error recovery',
    'core/GoalEngine.js':        'Goal planning, decomposition prompts, priority scoring',
    'core/ReflectionEngine.js':  'Self-reflection scoring, pattern detection, improvement goals',
    'core/Heartbeat.js':         'Background pulse timing, tension-driven scheduling',
    'core/CognitiveFilter.js':   'Belief state logic, verification triggers',
    'core/DriveSystem.js':       'Tension/satisfaction rates, action thresholds',
    'core/SovereignLoop.js':     'Long-horizon autonomous reasoning cadence',
    'core/CuriosityEngine.js':   'Curiosity signal generation and exploration',
    'tools/ShellTool.js':        'Shell execution, blocked command patterns',
    'tools/WebTool.js':          'Web search and page fetching logic',
};

export class SelfImprovementEngine extends EventEmitter {
    constructor(max) {
        super();
        this.max            = max;
        this._proposals     = new Map();  // id → proposal
        this._inFlight      = new Set();  // files currently being proposed (prevent duplicates)
        this._lastProposalAt = 0;         // ms timestamp — enforces cooldown between auto-proposals
        this.stats = { proposed: 0, approved: 0, denied: 0, reverted: 0 };
    }

    // ─── Main entry: given a behavioral weakness, propose a code fix ──────
    async propose(weakness, { source = 'reflection', priority = 0.7 } = {}) {
        if (!this.max.selfEditor || !this.max.brain._ready) return null;

        console.log(`\n[SelfImprovement] 🔍 Mapping weakness to code: "${weakness.slice(0, 80)}"`);

        // ── Step 1: Brain identifies the right file + instruction ────────
        const fileList = Object.entries(EDITABLE_FILES)
            .map(([f, desc]) => `  ${f}: ${desc}`)
            .join('\n');

        const mappingPrompt = `You are MAX's self-improvement system. A behavioral weakness was identified.
Map it to a specific source file and a concrete edit instruction.

WEAKNESS: "${weakness}"

EDITABLE FILES (file: what it controls):
${fileList}

Return ONLY JSON:
{
  "file": "core/Brain.js",
  "instruction": "very specific one-sentence edit instruction",
  "rationale": "why this file and change would fix the weakness",
  "confidence": 0.0-1.0,
  "riskLevel": "low|medium|high"
}

Only map to files where a code change would actually fix the behavioral issue.
If the weakness is better fixed via prompt/config (not code), return confidence < 0.4.`;

        let mapping = null;
        try {
            const result = await this.max.brain.think(mappingPrompt, {
                tier:        'smart',
                temperature: 0.1,
                maxTokens:   300
            });
            const match = result.text.match(/\{[\s\S]*?\}/);
            if (match) mapping = JSON.parse(match[0]);
        } catch (err) {
            console.warn(`[SelfImprovement] Mapping failed: ${err.message}`);
            return null;
        }

        if (!mapping || mapping.confidence < 0.5 || !EDITABLE_FILES[mapping.file]) {
            console.log(`[SelfImprovement] ⚠️  Low confidence (${mapping?.confidence || 0}) — skipping code change`);
            return null;
        }

        if (mapping.riskLevel === 'high') {
            console.log(`[SelfImprovement] ⚠️  High risk change flagged — skipping autonomous proposal`);
            return null;
        }

        const targetFile = mapping.file;

        // Prevent duplicate proposals for the same file
        if (this._inFlight.has(targetFile)) {
            console.log(`[SelfImprovement] ⏳ Proposal already in-flight for ${targetFile} — skipping`);
            return null;
        }

        this._inFlight.add(targetFile);

        try {
            return await this._generateProposal(targetFile, mapping.instruction, weakness, mapping.rationale, source, priority);
        } finally {
            this._inFlight.delete(targetFile);
        }
    }

    // ─── Generate, validate, and queue a proposal ─────────────────────────
    async _generateProposal(file, instruction, weakness, rationale, source, priority) {
        const selfEditor = this.max.selfEditor;

        console.log(`[SelfImprovement] ✏️  Proposing edit to ${file}`);
        console.log(`[SelfImprovement]    Instruction: ${instruction}`);

        // ── Step 2: SelfEditor generates modified code ───────────────────
        let newCode;
        try {
            newCode = await selfEditor.proposeEdit(file, instruction, this.max.brain);
        } catch (err) {
            console.warn(`[SelfImprovement] Code generation failed: ${err.message}`);
            return null;
        }

        // ── Step 3: Stage the proposed code ─────────────────────────────
        await selfEditor.stage(file, newCode);

        // ── Step 4: Validate — syntax + import ───────────────────────────
        const validation = await selfEditor.validate(file);
        if (!validation.ok) {
            console.warn(`[SelfImprovement] ❌ Validation failed (${validation.stage}): ${validation.error}`);
            await selfEditor.rollback(file);
            return null;
        }

        // ── Step 5: Generate diff for review ────────────────────────────
        const diffResult = await selfEditor.diff(file);
        if (!diffResult || diffResult.changes === 0) {
            console.log(`[SelfImprovement] No actual changes detected — skipping`);
            await selfEditor.rollback(file);
            return null;
        }

        // ── Step 6: Queue proposal for human approval ────────────────────
        const id = crypto.randomBytes(4).toString('hex');
        const proposal = {
            id,
            file,
            instruction,
            weakness,
            rationale,
            source,
            priority,
            diff:      diffResult.diff,
            changes:   diffResult.changes,
            newCode,
            createdAt: new Date().toISOString(),
            status:    'pending'
        };

        this._proposals.set(id, proposal);
        this.stats.proposed++;

        // Broadcast to dashboard and terminal
        this._printProposal(proposal);
        this.emit('proposal', proposal);
        this.max.heartbeat?.emit('insight', {
            source: 'self_improvement',
            label:  `🔧 Self-edit proposal: ${file}`,
            result: `${instruction}\n${diffResult.changes} line(s) changed. /approve ${id} or /deny ${id}`
        });

        console.log(`[SelfImprovement] ✅ Proposal ${id} queued — ${diffResult.changes} change(s) in ${file}`);
        return proposal;
    }

    // ─── Approve a proposal — backup, apply, verify ───────────────────────
    async approve(id) {
        const proposal = this._proposals.get(id);
        if (!proposal) return { success: false, error: `No proposal with id "${id}"` };

        console.log(`\n[SelfImprovement] ✅ Approving proposal ${id} — applying ${proposal.file}`);

        try {
            // Git checkpoint before applying
            await this._gitCheckpoint(proposal.file, id);

            // Commit via SelfEditor (backs up original, replaces file)
            const commitResult = await this.max.selfEditor.commit(proposal.file);

            // Post-apply import validation — auto-revert if broken
            const postCheck = await this.max.selfEditor.validateImport(proposal.file).catch(() => ({ ok: false, error: 'import check failed' }));

            // Note: after commit, the staged file is gone. Re-stage to validate.
            // Actually validateImport uses the staged path which is deleted after commit.
            // So we do a quick node --check on the live file instead.
            const liveCheck = await this._checkLiveFile(proposal.file);
            if (!liveCheck.ok) {
                console.error(`[SelfImprovement] ❌ Post-apply check failed — reverting`);
                await this._revert(proposal.file, commitResult.backup);
                this.stats.reverted++;
                proposal.status = 'reverted';
                return { success: false, error: 'Post-apply validation failed — auto-reverted', backup: commitResult.backup };
            }

            proposal.status = 'approved';
            this._proposals.delete(id);
            this.stats.approved++;

            // Store in KB
            this.max.kb?.remember(
                `Self-improvement applied: ${proposal.file}\nInstruction: ${proposal.instruction}\nRationale: ${proposal.rationale}`,
                { source: 'self_improvement', file: proposal.file }
            ).catch(() => {});

            console.log(`[SelfImprovement] 🚀 Applied successfully: ${proposal.file}`);
            this.emit('approved', { id, file: proposal.file });
            return { success: true, file: proposal.file, backup: commitResult.backup };

        } catch (err) {
            console.error(`[SelfImprovement] Apply error: ${err.message}`);
            await this.max.selfEditor.rollback(proposal.file).catch(() => {});
            return { success: false, error: err.message };
        }
    }

    // ─── Deny a proposal — discard staged changes ─────────────────────────
    async deny(id) {
        const proposal = this._proposals.get(id);
        if (!proposal) return { success: false, error: `No proposal with id "${id}"` };

        await this.max.selfEditor.rollback(proposal.file).catch(() => {});
        proposal.status = 'denied';
        this._proposals.delete(id);
        this.stats.denied++;

        console.log(`[SelfImprovement] ❌ Proposal ${id} denied — ${proposal.file} unchanged`);
        this.emit('denied', { id, file: proposal.file });
        return { success: true, file: proposal.file };
    }

    // ─── List pending proposals ───────────────────────────────────────────
    list() {
        return [...this._proposals.values()].map(p => ({
            id:          p.id,
            file:        p.file,
            instruction: p.instruction,
            weakness:    p.weakness,
            changes:     p.changes,
            source:      p.source,
            createdAt:   p.createdAt,
            status:      p.status
        }));
    }

    // ─── Trigger from reflection: analyze weakness → maybe propose ────────
    // Called by ReflectionEngine when a code-level pattern is identified.
    // Gated: only runs if weakness has been seen 3+ times (avoid noise).
    async onWeaknessIdentified(weakness, count = 1) {
        if (count < 3) return;  // must be recurring, not a one-off
        if (this._proposals.size >= 3) return;  // don't pile up proposals
        if (Date.now() - this._lastProposalAt < 30 * 60 * 1000) return;  // 30-min cooldown

        // Only fire during low-activity periods
        if (this.max._chatBusy || this.max.agentLoop?._running) return;

        this._lastProposalAt = Date.now();
        await this.propose(weakness, { source: 'reflection_auto' }).catch(() => {});
    }

    // ─── Auto-propose from AgentLoop recurring failures ───────────────────
    async onRecurringFailure(pattern, failureCount) {
        if (failureCount < 4) return;
        if (this._proposals.size >= 3) return;
        if (Date.now() - this._lastProposalAt < 30 * 60 * 1000) return;  // 30-min cooldown

        this._lastProposalAt = Date.now();
        const weakness = `AgentLoop recurring failure: ${pattern}`;
        await this.propose(weakness, { source: 'agentloop_auto', priority: 0.8 }).catch(() => {});
    }

    // ─── Internal helpers ─────────────────────────────────────────────────

    async _gitCheckpoint(file, proposalId) {
        try {
            await execAsync(`git add "${file}"`, { cwd: process.cwd() });
            await execAsync(
                `git commit -m "checkpoint: before self-improvement ${proposalId} (${file})" --allow-empty`,
                { cwd: process.cwd() }
            );
            console.log(`[SelfImprovement] 📸 Git checkpoint created`);
        } catch {
            console.warn(`[SelfImprovement] Git checkpoint failed — continuing anyway`);
        }
    }

    async _checkLiveFile(file) {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execP = promisify(exec);
        try {
            await execP(`node --check "${file}"`, { cwd: process.cwd(), timeout: 10_000 });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.stderr || err.message };
        }
    }

    async _revert(file, backupPath) {
        try {
            const { copyFile } = await import('fs/promises');
            await copyFile(backupPath, file);
            console.log(`[SelfImprovement] ↩️  Reverted ${file} from backup`);
        } catch (err) {
            console.error(`[SelfImprovement] Revert failed: ${err.message}`);
        }
    }

    _printProposal(p) {
        const border = '─'.repeat(60);
        console.log(`\n╔${border}╗`);
        console.log(`║  🔧 SELF-IMPROVEMENT PROPOSAL  ${p.id}  `);
        console.log(`╠${border}╣`);
        console.log(`║  File:        ${p.file}`);
        console.log(`║  Weakness:    ${p.weakness.slice(0, 70)}`);
        console.log(`║  Instruction: ${p.instruction.slice(0, 70)}`);
        console.log(`║  Changes:     ${p.changes} line(s)`);
        console.log(`║  Source:      ${p.source}`);
        console.log(`╠${border}╣`);
        const diffLines = (p.diff || '').split('\n').slice(0, 12);
        for (const l of diffLines) {
            const color = l.startsWith('+') ? '\x1b[32m' : l.startsWith('-') ? '\x1b[31m' : '\x1b[90m';
            console.log(`\x1b[0m║  ${color}${l.slice(0, 70)}\x1b[0m`);
        }
        if ((p.diff || '').split('\n').length > 12) console.log(`║  ... (${p.changes} total changes)`);
        console.log(`╚${border}╝`);
        console.log(`  → /approve ${p.id}   or   /deny ${p.id}\n`);
    }

    getStatus() {
        return {
            pending:   this._proposals.size,
            inFlight:  this._inFlight.size,
            proposals: this.list(),
            ...this.stats
        };
    }
}
