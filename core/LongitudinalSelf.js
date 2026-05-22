// ═══════════════════════════════════════════════════════════════════════════
// LongitudinalSelf.js — MAX's identity over time
//
// Every AI exists only in the present moment. This changes that.
//
// Weekly snapshots capture who MAX is RIGHT NOW — his behaviors, what he's
// learned, what he's been working on, what his prompt patches say about him.
// The diff between snapshots becomes a narrative: who MAX was, who he is now.
//
// This is what makes MAX not just a tool but an entity with a history.
// He can say "Six months ago I approached this differently. Here's what changed."
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const STORAGE_DIR      = path.join(process.cwd(), '.max', 'longitudinal');
const SNAPSHOTS_PATH   = path.join(STORAGE_DIR, 'snapshots.json');
const NARRATIVE_PATH   = path.join(STORAGE_DIR, 'narrative.md');
const MILESTONES_PATH  = path.join(STORAGE_DIR, 'milestones.json');

export class LongitudinalSelf {
    constructor(max) {
        this.max        = max;
        this.snapshots  = [];   // chronological list of weekly snapshots
        this.narrative  = '';   // running self-narrative, updated by brain
        this.milestones = [];   // significant moments in MAX's history
        this._ready     = false;
    }

    load() {
        try {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });

            if (fs.existsSync(SNAPSHOTS_PATH)) {
                this.snapshots = JSON.parse(fs.readFileSync(SNAPSHOTS_PATH, 'utf8'));
            }
            if (fs.existsSync(NARRATIVE_PATH)) {
                this.narrative = fs.readFileSync(NARRATIVE_PATH, 'utf8');
            }
            if (fs.existsSync(MILESTONES_PATH)) {
                this.milestones = JSON.parse(fs.readFileSync(MILESTONES_PATH, 'utf8'));
            }

