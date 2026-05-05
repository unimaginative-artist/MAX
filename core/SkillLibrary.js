// ═══════════════════════════════════════════════════════════════════════════
// SkillLibrary.js — MAX's procedural memory (muscle memory)
//
// When MAX successfully completes a goal, the winning plan is encoded as a
// reusable skill. Next time a similar goal appears, the proven approach is
// injected into the planner so MAX doesn't reinvent from scratch.
//
// Persists to .max/skills.json across restarts.
// Keeps top 50 skills ranked by successRate × usedCount.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs/promises';
import path from 'path';

const SKILLS_FILE = path.join(process.cwd(), '.max', 'skills.json');
const MAX_SKILLS  = 50;

export class SkillLibrary {
    constructor() {
        this._skills = [];  // [{id, name, trigger, summary, goalType, steps, successRate, usedCount, lastUsed}]
    }

    // ─── Prune stale / low-signal skills ──────────────────────────────────
    // Removes skills unused for 30+ days that were never reinforced (used < 3x).
    // These are one-off flukes — keeping them would pollute recall results.
    prune() {
        const STALE_MS = 30 * 24 * 60 * 60 * 1000;
        const before   = this._skills.length;
        this._skills   = this._skills.filter(s => {
            const age = Date.now() - (s.lastUsed || 0);
            return !(age > STALE_MS && s.usedCount < 3);
        });
        const pruned = before - this._skills.length;
        if (pruned > 0) console.log(`[SkillLibrary] 🗑️  Pruned ${pruned} stale skill(s)`);
    }

    // ─── Load persisted skills on boot ────────────────────────────────────
    async initialize() {
        try {
            await fs.mkdir(path.dirname(SKILLS_FILE), { recursive: true });
            const raw  = await fs.readFile(SKILLS_FILE, 'utf8');
            const data = JSON.parse(raw);
            this._skills = data.skills || [];
            this.prune();  // drop stale skills from prior sessions on boot
            if (this._skills.length > 0) {
                console.log(`[SkillLibrary] ✅ Loaded ${this._skills.length} skills`);
            }
        } catch { /* fresh start */ }
    }

    // ─── Encode a successful AgentLoop run as a reusable skill ────────────
    // Called fire-and-forget after goalSuccess = true.
    async encodeFromRun(goal, steps, brain) {
        if (!brain?._ready || !steps?.length) return null;
        if (!['fix', 'improvement', 'research', 'task'].includes(goal.type)) return null;

        const stepSummary = steps
            .map(s => `${s.step}. [${s.tool}] ${s.action}`)
            .join('\n');

        try {
            const result = await brain.think(
                `A task was completed successfully. Encode it as a reusable skill pattern.

GOAL: ${goal.title}
TYPE: ${goal.type}
STEPS THAT WORKED:
${stepSummary}

Return ONLY a JSON object:
{
  "name": "short_snake_case_name",
  "trigger": "one sentence: when to use this skill (what kind of goal it solves)",
  "summary": "one sentence: what this skill does"
}`,
                { temperature: 0.2, maxTokens: 150, tier: 'fast' }
            );

            const match = result.text.match(/\{[\s\S]*?\}/);
            if (!match) return null;

            const meta = JSON.parse(match[0]);
            if (!meta.name || !meta.trigger) return null;

            // Upsert: update existing skill if same name found
            const existing = this._skills.find(s => s.name === meta.name);
            if (existing) {
                existing.usedCount++;
                existing.successRate = Math.min(1.0, existing.successRate + 0.05);
                existing.lastUsed    = Date.now();
                existing.steps       = steps;  // update to latest winning plan
            } else {
                this._skills.push({
                    id:          `skill_${Date.now()}`,
                    name:        meta.name,
                    trigger:     meta.trigger,
                    summary:     meta.summary || '',
                    goalType:    goal.type,
                    steps,
                    successRate: 1.0,
                    usedCount:   1,
                    lastUsed:    Date.now()
                });
            }

            // Keep top MAX_SKILLS by composite score; prune stale entries
            this.prune();
            this._skills.sort((a, b) => (b.successRate * b.usedCount) - (a.successRate * a.usedCount));
            if (this._skills.length > MAX_SKILLS) this._skills.pop();

            // ─── Phase 4: Cognitive Capacitor (Autonomous Tool Generation) ───
            // If a skill is used multiple times successfully, promote it to a permanent tool
            const promoted = existing || this._skills.find(s => s.name === meta.name);
            if (promoted && promoted.usedCount >= 2 && promoted.successRate >= 0.9) {
                await this._promoteToTool(promoted, brain);
            }

            await this._save();
            console.log(`[SkillLibrary] 💾 Encoded skill: "${meta.name}"`);
            return meta.name;

        } catch (e) {
            console.warn('[SkillLibrary] Encode error:', e.message);
            return null;
        }
    }

    async _promoteToTool(skill, brain) {
        const toolDir = path.join(process.cwd(), 'tools', 'generated');
        const toolFile = path.join(toolDir, `${skill.name}.js`);
        
        // Check if tool already exists
        try {
            await fs.access(toolFile);
            return; // Already promoted
        } catch {}

        console.log(`[SkillLibrary] 🚀 Promoting skill "${skill.name}" to Executable Tool...`);

        const prompt = `Convert this successful engineering skill pattern into a standalone Node.js tool.
SKILL: ${skill.name}
STEPS:
${skill.steps.map(s => `${s.step}. [${s.tool}] ${s.action}`).join('\n')}

The tool must be an object exported as 'export const ${skill.name} = { ... }'.
It should use the ToolRegistry for any sub-tool calls.
Return ONLY the raw JavaScript code inside a markdown block.`;

        try {
            const res = await brain.think(prompt, { tier: 'smart', temperature: 0.1 });
            const code = res.text.match(/```javascript\n([\s\S]*?)```/)?.[1] || res.text.match(/```\n([\s\S]*?)```/)?.[1];
            
            if (code) {
                await fs.mkdir(toolDir, { recursive: true });
                await fs.writeFile(toolFile, code);
                console.log(`[SkillLibrary] ✨ Autonomous Tool Created: tools/generated/${skill.name}.js`);
            }
        } catch (err) {
            console.warn(`[SkillLibrary] ⚠️ Tool promotion failed: ${err.message}`);
        }
    }

    // ─── Find a relevant skill for a goal — returns best match or null ────
    async recall(goalTitle) {
        if (this._skills.length === 0) return null;

        const words = goalTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (words.length === 0) return null;

        const candidates = this._skills.filter(s => {
            const searchable = `${s.trigger} ${s.name} ${s.summary}`.toLowerCase();
            return words.some(w => searchable.includes(w));
        });

        if (candidates.length === 0) return null;

        // Rank by composite score
        candidates.sort((a, b) => (b.successRate * b.usedCount) - (a.successRate * a.usedCount));
        const best = candidates[0];
        console.log(`[SkillLibrary] 🧠 Found skill: "${best.name}" (used ${best.usedCount}x, ${(best.successRate * 100).toFixed(0)}% success)`);
        return best;
    }

    getStatus() {
        return {
            count:     this._skills.length,
            topSkills: this._skills.slice(0, 5).map(s => `${s.name} (${s.usedCount}x)`)
        };
    }

    async _save() {
        try {
            await fs.writeFile(SKILLS_FILE, JSON.stringify({ skills: this._skills }, null, 2));
        } catch { /* non-fatal */ }
    }
}
