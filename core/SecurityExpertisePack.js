import fs from 'fs';
import path from 'path';

const DEFAULT_SECURITY_DIR = path.join(process.cwd(), 'security');

const SURFACE_RULES = [
    {
        id: 'auth',
        checklist: 'auth.md',
        keywords: ['auth', 'login', 'logout', 'session', 'cookie', 'jwt', 'oauth', 'password', 'permission', 'role', 'admin']
    },
    {
        id: 'api',
        checklist: 'api.md',
        keywords: ['api', 'endpoint', 'route', 'express', 'server', 'webhook', 'request', 'response', 'cors']
    },
    {
        id: 'frontend',
        checklist: 'frontend-xss.md',
        keywords: ['frontend', 'ui', 'react', 'vue', 'html', 'dom', 'innerhtml', 'markdown', 'render', 'xss', 'browser']
    },
    {
        id: 'upload',
        checklist: 'file-upload.md',
        keywords: ['upload', 'file', 'image', 'attachment', 'download', 'storage', 'mime', 'multipart']
    },
    {
        id: 'payments',
        checklist: 'payments.md',
        keywords: ['payment', 'stripe', 'checkout', 'billing', 'invoice', 'subscription', 'refund', 'price']
    },
    {
        id: 'agent-tools',
        checklist: 'agent-tools.md',
        keywords: ['agent', 'tool', 'shell', 'exec', 'command', 'filesystem', 'mcp', 'automation', 'browser']
    },
    {
        id: 'predeploy',
        checklist: 'pre-deploy.md',
        keywords: ['deploy', 'production', 'release', 'ship', 'hosting', 'env', 'domain', 'ssl']
    }
];

export class SecurityExpertisePack {
    constructor(config = {}) {
        this.securityDir = config.securityDir || DEFAULT_SECURITY_DIR;
        this.maxChars = config.maxChars || 5000;
    }

    getContextForTask(taskText = '') {
        const lower = String(taskText).toLowerCase();
        const matched = SURFACE_RULES.filter(rule => rule.keywords.some(keyword => this._hasKeyword(lower, keyword)));

        const shouldInject = matched.length > 0 || /\b(build|create|implement|add|make|site|app|dashboard|database|user|data)\b/i.test(taskText);
        if (!shouldInject) return '';

        const doctrine = this._readRelative('SECURITY_DOCTRINE.md');
        const checklistFiles = [...new Set([
            path.join('checklists', 'secure-build.md'),
            ...matched.map(rule => path.join('checklists', rule.checklist))
        ])];

        const checklistText = checklistFiles
            .map(file => this._readRelative(file))
            .filter(Boolean)
            .join('\n\n');

        const skills = this._readSkillSummaries(matched.map(rule => rule.id));

        const context = [
            '## Security Expertise Pack',
            doctrine,
            checklistText ? `\n## Relevant Security Checklists\n${checklistText}` : '',
            skills ? `\n## Relevant Security Skills\n${skills}` : ''
        ].filter(Boolean).join('\n\n');

        return context.slice(0, this.maxChars);
    }

    _readSkillSummaries(surfaceIds = []) {
        const skillsDir = path.join(this.securityDir, 'skills');
        if (!fs.existsSync(skillsDir)) return '';

        const desired = new Set(['secure-build-review.md']);
        for (const id of surfaceIds) {
            if (id === 'auth') desired.add('audit-auth-flow.md');
            if (id === 'api') desired.add('audit-api-endpoints.md');
            if (id === 'frontend') desired.add('audit-frontend-xss.md');
            if (id === 'upload') desired.add('audit-file-upload.md');
            if (id === 'payments') desired.add('audit-payments.md');
            if (id === 'agent-tools') desired.add('audit-agent-tools.md');
            if (id === 'predeploy') desired.add('pre-deploy-security-check.md');
        }

        return [...desired]
            .map(file => this._readRelative(path.join('skills', file)))
            .filter(Boolean)
            .join('\n\n');
    }

    _readRelative(relativePath) {
        const fullPath = path.join(this.securityDir, relativePath);
        try {
            return fs.readFileSync(fullPath, 'utf8').trim();
        } catch {
            return '';
        }
    }

    _hasKeyword(text, keyword) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
    }

    getStatus() {
        return {
            loaded: fs.existsSync(this.securityDir),
            securityDir: this.securityDir,
            surfaces: SURFACE_RULES.map(rule => rule.id)
        };
    }
}
