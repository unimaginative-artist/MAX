#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// MAX launcher — OMEGA BRIDGE
// Production-grade Sovereign Intelligence TUI
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath }            from 'url';
import { dirname, join }            from 'path';
import { MAX }                      from './core/MAX.js';
import { isFirstRun, runOnboarding } from './onboarding/FirstRun.js';
import { TUI, COLORS }              from './core/ui/TUI.mjs';
import { InputBridge }              from './core/ui/InputBridge.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tui = new TUI();
let   _origLog = console.log.bind(console);

// ─── Insight store ────────────────────────────────────────────────────────
const _insights = [];
let   _insightId = 0;

function printInsight(insight) {
    _insightId++;
    const id = _insightId;
    _insights.push({ id, type: 'insight', insight });
    if (_insights.length > 30) _insights.shift();
    console.log(`  💡 [${insight.source}] ${insight.label.slice(0, 50)}  — /expand ${id}`);
}

function printBgGroup(source, lines) {
    _insightId++;
    const id = _insightId;
    _insights.push({ id, type: 'bg_group', source, lines });
    if (_insights.length > 30) _insights.shift();
    _origLog(`  ⊕ [${source}] ${lines.length} events  — /expand ${id}`);
}

function expandInsight(arg) {
    let entry = arg === 'last' ? _insights[_insights.length - 1] : _insights.find(e => e.id === parseInt(arg));
    if (!entry) return console.log(`[MAX] Entry #${arg} not found.`);

    if (entry.type === 'bg_group') {
        console.log(`\n  ┌─ [${entry.source}] ${entry.lines.length} events #${entry.id}`);
        for (const line of entry.lines) console.log(`  │  ${line}`);
        console.log(`  └─\n`);
    } else {
        tui.printBox(entry.insight.label, [entry.insight.result || ''], entry.insight.source);
    }
}

// ─── Load config/api-keys.env ────────────────────────────────────────────
function loadEnv() {
    const envPath = join(__dirname, 'config', 'api-keys.env');
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, 'utf8').replace(/\r/g, '').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...rest] = trimmed.split('=');
            const val = rest.join('=');
            if (key && val && !process.env[key]) process.env[key] = val;
        }
    }
}

// ─── Parse CLI args ───────────────────────────────────────────────────────
function parseArgs() {
    const args   = process.argv.slice(2);
    const result = { mode: 'chat', persona: null, task: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode'    && args[i+1]) result.mode    = args[++i];
        if (args[i] === '--persona' && args[i+1]) result.persona = args[++i];
        if (args[i] === '--task'    && args[i+1]) result.task    = args[++i];
        if (args[i] === '--port'    && args[i+1]) result.port    = parseInt(args[++i]);
    }
    return result;
}

const BG_SUPPRESS = [
    /^\[KnowledgeBase\].*Ingested "/,
    /^\[GoalEngine\] ⚠️.*Duplicate goal/,
    /^\[CodeIndexer\] 📁 Found \d+ source/,
];

