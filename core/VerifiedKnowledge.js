// ═══════════════════════════════════════════════════════════════════════════
// VerifiedKnowledge.js — MAX's persistent ground-truth store
//
// Solves the post-restart hallucination problem:
//   After restart, MAX loses all the grounding context (tool call results,
//   actual file listings, confirmed API shapes). Without it, DeepSeek
//   pattern-matches to training data and invents plausible-but-wrong structures.
//
// This stores facts that were CONFIRMED by actual tool execution.
// Loaded at boot and injected into every system prompt so MAX starts
// each session with real anchors, not LLM intuition.
//
// Usage:
//   TOOL:knowledge:verify:{"key":"SOMA.vision_scan","fact":"registered in server/loaders/tools.js:644","source":"tools.js:644"}
//   TOOL:knowledge:retract:{"key":"SOMA.vision_scan"}
//   TOOL:knowledge:list:{}
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_FILE = path.join(__dirname, '..', '.max', 'verified_knowledge.md');
const STALE_DAYS = 7;  // warn about facts older than this

export class VerifiedKnowledge {
    constructor() {
        this._facts = new Map();  // key → { fact, source, verifiedAt }
    }

    // ── Load from disk ────────────────────────────────────────────────────
    load() {
        if (!fs.existsSync(KNOWLEDGE_FILE)) return this;
        try {
            const content = fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
            const entries = content.split('\n## ').slice(1);
            for (const entry of entries) {
                const lines   = entry.trim().split('\n');
                const key     = lines[0].trim();
                const factM   = entry.match(/\*\*Fact:\*\* (.+)/);
                const sourceM = entry.match(/\*\*Source:\*\* (.+)/);
                const dateM   = entry.match(/\*\*Verified:\*\* (.+)/);
                if (key && factM) {
                    this._facts.set(key, {
                        fact:       factM[1].trim(),
                        source:     sourceM?.[1]?.trim() || 'unknown',
                        verifiedAt: dateM?.[1]?.trim()   || new Date().toISOString()
                    });
                }
            }
        } catch (e) {
            console.warn('[VerifiedKnowledge] Failed to load:', e.message);
        }
        return this;
    }

    // ── Save to disk ──────────────────────────────────────────────────────
    save() {
        try {
            const lines = ['# MAX Verified Knowledge\n',
                'Facts confirmed by actual tool execution. Do not contradict without re-verifying.\n'];
            for (const [key, { fact, source, verifiedAt }] of this._facts) {
                lines.push(`## ${key}`);
                lines.push(`**Fact:** ${fact}`);
                lines.push(`**Source:** ${source}`);
                lines.push(`**Verified:** ${verifiedAt}`);
                lines.push('');
            }
            fs.writeFileSync(KNOWLEDGE_FILE, lines.join('\n'), 'utf8');
        } catch (e) {
            console.warn('[VerifiedKnowledge] Failed to save:', e.message);
        }
    }

    // ── Add / update a fact ───────────────────────────────────────────────
    add(key, fact, source) {
        this._facts.set(key, {
            fact,
            source:     source || 'unknown',
            verifiedAt: new Date().toISOString()
        });
        this.save();
        console.log(`[VerifiedKnowledge] ✅ Verified: ${key}`);
        return { success: true, key, fact };
    }

    // ── Remove a fact (when proved wrong) ────────────────────────────────
    retract(key) {
        const had = this._facts.has(key);
        this._facts.delete(key);
        if (had) {
            this.save();
            console.log(`[VerifiedKnowledge] 🗑️  Retracted: ${key}`);
        }
        return { success: true, retracted: key, existed: had };
    }

    // ── List all facts ────────────────────────────────────────────────────
    getAll() {
        return [...this._facts.entries()].map(([key, v]) => ({ key, ...v }));
    }

    // ── Build system prompt section ───────────────────────────────────────
    toSystemPrompt() {
        if (this._facts.size === 0) return '';

        const now   = Date.now();
        const stale = [];
        const fresh = [];

        for (const [key, { fact, source, verifiedAt }] of this._facts) {
            const ageDays = (now - new Date(verifiedAt).getTime()) / 86_400_000;
            const dateStr = verifiedAt.startsWith('20') ? verifiedAt.slice(0, 10) : verifiedAt;
            const line    = `- **${key}**: ${fact} _(${source}, ${dateStr})_`;
            if (ageDays > STALE_DAYS) stale.push(line);
            else fresh.push(line);
        }

        const lines = ['\n## Verified Knowledge (confirmed by tool execution)'];
        lines.push('Do NOT contradict these facts without first re-running a tool to check.');
        lines.push('If a fact seems wrong, use TOOL:knowledge:retract first, then re-verify.\n');

        if (fresh.length > 0) {
            lines.push(...fresh);
        }
        if (stale.length > 0) {
            lines.push('\n_The following facts are older than 7 days — re-verify before relying on them:_');
            lines.push(...stale);
        }
        lines.push('');
        return lines.join('\n');
    }

    // ── Register as a tool ───────────────────────────────────────────────
    asTool() {
        return {
            name: 'knowledge',
            description: `Manage MAX's verified knowledge base — facts confirmed by actual tool execution.
Use this to record what you've confirmed is true, so you don't forget after a restart.

Actions:
  verify  → record a verified fact: TOOL:knowledge:verify:{"key":"SOMA.vision_scan","fact":"registered in server/loaders/tools.js:644, gated by SOMA_LOAD_VISION=true","source":"tools.js:644"}
  retract → remove an incorrect/stale fact: TOOL:knowledge:retract:{"key":"SOMA.vision_scan"}
  list    → see all verified facts: TOOL:knowledge:list:{}

WHEN TO USE:
- After reading a file and confirming where something is implemented → verify it
- After confirming an API endpoint exists → verify it
- After discovering something you previously thought existed actually doesn't → verify the absence
- After finding out a previous fact was wrong → retract then re-verify`,
            actions: {
                verify: ({ key, fact, source }) => {
                    if (!key || !fact) return { success: false, error: 'key and fact are required' };
                    return this.add(key, fact, source);
                },
                retract: ({ key }) => {
                    if (!key) return { success: false, error: 'key is required' };
                    return this.retract(key);
                },
                list: () => {
                    const facts = this.getAll();
                    return { success: true, count: facts.length, facts };
                }
            }
        };
    }
}
