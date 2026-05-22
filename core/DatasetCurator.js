// ═══════════════════════════════════════════════════════════════════════════
// DatasetCurator.js — Collects high-quality interactions for future finetuning
//
// Quietly watches every conversation. When ReflectionEngine scores a turn
// highly, or when Barry explicitly marks something as good, it saves the
// interaction as a training example in Alpaca format.
//
// Over months this becomes MAX's own dataset — built from his best moments.
// Future use: LoRA finetuning via llama.cpp, Axolotl, or Unsloth.
// This is how MAX eventually finetunes himself.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const DATASET_DIR  = path.join(process.cwd(), '.max', 'dataset');
const CONVOS_FILE  = path.join(DATASET_DIR, 'conversations.jsonl');
const TAGGED_FILE  = path.join(DATASET_DIR, 'tagged.jsonl');
const META_FILE    = path.join(DATASET_DIR, 'meta.json');

const QUALITY_THRESHOLD = 7.0;   // reflection score (out of 10) to auto-save

export class DatasetCurator {
    constructor(max) {
        this.max  = max;
        this.meta = {
            totalSaved:    0,
            taggedSaved:   0,
            totalSkipped:  0,
            lastSaved:     null,
            createdAt:     Date.now(),
        };
        this._ready = false;
    }

    load() {
        try {
            fs.mkdirSync(DATASET_DIR, { recursive: true });
            if (fs.existsSync(META_FILE)) {
                this.meta = { ...this.meta, ...JSON.parse(fs.readFileSync(META_FILE, 'utf8')) };
            }
            this._ready = true;
            console.log(`[DatasetCurator] Ready — ${this.meta.totalSaved} examples collected so far`);
        } catch (e) {
            console.warn('[DatasetCurator] Load failed:', e.message);
        }
    }

    _saveMeta() {
        try {
            fs.writeFileSync(META_FILE, JSON.stringify(this.meta, null, 2));
        } catch { /* non-fatal */ }
    }

    // ── Auto-save if reflection score is high enough ──────────────────────
    async evaluate(userMessage, maxResponse, reflectionScore = null) {
        if (!this._ready || !userMessage || !maxResponse) return;

        // If no score provided, ask brain to score it
        let score = reflectionScore;
        if (score === null) {
            score = await this._quickScore(userMessage, maxResponse);
        }

        if (score >= QUALITY_THRESHOLD) {
            await this.save(userMessage, maxResponse, { score, source: 'auto' });
        } else {
            this.meta.totalSkipped++;
        }
    }

    // ── Explicitly save a conversation pair ───────────────────────────────
    async save(userMessage, maxResponse, meta = {}) {
        if (!this._ready) return false;

        // Clean up the response (strip internal state markers)
        const instruction = userMessage.trim();
        const output      = maxResponse
            .replace(/^MAX:\s*/i, '')
            .replace(/\nSystem State:[\s\S]*?(?=\n\n|\n[A-Z]|$)/, '')
            .trim();

        if (!instruction || !output) return false;

        // Alpaca format — widely supported by LoRA training tools
        const example = {
            instruction,
            input:   '',   // could be populated with file context in future
            output,
            metadata: {
                ts:        Date.now(),
                score:     meta.score || null,
                source:    meta.source || 'manual',
                persona:   this.max.persona?.current?.id || 'unknown',
                tier:      'smart',
            },
        };

        try {
            fs.appendFileSync(CONVOS_FILE, JSON.stringify(example) + '\n');
            this.meta.totalSaved++;
            this.meta.lastSaved = Date.now();
            this._saveMeta();
            return true;
        } catch (e) {
            console.warn('[DatasetCurator] Save failed:', e.message);
            return false;
        }
    }

