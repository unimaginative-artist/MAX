// ═══════════════════════════════════════════════════════════════════════════
// SelfCodeInspector.js — MAX reads his own source code
//
// Scans MAX's own files for TODO/FIXME/HACK comments, incomplete patterns,
// and structural gaps. Queues findings as GoalEngine goals so MAX
// autonomously works to improve himself over time.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// Directories to inspect (relative to ROOT)
const SCAN_DIRS = ['core', 'tools', 'memory', 'personas', 'onboarding', 'swarm', 'debate'];

// Patterns that indicate incomplete or improvable code
const MARKERS = [
    { pattern: /\/\/\s*TODO[:\s]/gi,        label: 'TODO',       priority: 0.65 },
    { pattern: /\/\/\s*FIXME[:\s]/gi,       label: 'FIXME',      priority: 0.80 },
    { pattern: /\/\/\s*HACK[:\s]/gi,        label: 'HACK',       priority: 0.70 },
    { pattern: /\/\/\s*INCOMPLETE/gi,       label: 'INCOMPLETE', priority: 0.75 },
    { pattern: /throw new Error\('not implemented'\)/gi, label: 'NOT_IMPL', priority: 0.85 },
    { pattern: /case\s+[^:]+:\s*(?!\s*break;|\s*return\s+|\s*throw\s+|\s*\/\*\s*fall\s*through\s*\*\/)/gi, label: 'MISSING_BREAK', priority: 0.60 },
    { pattern: /console\.log\(/g,           label: 'LOG_NOISE',  priority: 0.30 },
    { pattern: /return null;\s*\/\/ placeholder/gi,     label: 'PLACEHOLDER', priority: 0.60 }
];

export class SelfCodeInspector {
    constructor(goalEngine) {
        this.goals    = goalEngine;
        this._lastRun = 0;
        this._findings = [];
    }

    // ─── Run a full inspection pass ───────────────────────────────────────
    async inspect() {
        const now = Date.now();
        this._findings = [];

        for (const dir of SCAN_DIRS) {
            const dirPath = path.join(ROOT, dir);
            if (!fs.existsSync(dirPath)) continue;

            const files = fs.readdirSync(dirPath)
                .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
                .map(f => path.join(dirPath, f));

            for (const file of files) {
                this._scanFile(file);
            }
        }

        // Also scan launcher
        this._scanFile(path.join(ROOT, 'launcher.mjs'));

        this._lastRun = now;
        console.log(`[SelfInspector] 🔍 Scanned ${SCAN_DIRS.length} dirs — found ${this._findings.length} items`);
        return this._findings;
    }

    _scanFile(filePath) {
        try {
            const content  = fs.readFileSync(filePath, 'utf8');
            const lines    = content.split('\n');
            const relPath  = path.relative(ROOT, filePath);

            for (const { pattern, label, priority } of MARKERS) {
                let match;
                pattern.lastIndex = 0;

                while ((match = pattern.exec(content)) !== null) {
                    // Find which line number
                    const upTo   = content.slice(0, match.index);
                    const lineNo = upTo.split('\n').length;
                    const line   = lines[lineNo - 1]?.trim() || '';

                    this._findings.push({
                        file:     relPath,
                        line:     lineNo,
                        label,
                        text:     line.slice(0, 120),
                        priority
                    });
                }
            }
        } catch { /* non-fatal — skip unreadable files */ }
    }

    // ─── Queue top findings as GoalEngine goals ───────────────────────────
    queueGoals(maxGoals = 3) {
        if (!this.goals || this._findings.length === 0) return [];

        // Sort by priority, dedupe by file+line
        const seen    = new Set();
        const unique  = this._findings
            .sort((a, b) => b.priority - a.priority)
            .filter(f => {
                const key = `${f.file}:${f.line}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

        const queued = [];
        for (const finding of unique.slice(0, maxGoals)) {
            const title = `Self-improvement: ${finding.label} in ${finding.file}:${finding.line}`;
            const desc  = `Found a ${finding.label} in my own source code that needs attention.\nFile: ${finding.file} (line ${finding.line})\nCode: ${finding.text}\nInvestigate and improve this.`;

            const id = this.goals.addGoal({
                title,
                description: desc,
                type:        'improvement',
                source:      'auto',
                priority:    finding.priority
            });

            if (id) queued.push({ id, finding });
        }

        return queued;
    }

    // ─── Summarize findings for display ───────────────────────────────────
    getSummary() {
        if (this._findings.length === 0) return 'No issues found in self-inspection.';

        const byLabel = {};
        for (const f of this._findings) {
            byLabel[f.label] = (byLabel[f.label] || 0) + 1;
        }

        const breakdown = Object.entries(byLabel)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => `${label}: ${count}`)
            .join(', ');

        return `Self-inspection: ${this._findings.length} findings (${breakdown})`;
    }

    getStatus() {
        return {
            findings: this._findings.length,
            lastRun:  this._lastRun ? new Date(this._lastRun).toISOString() : 'never',
            summary:  this.getSummary()
        };
    }
}
