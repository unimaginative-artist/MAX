import path from 'path';
import { commandPolicy } from './CommandPolicyEngine.js';

const LEVELS = ['off', 'observe', 'suggest', 'act', 'self_edit'];
const READ_ACTIONS = new Set(['read', 'list', 'grep', 'status', 'which', 'ps', 'search', 'fetch', 'quick']);
const FILE_WRITE_ACTIONS = new Set(['write', 'replace', 'patch', 'delete']);
const EXTERNAL_SEND_TOOLS = new Set(['discord', 'email']);
const EXTERNAL_SEND_ACTIONS = new Set(['send', 'reply', 'broadcast']);

function levelRank(level) {
    const idx = LEVELS.indexOf(String(level || '').toLowerCase());
    return idx === -1 ? LEVELS.indexOf('act') : idx;
}

function normalizeRel(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    return path.relative(process.cwd(), abs).replace(/\\/g, '/');
}

export class AutonomyPolicy {
    constructor(config = {}) {
        this.level = String(config.level || process.env.MAX_AUTONOMY || 'act').toLowerCase();
        if (!LEVELS.includes(this.level)) this.level = 'act';

        this.externalSend = config.externalSend ?? process.env.MAX_EXTERNAL_SEND === 'true';
        this.stats = {
            checked: 0,
            allowed: 0,
            blocked: 0,
            warnings: 0,
            lastDecision: null
        };
    }

    can(tool, action, params = {}, context = {}) {
        this.stats.checked++;
        const decision = this._decide(tool, action, params, context);
        this.stats.lastDecision = {
            tool,
            action,
            allowed: decision.allowed,
            reason: decision.reason,
            risk: decision.risk,
            ts: Date.now()
        };
        if (decision.allowed) this.stats.allowed++;
        else this.stats.blocked++;
        if (decision.warning) this.stats.warnings++;
        return decision;
    }

    _decide(tool, action, params, context) {
        const rank = levelRank(this.level);
        const source = params?.__source || context?.source || 'agent';

        if (this.level === 'off' && source !== 'ui') {
            return this._block('Autonomy is off; only direct UI actions are allowed', 'medium');
        }

        if (READ_ACTIONS.has(action)) {
            return this._allow('Read/status action', 'low');
        }

        if (tool === 'goals' && ['add', 'list', 'status'].includes(action)) {
            return rank >= levelRank('suggest')
                ? this._allow('Goal management allowed at suggest+', 'low')
                : this._block('Goal creation requires autonomy level suggest or higher', 'low');
        }

        if (tool === 'shell') {
            const command = String(params?.command || '');
            if (command) {
                const shellPolicy = commandPolicy.validate(command, params?.cwd || process.cwd());
                if (!shellPolicy.allowed) {
                    return this._block(`Shell policy blocked command: ${shellPolicy.reason}`, 'high');
                }
            }
            if (action === 'stop' && source !== 'ui' && rank < levelRank('self_edit')) {
                return this._block('Stopping processes autonomously requires self_edit level or direct UI action', 'high');
            }
            return rank >= levelRank('act')
                ? this._allow('Shell action allowed at act+', 'medium')
                : this._block('Shell actions require autonomy level act or higher', 'medium');
        }

        if (EXTERNAL_SEND_TOOLS.has(tool) && EXTERNAL_SEND_ACTIONS.has(action)) {
            if (this.externalSend || params?.__approvedExternal === true || source === 'ui') {
                return this._allow('External send explicitly enabled or user-directed', 'high');
            }
            return this._block('External sends require MAX_EXTERNAL_SEND=true, __approvedExternal, or direct UI action', 'high');
        }

        if (tool === 'self_evolution' || tool === 'evolution' || tool === 'self_improve') {
            const mutating = !['status', 'list', 'propose', 'deny'].includes(action);
            if (mutating && rank < levelRank('self_edit')) {
                return this._block('Self-modification requires autonomy level self_edit', 'high');
            }
        }

        if (tool === 'hydra' && ['commit', 'optimize'].includes(action) && rank < levelRank('self_edit')) {
            return this._block('Hydra commit/optimization requires autonomy level self_edit', 'high');
        }

        if (tool === 'file' && FILE_WRITE_ACTIONS.has(action)) {
            if (rank < levelRank('act')) {
                return this._block('File writes require autonomy level act or higher', 'medium');
            }

            const rel = normalizeRel(params?.filePath || params?.path);
            const coreEdit = /^(core|tools|memory|server|swarm|personas|onboarding)\//.test(rel)
                || ['launcher.mjs', 'package.json'].includes(rel);
            if (coreEdit) {
                return this._allow('Core file edit allowed; SecurityCouncil/AEGIS still apply', 'high', true);
            }
            return this._allow('Project file edit allowed at act+', 'medium');
        }

        if (rank < levelRank('act') && !READ_ACTIONS.has(action)) {
            return this._block(`Action ${tool}.${action} requires autonomy level act or higher`, 'medium');
        }

        return this._allow('Action allowed by default act policy', 'low');
    }

    _allow(reason, risk = 'low', warning = false) {
        return { allowed: true, reason, risk, warning };
    }

    _block(reason, risk = 'medium') {
        return { allowed: false, reason, risk };
    }

    getStatus() {
        return {
            level: this.level,
            externalSend: this.externalSend,
            ...this.stats
        };
    }
}
