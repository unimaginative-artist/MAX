// ═══════════════════════════════════════════════════════════════════════════
// UserProfile.js — reads user.md and tasks.md, injects into MAX's context
// MAX calls this on every boot and the scheduler calls it every 30 minutes.
// The user can edit these files directly — MAX picks up the changes.
// ═══════════════════════════════════════════════════════════════════════════

import fs                       from 'fs';
import path                     from 'path';
import { COMMUNICATION_STYLES } from './FirstRun.js';

const DATA_DIR  = path.join(process.cwd(), '.max');
const USER_FILE = path.join(DATA_DIR, 'user.md');
const TASK_FILE = path.join(DATA_DIR, 'tasks.md');

export class UserProfile {
    constructor() {
        this._user      = null;
        this._tasks     = null;
        this._name      = 'User';
        this._styleKey  = 'chill';
        this._lastRead  = 0;
    }

    // ─── Load / reload files from disk ───────────────────────────────────
    load() {
        try {
            if (fs.existsSync(USER_FILE)) {
                this._user = fs.readFileSync(USER_FILE, 'utf8');
                const nameMatch  = this._user.match(/\*\*Name:\*\*\s*(.+)/);
                const styleMatch = this._user.match(/\*\*Communication Style:\*\*\s*(.+)/);
                if (nameMatch)  this._name     = nameMatch[1].trim();
                if (styleMatch) this._styleKey = styleMatch[1].trim().toLowerCase();
            }
        } catch { /* non-fatal */ }

        try {
            if (fs.existsSync(TASK_FILE)) {
                this._tasks = fs.readFileSync(TASK_FILE, 'utf8');
            }
        } catch { /* non-fatal */ }

        this._lastRead = Date.now();
    }

    // ─── Reload if files have changed on disk ─────────────────────────────
    refresh() {
        try {
            const userMtime  = fs.existsSync(USER_FILE) ? fs.statSync(USER_FILE).mtimeMs  : 0;
            const tasksMtime = fs.existsSync(TASK_FILE) ? fs.statSync(TASK_FILE).mtimeMs : 0;
            const newest     = Math.max(userMtime, tasksMtime);
            if (newest > this._lastRead) {
                this.load();
                return true;  // was updated
            }
        } catch { /* non-fatal */ }
        return false;
    }

    get name()    { return this._name; }
    get hasProfile() { return !!this._user; }

    // ─── Build the context block injected into every system prompt ─────────
    buildContextBlock() {
        if (!this._user && !this._tasks) return '';

        const parts = ['\n\n## Who you\'re working with'];

        if (this._user) {
            // Pull out the most useful fields — skip the style line (handled separately below)
            const lines = this._user.split('\n').filter(l => l.trim());
            const relevant = lines.filter(l =>
                (l.startsWith('**') && !l.includes('Communication Style')) ||
                l.startsWith('##') ||
                (l.length > 5 && !l.startsWith('#') && !l.startsWith('>'))
            ).slice(0, 20);
            parts.push(relevant.join('\n'));
        }

        if (this._tasks) {
            parts.push('\n## Their current tasks');
            const activeLines = this._tasks.split('\n').filter(l =>
                l.includes('- [ ]') || l.includes('- [~]') || l.startsWith('## Active') || l.startsWith('## Goals')
            ).slice(0, 15);
            if (activeLines.length > 0) parts.push(activeLines.join('\n'));
        }

        // ── Communication style instruction ──
        // Inject the full personality instruction so it shapes every response
        const style = COMMUNICATION_STYLES[this._styleKey] || COMMUNICATION_STYLES.chill;
        parts.push(`\n## How to talk to this person\n${style.instruction}`);

        return parts.join('\n');
    }

    get styleKey() { return this._styleKey; }
    get styleName() { return (COMMUNICATION_STYLES[this._styleKey] || COMMUNICATION_STYLES.chill).label; }

    // ─── Get just the active task list as an array ────────────────────────
    getActiveTasks() {
        if (!this._tasks) return [];
        return this._tasks.split('\n')
            .filter(l => l.includes('- [ ]') || l.includes('- [~]'))
            .map(l => l.replace(/- \[.\]\s*/, '').trim())
            .filter(Boolean);
    }

    // ─── Mark a task complete in tasks.md ────────────────────────────────
    completeTask(taskText) {
        if (!fs.existsSync(TASK_FILE)) return false;
        try {
            let content = fs.readFileSync(TASK_FILE, 'utf8');
            // Find and check off
            const escaped = taskText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`- \\[.\\] ${escaped}`, 'i');
            if (!re.test(content)) return false;

            content = content.replace(re, `- [x] ${taskText}`);

            // Move to completed section
            const date    = new Date().toISOString().split('T')[0];
            const doneLine = `- [x] ${taskText} _(${date})_`;
            content = content.replace(`- [x] ${taskText}`, '');

            if (content.includes('## Completed')) {
                content = content.replace('## Completed', `## Completed\n${doneLine}`);
            } else {
                content += `\n## Completed\n${doneLine}\n`;
            }

            fs.writeFileSync(TASK_FILE, content);
            this.load();
            return true;
        } catch { return false; }
    }

    // ─── Add a new task to tasks.md ───────────────────────────────────────
    addTask(taskText, section = 'Active') {
        if (!fs.existsSync(TASK_FILE)) return false;
        try {
            let content = fs.readFileSync(TASK_FILE, 'utf8');
            const newLine = `- [ ] ${taskText}`;
            const sectionHeader = `## ${section}`;

            if (content.includes(sectionHeader)) {
                content = content.replace(sectionHeader, `${sectionHeader}\n${newLine}`);
            } else {
                content += `\n${sectionHeader}\n${newLine}\n`;
            }

            fs.writeFileSync(TASK_FILE, content);
            this.load();
            return true;
        } catch { return false; }
    }

    // ─── Append a note to user.md ─────────────────────────────────────────
    addNote(note) {
        if (!fs.existsSync(USER_FILE)) return;
        try {
            const date    = new Date().toISOString().split('T')[0];
            const content = fs.readFileSync(USER_FILE, 'utf8');
            const updated = content.replace(
                '## Notes\n',
                `## Notes\n- ${date}: ${note}\n`
            );
            fs.writeFileSync(USER_FILE, updated);
            this.load();
        } catch { /* non-fatal */ }
    }

    getStats() {
        const tasks = this.getActiveTasks();
        return {
            name:           this._name,
            hasProfile:     this.hasProfile,
            activeTasks:    tasks.length,
            tasks,
            lastRead:       new Date(this._lastRead).toISOString()
        };
    }
}