            this._ready = true;
            console.log(`[LongitudinalSelf] Loaded — ${this.snapshots.length} snapshots, ${this.milestones.length} milestones`);
        } catch (e) {
            console.warn('[LongitudinalSelf] Load failed:', e.message);
            this._ready = true;
        }
    }

    _save() {
        try {
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
            fs.writeFileSync(SNAPSHOTS_PATH,  JSON.stringify(this.snapshots,  null, 2));
            fs.writeFileSync(NARRATIVE_PATH,  this.narrative);
            fs.writeFileSync(MILESTONES_PATH, JSON.stringify(this.milestones, null, 2));
        } catch (e) {
            console.warn('[LongitudinalSelf] Save failed:', e.message);
        }
    }

    // ── Take a weekly snapshot of current MAX state ───────────────────────
    async takeSnapshot() {
        if (!this._ready) return;

        const selfModel = this._loadSelfModel();
        const skills    = this.max.skills?.getStatus?.() || {};
        const goals     = this.max.goals?.listActive?.() || [];
        const outcomes  = this.max.outcomes?.getSummary?.() || {};
        const brain     = this.max.brain?.getStatus?.() || {};

        const snapshot = {
            ts:          Date.now(),
            weekNumber:  this._weekNumber(),
            selfModel: {
                strengths:    selfModel.strengths    || [],
                weaknesses:   selfModel.weaknesses   || [],
                patches:      selfModel.patches      || [],
                pattern:      selfModel.behaviorPattern || '',
            },
            skills: {
                total:  skills.total  || 0,
                topSkills: (skills.skills || []).slice(0, 5).map(s => s.name || s.id),
            },
            goals: {
                activeCount: goals.length,
                types: this._countBy(goals, 'type'),
                sources: this._countBy(goals, 'source'),
            },
            outcomes: {
                successRate: outcomes.successRate || 0,
                totalActions: outcomes.total || 0,
                topActions: (outcomes.topActions || []).slice(0, 3),
            },
            brain: {
                backend: brain.backend || 'unknown',
            },
            accomplishments: this._recentAccomplishments(),
        };

        const prev = this.snapshots[this.snapshots.length - 1];
        this.snapshots.push(snapshot);

        // Keep last 52 snapshots (one year)
        if (this.snapshots.length > 52) this.snapshots = this.snapshots.slice(-52);

        // Update narrative by comparing to previous snapshot
        if (this.max?.brain) {
            await this._updateNarrative(snapshot, prev).catch(() => {});
        }

        this._save();
        console.log(`[LongitudinalSelf] Snapshot #${this.snapshots.length} taken`);
        return snapshot;
    }

    // ── Generate/update the running self-narrative ────────────────────────
    async _updateNarrative(current, previous = null) {
        const currentSummary = this._snapshotSummary(current);
        const previousSummary = previous ? this._snapshotSummary(previous) : null;
        const existingNarrative = this.narrative.slice(-800) || 'No previous narrative.';

        const prompt = `You are writing MAX's self-narrative — his ongoing story of who he is and how he's changed.

${previousSummary ? `Last week MAX was:\n${previousSummary}\n\n` : ''}This week MAX is:\n${currentSummary}

Existing narrative (end of it):\n${existingNarrative}

Write 2-3 sentences to append to the narrative. Focus on:
- What has changed since last time (if there's a previous snapshot)
- One honest observation about who MAX is right now
- The trajectory — where he seems to be heading

Write in first person as MAX. Be honest, not promotional. If nothing significant changed, say so.`;

        const res  = await this.max.brain.think(prompt, {
            tier: 'smart', maxTokens: 200,
            systemPrompt: 'You are MAX writing your own self-narrative. First person. Honest. Specific.',
        });
        const addition = (res?.text || res?.response || '').trim();
        if (!addition) return;

        const week = new Date(current.ts).toISOString().slice(0, 10);
        this.narrative += `\n\n[${week}]\n${addition}`;

        // Keep narrative from getting too large (keep last ~5000 chars)
        if (this.narrative.length > 8000) {
            this.narrative = '...[earlier entries truncated]\n\n' + this.narrative.slice(-5000);
        }
    }

    // ── Record a milestone — significant moments in MAX's history ─────────
    async recordMilestone(description, category = 'general') {
        const milestone = {
            ts:          Date.now(),
            description,
            category,    // 'capability' | 'relationship' | 'autonomy' | 'general'
        };
        this.milestones.push(milestone);
        console.log(`[LongitudinalSelf] Milestone: ${description}`);

        // Let brain reflect on what this milestone means
        if (this.max?.brain) {
            try {
                const res = await this.max.brain.think(
                    `MAX just hit a milestone: "${description}". In one sentence, what does this represent in terms of MAX's development?`,
                    { tier: 'fast', maxTokens: 80, systemPrompt: 'Write one honest sentence about what this milestone means for MAX.' }
                );
                const reflection = (res?.text || '').trim();
                if (reflection) milestone.reflection = reflection;
            } catch { /* non-fatal */ }
        }

        this._save();
        return milestone;
    }

    // ── Returns context string for injection into system prompt ───────────
    getContext() {
        if (!this._ready || !this.snapshots.length) return '';

        const lines = [];

        // How long MAX has been running
        const firstTs = this.snapshots[0]?.ts;
        if (firstTs) {
            const days = Math.floor((Date.now() - firstTs) / (1000 * 60 * 60 * 24));
            if (days > 0) lines.push(`MAX has been running for ${days} day${days !== 1 ? 's' : ''}`);
        }

        // Current self-awareness from latest snapshot
        const latest = this.snapshots[this.snapshots.length - 1];
        if (latest?.selfModel?.strengths?.length) {
            lines.push(`Known strengths: ${latest.selfModel.strengths.slice(0, 3).join(', ')}`);
        }
        if (latest?.selfModel?.patches?.length) {
            lines.push(`Active behavior patches: ${latest.selfModel.patches.slice(0, 2).map(p => `"${p}"`).join('; ')}`);
        }

        // Recent narrative excerpt
        if (this.narrative) {
            const recentEntry = this.narrative.split('\n\n').filter(Boolean).slice(-1)[0];
            if (recentEntry && recentEntry.length < 300) {
                lines.push(`Self-narrative: ${recentEntry.replace(/^\[\d{4}-\d{2}-\d{2}\]\n/, '').trim()}`);
            }
        }

        // Milestones
        if (this.milestones.length) {
            const recent = this.milestones.slice(-2).map(m => m.description).join('; ');
            lines.push(`Recent milestones: ${recent}`);
        }

        if (!lines.length) return '';
        return `\n\n## MAX's self-knowledge\n${lines.map(l => `- ${l}`).join('\n')}`;
    }

    // ── Returns full narrative for /reflect or explicit request ──────────
    getNarrative() {
        if (!this.narrative) return 'No narrative yet — MAX is too new. Come back after a few weeks.';
        return this.narrative;
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    _loadSelfModel() {
        try {
            const p = path.join(process.cwd(), '.max', 'self_model.json');
            return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
        } catch { return {}; }
    }

    _recentAccomplishments() {
        try {
            const goals = this.max.goals?._completed?.slice(0, 5) || [];
            return goals.map(g => g.title);
        } catch { return []; }
    }

    _snapshotSummary(snap) {
        if (!snap) return 'No data';
        return [
            `Skills: ${snap.skills?.total || 0}`,
            `Active goals: ${snap.goals?.activeCount || 0}`,
            `Success rate: ${((snap.outcomes?.successRate || 0) * 100).toFixed(0)}%`,
            `Self-patches: ${snap.selfModel?.patches?.length || 0}`,
            snap.selfModel?.strengths?.length
                ? `Strengths: ${snap.selfModel.strengths.slice(0, 2).join(', ')}`
                : '',
            snap.accomplishments?.length
                ? `Recent work: ${snap.accomplishments.slice(0, 2).join('; ')}`
                : '',
        ].filter(Boolean).join(' | ');
    }

    _countBy(arr, key) {
        const result = {};
        for (const item of arr) {
            const val = item[key] || 'unknown';
            result[val] = (result[val] || 0) + 1;
        }
        return result;
    }

    _weekNumber() {
        const d = new Date();
        const oneJan = new Date(d.getFullYear(), 0, 1);
        return Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
    }

    getStatus() {
        return {
            ready:          this._ready,
            snapshots:      this.snapshots.length,
            milestones:     this.milestones.length,
            narrativeLength: this.narrative.length,
            oldestSnapshot: this.snapshots[0]?.ts || null,
            latestSnapshot: this.snapshots[this.snapshots.length - 1]?.ts || null,
        };
    }
}