    // ── Tag an example as exceptional (highest quality, used for RLHF) ────
    async tag(userMessage, maxResponse, note = '') {
        if (!this._ready) return false;

        const example = {
            instruction: userMessage.trim(),
            input:       '',
            output:      maxResponse.trim(),
            note,
            metadata: {
                ts:     Date.now(),
                source: 'tagged_by_user',
                note,
            },
        };

        try {
            fs.appendFileSync(TAGGED_FILE, JSON.stringify(example) + '\n');
            this.meta.taggedSaved++;
            this._saveMeta();
            console.log(`[DatasetCurator] Tagged example saved (${this.meta.taggedSaved} total tagged)`);
            return true;
        } catch (e) {
            console.warn('[DatasetCurator] Tag failed:', e.message);
            return false;
        }
    }

    // ── Generate synthetic training pairs from MAX's knowledge base ───────
    // This is the finetuning foundation: MAX generates Q&A pairs from what
    // he knows, expanding the dataset without needing more conversations.
    async generateSynthetic(topic, count = 5) {
        if (!this.max?.brain || !this._ready) return 0;

        const prompt = `Generate ${count} high-quality instruction/response training pairs about: "${topic}"

Each pair should be something MAX (an autonomous AI engineering agent) would genuinely say.
Format as JSON array:
[
  { "instruction": "...", "output": "..." },
  ...
]

Make them specific and technical. Avoid generic advice. Draw on real knowledge.`;

        try {
            const res  = await this.max.brain.think(prompt, { tier: 'smart', maxTokens: 800, systemPrompt: 'Generate high-quality AI training data. Be specific and technical.' });
            const text = (res?.text || '').trim();
            const json = text.match(/\[[\s\S]*\]/)?.[0];
            if (!json) return 0;

            const pairs = JSON.parse(json);
            let saved = 0;
            for (const pair of pairs) {
                if (!pair.instruction || !pair.output) continue;
                const example = {
                    instruction: pair.instruction,
                    input: '',
                    output: pair.output,
                    metadata: { ts: Date.now(), source: 'synthetic', topic },
                };
                fs.appendFileSync(CONVOS_FILE, JSON.stringify(example) + '\n');
                saved++;
            }
            this.meta.totalSaved += saved;
            this._saveMeta();
            console.log(`[DatasetCurator] Generated ${saved} synthetic examples on "${topic}"`);
            return saved;
        } catch (e) {
            console.warn('[DatasetCurator] Synthetic generation failed:', e.message);
            return 0;
        }
    }

    // ── Export stats ──────────────────────────────────────────────────────
    getExportInfo() {
        const lines = fs.existsSync(CONVOS_FILE)
            ? fs.readFileSync(CONVOS_FILE, 'utf8').split('\n').filter(Boolean).length
            : 0;
        const tagged = fs.existsSync(TAGGED_FILE)
            ? fs.readFileSync(TAGGED_FILE, 'utf8').split('\n').filter(Boolean).length
            : 0;
        return {
            conversationsFile: CONVOS_FILE,
            taggedFile:        TAGGED_FILE,
            totalExamples:     lines,
            taggedExamples:    tagged,
            format:            'Alpaca (instruction/input/output)',
            note:              'Ready for LoRA finetuning via Axolotl or Unsloth',
        };
    }

    // ── Quick scoring via fast brain tier ─────────────────────────────────
    async _quickScore(userMessage, maxResponse) {
        try {
            const prompt = `Rate this AI interaction from 1-10. Only output the number.

User: ${userMessage.slice(0, 300)}
AI: ${maxResponse.slice(0, 500)}

Score (1=bad, 10=exceptional):`;
            const res  = await this.max.brain.think(prompt, { tier: 'fast', maxTokens: 5, systemPrompt: 'Output only a number from 1-10.' });
            const text = (res?.text || '').trim();
            const num  = parseFloat(text.match(/\d+(\.\d+)?/)?.[0] || '0');
            return isNaN(num) ? 0 : Math.min(10, Math.max(0, num));
        } catch { return 0; }
    }

    getStatus() {
        return {
            ready:        this._ready,
            totalSaved:   this.meta.totalSaved,
            taggedSaved:  this.meta.taggedSaved,
            totalSkipped: this.meta.totalSkipped,
            lastSaved:    this.meta.lastSaved,
            datasetPath:  DATASET_DIR,
            export:       this.getExportInfo(),
        };
    }
}
