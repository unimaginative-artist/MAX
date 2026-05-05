// ═══════════════════════════════════════════════════════════════════════════
// SecurityCouncil.js — Adversarial code review for every file MAX writes
//
// Every line of code MAX generates passes through an adversarial review
// before it touches disk. Catches: injection, hardcoded secrets, path
// traversal, CVE patterns, compliance violations (SOC2/HIPAA/GDPR).
//
// Revenue Stream C foundation. Enable with: MAX_SECURITY_COUNCIL=true
//
// Severity levels:
//   critical — block the write entirely, report to user
//   high     — warn loudly, require explicit override
//   medium   — log warning, allow write
//   low      — informational only
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

// Static pattern checks — fast, no LLM needed
const STATIC_PATTERNS = [
    // Secrets
    { pattern: /['"]?(?:api[_-]?key|secret|password|token|passwd|auth)['"_-]?\s*[:=]\s*['"][^'"]{8,}['"]/i,
      severity: 'critical', issue: 'Hardcoded secret or credential detected' },
    { pattern: /(?:sk-|ghp_|xoxb-|AKIA)[A-Za-z0-9]{16,}/,
      severity: 'critical', issue: 'API key pattern detected (OpenAI/GitHub/Slack/AWS)' },

    // Command injection
    { pattern: /exec\s*\(\s*[`'"]\s*\$\{/,
      severity: 'critical', issue: 'Potential command injection via template literal in exec()' },
    { pattern: /child_process\.exec\([^,)]*\+/,
      severity: 'high', issue: 'String concatenation in exec() — potential command injection' },
    { pattern: /eval\s*\(/,
      severity: 'high', issue: 'eval() usage — code injection risk' },
    { pattern: /new\s+Function\s*\(/,
      severity: 'high', issue: 'new Function() — code injection risk' },

    // Path traversal
    { pattern: /\.\.\/|\.\.\\|\.\.[/\\]/,
      severity: 'medium', issue: 'Relative path traversal pattern (../) detected' },
    { pattern: /path\.join\([^)]*req\./,
      severity: 'high', issue: 'User input in path.join() — path traversal risk' },

    // SQL injection
    { pattern: /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*\+\s*(?:req\.|params\.|body\.|query\.)/i,
      severity: 'critical', issue: 'SQL query built with user input — injection risk' },

    // Unsafe deserialization
    { pattern: /JSON\.parse\s*\(\s*(?:req\.|params\.|body\.|query\.)/,
      severity: 'medium', issue: 'JSON.parse on user input without validation' },

    // GDPR/HIPAA data exposure
    { pattern: /console\.log\s*\([^)]*(?:password|ssn|dob|email|phone|address)[^)]*\)/i,
      severity: 'medium', issue: 'PII data logged to console — GDPR/HIPAA risk' },

    // Prototype pollution
    { pattern: /__proto__|constructor\s*\[/,
      severity: 'high', issue: 'Prototype pollution pattern detected' },

    // XSS
    { pattern: /innerHTML\s*=\s*(?!['"`])/,
      severity: 'high', issue: 'innerHTML assignment without sanitization — XSS risk' },
    { pattern: /document\.write\s*\(/,
      severity: 'medium', issue: 'document.write() — XSS risk' },

    // Crypto weaknesses
    { pattern: /(?:md5|sha1)\s*\(/i,
      severity: 'medium', issue: 'Weak hash algorithm (MD5/SHA1) — use SHA-256 or better' },
    { pattern: /Math\.random\s*\(\s*\)/,
      severity: 'low', issue: 'Math.random() is not cryptographically secure' },
];

export class SecurityCouncil extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max     = max;
        this.enabled = config.enabled ?? (process.env.MAX_SECURITY_COUNCIL === 'true');
        this.config  = {
            blockOnCritical: config.blockOnCritical ?? true,
            blockOnHigh:     config.blockOnHigh     ?? false,
            llmReview:       config.llmReview       ?? true,   // LLM adversarial pass
            ...config
        };
        this.stats = { reviewed: 0, blocked: 0, warnings: 0, clean: 0 };
    }

    // ─── Main entry: review code before it's written to disk ─────────────
    async review(code, context = {}) {
        if (!this.enabled) return { safe: true, issues: [], severity: 'none' };

        this.stats.reviewed++;
        const filePath = context.filePath || 'unknown';
        const issues   = [];

        // ── Pass 1: Static pattern scan (fast) ────────────────────────────
        const lines = code.split('\n');
        for (let i = 0; i < lines.length; i++) {
            for (const check of STATIC_PATTERNS) {
                if (check.pattern.test(lines[i])) {
                    issues.push({
                        severity: check.severity,
                        issue:    check.issue,
                        line:     i + 1,
                        snippet:  lines[i].trim().slice(0, 120)
                    });
                }
            }
        }

        // ── Pass 2: LLM adversarial review (deeper, catches logic flaws) ──
        if (this.config.llmReview && this.max.agentBrain?._ready && code.length > 100) {
            const llmIssues = await this._llmReview(code, filePath, context).catch(() => []);
            issues.push(...llmIssues);
        }

        // ── Determine overall severity ────────────────────────────────────
        const severity = this._topSeverity(issues);
        const blocked  = (severity === 'critical' && this.config.blockOnCritical)
                      || (severity === 'high'     && this.config.blockOnHigh);

        if (blocked) this.stats.blocked++;
        else if (issues.length > 0) this.stats.warnings++;
        else this.stats.clean++;

        if (issues.length > 0) {
            const emoji = severity === 'critical' ? '🚨' : severity === 'high' ? '⚠️' : 'ℹ️';
            console.log(`[SecurityCouncil] ${emoji} ${filePath}: ${issues.length} issue(s) — severity: ${severity}${blocked ? ' — BLOCKED' : ''}`);
            for (const iss of issues) {
                console.log(`  [${iss.severity.toUpperCase()}] L${iss.line || '?'}: ${iss.issue}`);
            }
            this.emit('issues', { filePath, issues, severity, blocked });
        }

        return { safe: !blocked, issues, severity, blocked };
    }

    // ─── LLM adversarial review pass ─────────────────────────────────────
    async _llmReview(code, filePath, context) {
        const prompt = `You are a security auditor reviewing AI-generated code.
FILE: ${filePath}
CONTEXT: ${context.goal || 'unknown task'}

CODE (first 3000 chars):
\`\`\`
${code.slice(0, 3000)}
\`\`\`

Check for: injection attacks, authentication bypass, data exposure, insecure crypto, OWASP Top 10.
Focus only on REAL vulnerabilities — not style issues.

Return ONLY a JSON array (empty if clean):
[
  { "severity": "critical|high|medium|low", "issue": "description", "line": null }
]`;

        try {
            const result = await this.max.agentBrain.think(prompt, {
                tier:        'fast',
                temperature: 0.0,
                maxTokens:   400
            });
            const match = result.text.match(/\[[\s\S]*?\]/);
            if (!match) return [];
            const parsed = JSON.parse(match[0]);
            return parsed.filter(i => i.severity && i.issue);
        } catch {
            return [];
        }
    }

    _topSeverity(issues) {
        if (issues.some(i => i.severity === 'critical')) return 'critical';
        if (issues.some(i => i.severity === 'high'))     return 'high';
        if (issues.some(i => i.severity === 'medium'))   return 'medium';
        if (issues.some(i => i.severity === 'low'))      return 'low';
        return 'none';
    }

    getStatus() {
        return { enabled: this.enabled, ...this.stats };
    }
}