async function chatMode(max, opts = {}) {
    const bridge = new InputBridge(max, tui);
    
    // ── Background output management ──────────────────────────────────────
    const _bgQueue = [];
    console.log = (...args) => {
        const msg = args.join(' ');
        if (BG_SUPPRESS.some(p => p.test(msg))) return;
        if (max.isThinking || bridge.rl) _bgQueue.push(args); else _origLog(...args);
    };

    function flushBgQueue() {
        if (_bgQueue.length === 0) return;
        const groups = new Map();
        for (const args of _bgQueue) {
            const msg = args.join(' ');
            const source = (msg.match(/^\[([^\]]+)\]/) || ['', 'SYSTEM'])[1];
            if (!groups.has(source)) groups.set(source, []);
            groups.get(source).push(msg);
        }
        _bgQueue.length = 0;
        for (const [source, lines] of groups) {
            if (lines.length >= 3) printBgGroup(source, lines);
            else for (const line of lines) _origLog(line);
        }
    }

    const processInput = async (line) => {
        const input = line.trim();
        if (!input) return bridge.prompt();

        max.isThinking = true;

        if (input.startsWith('/')) {
            const [cmd, ...args] = input.slice(1).split(' ');
            const argStr = args.join(' ');

            switch(cmd) {
                case 'quit': case 'exit':
                    console.log('[MAX] Shutting down.');
                    process.exit(0);
                    break;
                case 'add':
                    if (!argStr) return console.log('[MAX] Usage: /add <path>');
                    max.pinFile(argStr);
                    console.log(`[MAX] 📌 Pinned: ${argStr}`);
                    break;
                case 'drop':
                    if (!argStr) return console.log('[MAX] Usage: /drop <path>');
                    max.unpinFile(argStr);
                    console.log(`[MAX] 📍 Unpinned: ${argStr}`);
                    break;
                case 'clear':
                    max.clearPinned();
                    console.log('[MAX] 🧹 Context cleared.');
                    break;
                case 'status':
                    const s = max.getStatus();
                    console.log(`\n[MAX] Tension: ${(s.drive.tension*100).toFixed(0)}% | Satisfaction: ${(s.drive.satisfaction*100).toFixed(0)}%`);
                    console.log(`[MAX] Brain: ${s.brain.smart?.backend || 'local'} | Memory: ${s.memory.totalMemories} facts`);
                    console.log(`[MAX] Pinned Files: ${[...max.pinnedFiles].join(', ') || 'none'}`);
                    console.log(`[MAX] RepoGraph: ${max.graph.nodes.size} nodes | Impact logic active\n`);
                    break;
                case 'approve':
                    if (max.agentLoop?._pendingApproval) {
                        max.agentLoop.approve();
                        console.log('[MAX] ✅ Change approved.');
                    } else console.log('[MAX] No pending approval.');
                    break;
                case 'deny':
                    if (max.agentLoop?._pendingApproval) {
                        max.agentLoop.deny();
                        console.log('[MAX] ❌ Change denied.');
                    } else console.log('[MAX] No pending approval.');
                    break;
                case 'reason':
                    const rStop = tui.startSpinner('reasoning');
                    const res = await max.reason(argStr);
                    rStop();
                    console.log(`\nSTRATEGY: ${res.strategy.toUpperCase()}\n${res.result}\n`);
                    break;
                case 'expand':
                    expandInsight(argStr || 'last');
                    break;
                case 'goals':
                    const active = max.goals.listActive();
                    console.log(`\n[MAX] ${active.length} active goals:`);
                    for (const g of active) console.log(`  [${g.id.slice(0,8)}] ${g.title} (${g.status})`);
                    console.log();
                    break;
                case 'run':
                    try { await max.tools.execute('shell', 'run', { command: argStr }); } catch (e) { console.log(`Error: ${e.message}`); }
                    break;
                default:
                    console.log(`[MAX] Unknown command: /${cmd}`);
            }
            max.isThinking = false;
            flushBgQueue();
            return bridge.prompt();
        }

        try {
            const stop = tui.startSpinner('thinking');
            let streamStarted = false;

            const res = await max.think(input, {
                onToken: (token) => {
                    if (!streamStarted) { 
                        stop(); 
                        streamStarted = true; 
                        process.stdout.write(`\n${COLORS.BOLD}${COLORS.MINT}MAX:${COLORS.RESET} ${COLORS.BLUE}`); 
                    }
                    process.stdout.write(token);
                }
            });

            if (streamStarted) process.stdout.write(`${COLORS.RESET}\n`);
            else { stop(); tui.printMAX(tui.cleanReply(res.response)); }

            console.log(`\n[${res.persona} | tension ${(res.drive.tension * 100).toFixed(0)}%]\n`);
        } catch (err) {
            console.error('[MAX] Error:', err.message);
        }

        max.isThinking = false;
        tui.flushBuffer(); // Cleanly print any background messages that fired during thinking
        flushBgQueue();

        const pending = bridge.getPending();
        if (pending) processInput(pending); else bridge.prompt();
    };

    bridge.start(processInput);

    // ── Lifecycle Hooks ──
    max.heartbeat.on('insight', (insight) => {
        tui.setActiveTask(null); // Clear working status on insight (goal completion/fail)
        printInsight(insight);
    });

    max.heartbeat.on('message', (msg) => tui.printLive(`\n${COLORS.BOLD}${COLORS.MINT}MAX:${COLORS.RESET} ${msg.text}`, max.isThinking));
    
    max.agentLoop?.on('goalStart', ({ goal }) => {
        tui.setActiveTask(goal.title);
        // We only print the start line if it's a new goal (not redundant)
        tui.printLive(`\n  ⚙️  MAX started: "${goal.title}"`, max.isThinking);
    });

    max.agentLoop?.on('toolStart', ({ tool, action, params }) => {
        const details = params.query || params.command || params.filePath || '';
        tui.printLive(`  ${COLORS.DIM}[${tool.toUpperCase()}: "${details.slice(0, 40)}..."]${COLORS.RESET}`, max.isThinking);
    });

    max.agentLoop?.on('approvalNeeded', ({ tool, action, params, goal }) => {
        const isFile = tool === 'file' && ['write', 'replace', 'patch'].includes(action);
        
        console.log(`\n${COLORS.BOLD}╔══════════════════════════════════════════════════════════════════════╗${COLORS.RESET}`);
        console.log(`║  ${COLORS.GOLD}🚨 APPROVAL REQUIRED${COLORS.RESET}                                             ║`);
        console.log(`╟──────────────────────────────────────────────────────────────────────╢`);
        console.log(`║  Goal:   ${(goal?.title || 'background task').padEnd(60)} ║`);
        console.log(`║  Action: ${(tool + '.' + action).padEnd(60)} ║`);

        if (isFile) {
            console.log(`╟──────────────────────────────────────────────────────────────────────╢`);
            console.log(`║  ${COLORS.MINT}PROPOSED CHANGE:${COLORS.RESET}${' '.repeat(52)}║`);
            const target = params.filePath || params.path || 'unknown';
            console.log(`║  Target: ${target.padEnd(60)} ║`);
            console.log(`║${' '.repeat(70)}║`);

            let preview = '';
            if (action === 'write') preview = params.content;
            else if (action === 'replace') preview = `FIND:\n${params.oldText}\n\nREPLACE:\n${params.newText}`;
            else if (action === 'patch') preview = (params.hunks || []).map(h => `${h.position} ${h.anchor}:\n${h.content}`).join('\n---\n');

            const lines = preview.split('\n').slice(0, 15);
            for (const line of lines) {
                const clean = line.replace(/\r/g, '').slice(0, 64);
                console.log(`║  ${COLORS.DIM}${clean.padEnd(64)}${COLORS.RESET}  ║`);
            }
            if (preview.split('\n').length > 15) console.log(`║  ${COLORS.DIM}... (truncated)${' '.repeat(53)}${COLORS.RESET}  ║`);
        } else if (params) {
            const pStr = JSON.stringify(params).slice(0, 64);
            console.log(`║  Params: ${pStr.padEnd(60)} ║`);
        }

        console.log(`╟──────────────────────────────────────────────────────────────────────╢`);
        console.log(`║  → type ${COLORS.BOLD}/approve${COLORS.RESET} to allow  |  ${COLORS.BOLD}/deny${COLORS.RESET} to block${' '.repeat(30)}║`);
        console.log(`${COLORS.BOLD}╚══════════════════════════════════════════════════════════════════════╝${COLORS.RESET}\n`);
    });

    console.log('\n' + '─'.repeat(60));
    console.log('  MAX OMEGA BRIDGE ACTIVE. System responsive. Memory isolated.');
    console.log('─'.repeat(60) + '\n');

    setTimeout(() => {
        const s = max.brain.getStatus();
        console.log(`\nMAX: Online. Running on ${s.smart?.backend} (${s.smart?.model}). Ready for directives.\n`);
        bridge.prompt();
    }, 1000);
}

async function main() {
    loadEnv();
    const opts = parseArgs();
    console.log('[Launcher] 🚀 Booting MAX OMEGA...');

    const max = new MAX({
        geminiKey:  process.env.GEMINI_API_KEY,
        memory:     { dbPath: join(__dirname, '.max', 'memory.db') },
        agentLoop:  { autoApproveLevel: process.env.MAX_AUTO_APPROVE || 'write' }
    });

    console.log('[Launcher] ⚙️  Initializing core systems...');
    await max.initialize();
    
    const { createServer } = await import('./server/server.js');
    await createServer(max, opts.port || process.env.MAX_PORT || 3100);

    if (opts.mode === 'chat') {
        await chatMode(max, opts);
    }
}

process.on('unhandledRejection', (err) => {
    console.error('[MAX] ⚠️  Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('[MAX] ⚠️  Uncaught exception:', err?.message || err);
});

main().catch(err => { console.error('[MAX] Fatal:', err); process.exit(1); });
