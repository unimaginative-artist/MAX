#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// MAX launcher
// Usage: node launcher.mjs [--mode chat|swarm|api] [--persona architect]
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath }            from 'url';
import { dirname, join }            from 'path';
import readline                     from 'readline';
import { MAX }                      from './core/MAX.js';
import { isFirstRun, runOnboarding } from './onboarding/FirstRun.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ─── Insight store + printer ──────────────────────────────────────────────
const BOX_WIDTH = 60;
const INNER     = BOX_WIDTH - 4;
const _insights = [];
let   _insightId = 0;
let   _rl        = null;
let   _origLog   = console.log.bind(console);   // module-level so printBgGroup/expandInsight can use it

function stripMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g,     '$1')
        .replace(/`(.+?)`/g,       '$1')
        .replace(/^#{1,6}\s+/gm,   '')
        .replace(/^\s*[-*]\s+/gm,  '• ')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .trim();
}

function boxLine(text) {
    const words = text.split(' ').filter(Boolean);
    const lines = [];
    let cur = '';
    for (const word of words) {
        if (cur.length + word.length + 1 > INNER) {
            if (cur) lines.push(`║  ${cur}`);
            cur = word;
        } else {
            cur = cur ? `${cur} ${word}` : word;
        }
    }
    if (cur) lines.push(`║  ${cur}`);
    return lines;
}

function printFullInsight(insight, id) {
    const border = '═'.repeat(BOX_WIDTH);
    const div    = '─'.repeat(BOX_WIDTH);
    process.stdout.write('\n');
    console.log(`╔${border}╗`);
    console.log(`║  💡 MAX [${insight.source}]${id != null ? `  #${id}` : ''}`);
    console.log(`║  ${insight.label}`);
    console.log(`╟${div}╢`);

    const cleaned    = stripMarkdown(insight.result || '');
    const paragraphs = cleaned.split(/\n+/).map(p => p.trim()).filter(Boolean);
    for (const para of paragraphs) {
        if (para !== paragraphs[0]) console.log('║');
        for (const line of boxLine(para)) console.log(line);
    }
    console.log(`╚${border}╝`);
}

function printInsight(insight) {
    _insightId++;
    const id    = _insightId;
    _insights.push({ id, type: 'insight', insight });
    if (_insights.length > 30) _insights.shift();

    const label = insight.label.replace(/\n.*/s, '').slice(0, 50);
    console.log(`  💡 [${insight.source}] ${label}  — /expand ${id}`);
}

// ─── Collapsible background group ─────────────────────────────────────────
// Called by flushBgQueue when 3+ consecutive same-source messages are queued.
// Prints a single collapsed line; /expand N shows all lines.
function printBgGroup(source, lines) {
    _insightId++;
    const id = _insightId;
    _insights.push({ id, type: 'bg_group', source, lines });
    if (_insights.length > 30) _insights.shift();
    _origLog(`  ⊕ [${source}] ${lines.length} events  — /expand ${id}`);
}

function expandInsight(arg) {
    let entry;
    if (!arg || arg === 'last') {
        entry = _insights[_insights.length - 1];
    } else {
        const id = parseInt(arg);
        entry = _insights.find(e => e.id === id);
    }
    if (!entry) {
        console.log(`[MAX] No entry #${arg || 'last'} found.\n`);
        return;
    }
    if (entry.type === 'bg_group') {
        const border = '─'.repeat(BOX_WIDTH);
        _origLog(`\n  ┌${border}`);
        _origLog(`  │  [${entry.source}] ${entry.lines.length} events  #${entry.id}`);
        _origLog(`  ├${border}`);
        for (const line of entry.lines) {
            _origLog(`  │  ${line}`);
        }
        _origLog(`  └${border}\n`);
    } else {
        printFullInsight(entry.insight, entry.id);
    }
}

// ─── Thinking spinner ─────────────────────────────────────────────────────
const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
let _spinnerTimer = null;
let _spinnerPaused = false;

function startSpinner(label = 'thinking') {
    let i = 0;
    _spinnerPaused = false;
    _spinnerTimer = setInterval(() => {
        if (!_spinnerPaused) {
            process.stdout.write(`\r  ${SPINNER[i++ % SPINNER.length]}  MAX is ${label}...`);
        }
    }, 80);
    return function stop() {
        clearInterval(_spinnerTimer);
        _spinnerTimer = null;
        _spinnerPaused = false;
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
    };
}

function pauseSpinner() {
    if (_spinnerTimer && !_spinnerPaused) {
        _spinnerPaused = true;
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
    }
}

function resumeSpinner() {
    _spinnerPaused = false;
}

// ─── Acknowledge a queued message while MAX is mid-response ──────────────
// Fires non-blocking. Uses fast tier so it doesn't compete with the main call.
// MAX reads the queued message and prints a short "I see it, hold on" reply.
async function acknowledgeQueued(max, queuedMsg) {
    try {
        const result = await max.brain.think(
            `You are MAX. While you were mid-response, the user just sent:\n"${queuedMsg.slice(0, 200)}"\n\nWrite ONE short sentence (10 words max) acknowledging you saw it and will address it next. Direct, Max Headroom style. No quotes around your reply.`,
            { temperature: 0.6, maxTokens: 40, tier: 'fast' }
        );
        const ack = result.text
            .replace(/^(MAX:\s*|["'])/i, '')
            .replace(/["']$/, '')
            .split('\n')[0]
            .trim();
        if (!ack) return;

        if (_rl) {
            process.stdout.write(`\nMAX: ${ack}\n\n`);
        }
    } catch { /* best-effort — never block the main response */ }
}

// ─── Clean LLM reply — strip persona announcements and MAX: prefixes ─────
// DeepSeek sometimes echoes the persona name ("😎 Companion mode.") or the
// agent name ("MAX: ") at the start of its response. Strip both.
function cleanReply(text) {
    return text
        // Strip repeated "MAX:" / "M.A.X:" prefixes
        .replace(/^(?:(?:MAX|M\.A\.X)[:.]\s*)*/i, '')
        // Strip persona mode announcements on their own line, with or without emoji
        // e.g. "😎 Companion mode.\n\n" / "Grinder mode activated.\n"
        .replace(/^[^\w\n]{0,4}(?:Companion|Grinder|Architect|Paranoid|Breaker|Explainer|Devil(?:'s Advocate)?)\s+mode[^.\n]*[.\n]+\n*/i, '')
        .trimStart();
}

// ─── Background noise filter — patterns suppressed from terminal output ──
// These are high-frequency internal events that flood the terminal without
// adding actionable information during a chat session.
const BG_SUPPRESS = [
    /^\[KnowledgeBase\].*Ingested "/,          // per-file ingestion spam (50+ lines on boot)
    /^\[KnowledgeBase\].*Ingested "agent_loop/, // artifact ingestion
    /^\[GoalEngine\] ⚠️.*Duplicate goal/,       // duplicate goal warnings
    /^\[CodeIndexer\] 📁 Found \d+ source/,     // "indexing in progress" mid-line
    /^\[Diagnostics\] 🔍 Running system-wide/,  // fires twice on boot
];

// ─── Chat mode ───────────────────────────────────────────────────────────
async function chatMode(max, opts) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    _rl = rl;

    // ── Background message queue ───────────────────────────────────────────
    // Readline owns the terminal. Any console.log that fires while the user
    // is typing (or while readline is active at all) tears the input line.
    // Fix: buffer ALL background output while readline is active. Flush the
    // queue cleanly just before the YOU: prompt is shown each turn.
    _origLog = console.log.bind(console);   // update module-level ref before overriding console.log
    const _origError = console.error.bind(console);
    const _bgQueue   = [];

    console.log   = (...args) => {
        const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
        if (BG_SUPPRESS.some(p => p.test(msg))) return;  // drop high-frequency noise
        if (_rl) { _bgQueue.push(args); } else { _origLog(...args); }
    };
    console.error = (...args) => { if (_rl) { _bgQueue.push(args); } else { _origError(...args); } };

    function flushBgQueue() {
        if (_bgQueue.length === 0) return;

        // Extract the [ModuleName] prefix from a log message for grouping
        const getSource = (args) => {
            const msg = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
            const m = msg.match(/^\[([^\]]+)\]/);
            return { source: m ? m[1] : '', msg };
        };

        // Group consecutive messages with the same source prefix
        const groups = [];
        for (const args of _bgQueue) {
            const { source, msg } = getSource(args);
            const last = groups[groups.length - 1];
            if (last && last.source === source) {
                last.items.push({ args, msg });
            } else {
                groups.push({ source, items: [{ args, msg }] });
            }
        }
        _bgQueue.length = 0;

        for (const group of groups) {
            if (group.items.length >= 3) {
                // Collapse into a single expandable line
                printBgGroup(group.source, group.items.map(i => i.msg));
            } else {
                // Small group — show normally
                for (const { args } of group.items) _origLog(...args);
            }
        }
    }

    let inputBuffer   = '';
    let bufferTimer   = null;
    let isThinking    = false;
    let pendingInput  = null;   // message typed while thinking — processed after response
    let swarmNext     = false;
    let debateNext    = false;
    let activePersona = opts.persona || null;

    const ask = () => {
        if (!isThinking) {
            flushBgQueue();
            process.stdout.write('YOU: ');
        }
    };

    const processInput = async (input) => {
        const line = input.trim();
        if (!line) { ask(); return; }

        // If already thinking, queue the message and acknowledge it immediately
        if (isThinking) {
            const isFirstQueue = !pendingInput;
            pendingInput = pendingInput ? pendingInput + '\n' + line : line;

            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`  [queued] "${line.slice(0, 60)}${line.length > 60 ? '...' : ''}"`);

            // First queued message: fire a fast acknowledgment — non-blocking
            // MAX reads the message and prints a short "I see it" before finishing
            if (isFirstQueue && max.brain?._ready) {
                acknowledgeQueued(max, line).catch(() => {});
            }

            resumeSpinner();
            return;
        }

        isThinking = true;

        if (line === '/quit' || line === '/exit') {
            // Save session state so MAX can brief himself next boot
            try {
                const sessionState = {
                    timestamp:    new Date().toISOString(),
                    goals:        max.goals?.listActive().slice(0, 8).map(g => ({ title: g.title, status: g.status })),
                    insights:     _insights.slice(-5).map(i => ({ label: i.insight.label, result: i.insight.result?.slice(0, 300) })),
                    outcomes:     max.outcomes?.getStats(),
                    conversation: (max._context || []).slice(-8).map(m => ({
                        role:    m.role,
                        content: m.content.slice(0, 600)   // cap each turn so file stays small
                    }))
                };
                writeFileSync(join(__dirname, '.max', 'session.json'), JSON.stringify(sessionState, null, 2));
                console.log('[MAX] 📋 Session saved.');
            } catch { /* non-fatal */ }
            console.log('[MAX] Shutting down.');
            max.scheduler?.stop();
            max.heartbeat?.stop();
            await max.memory?.shutdown?.();
            await max.outcomes?.shutdown?.();
            process.exit(0);
        }

        if (line === '/status') {
            const s = max.getStatus();
            const d = s.drive;
            const brain = s.brain;
            const fastInfo  = brain.fast?.ready  ? `${brain.fast.backend}/${brain.fast.model}`   : 'none';
            const smartInfo = brain.smart?.ready ? `${brain.smart.backend}/${brain.smart.model}` : 'none';
            console.log(`\n[MAX] Tension: ${(d.tension*100).toFixed(0)}% | Satisfaction: ${(d.satisfaction*100).toFixed(0)}%`);
            console.log(`[MAX] Brain — fast: ${fastInfo} | smart: ${smartInfo}`);
            console.log(`[MAX] Persona: ${s.persona.name} | Memory: ${s.memory.totalMemories} facts`);
            console.log(`[MAX] Dashboard: http://localhost:${process.env.MAX_PORT || 3100}/dashboard\n`);
            isThinking = false;
            ask(); return;
        }

        if (line.startsWith('/reason ')) {
            const q = line.slice(8).trim();
            if (!q) { ask(); return; }
            try {
                const stop = startSpinner('reasoning');
                const res = await max.reason(q);
                stop();
                console.log('\n' + '═'.repeat(60));
                console.log(`STRATEGY: ${res.strategy.toUpperCase()}`);
                console.log(`CONFIDENCE: ${(res.confidence * 100).toFixed(0)}%`);
                console.log('─'.repeat(60));
                console.log(res.result);
                console.log('═'.repeat(60) + '\n');
            } catch (err) { console.error('[MAX] Reasoning error:', err.message); }
            isThinking = false;
            ask(); return;
        }

        if (line.startsWith('/expand')) {
            expandInsight(line.slice(7).trim() || 'last');
            isThinking = false;
            ask(); return;
        }

        // ── SOMA self-modification proposal commands ────────────────────────
        if (line === '/proposals') {
            const proposals = max._server?._somaProposals
                ? [...new Set(max._server._somaProposals.values())]
                : [];
            if (proposals.length === 0) {
                console.log('[MAX] No pending SOMA modification proposals.\n');
            } else {
                console.log(`\n[MAX] ${proposals.length} pending proposal(s):\n`);
                for (const p of proposals) {
                    const score = p.overallScore ? ` (${(p.overallScore * 100).toFixed(0)}%)` : '';
                    console.log(`  ${p.taskId.slice(0, 8)}  ${p.file}  [${(p.riskLevel || 'unknown').toUpperCase()}]${score}`);
                    console.log(`           ${p.rationale?.slice(0, 80) || ''}`);
                }
                console.log('\n  → /approve <id>   or   /deny <id>\n');
            }
            isThinking = false; ask(); return;
        }

        if (line.startsWith('/approve ')) {
            const id = line.slice(9).trim();
            try {
                const res = await fetch(`http://localhost:${process.env.MAX_PORT || 3100}/api/soma/proposals/${id}/approve`, { method: 'POST' });
                const data = await res.json();
                if (data.accepted) {
                    console.log(`[MAX] ✅ Approved proposal ${id} — apply pipeline running in background...\n`);
                } else {
                    console.log(`[MAX] ❌ ${data.error || 'Failed to approve'}\n`);
                }
            } catch (err) {
                console.log(`[MAX] Error: ${err.message}\n`);
            }
            isThinking = false; ask(); return;
        }

        if (line.startsWith('/deny ')) {
            const id = line.slice(6).trim();
            try {
                const res = await fetch(`http://localhost:${process.env.MAX_PORT || 3100}/api/soma/proposals/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.denied) {
                    console.log(`[MAX] 🚫 Denied proposal ${id}.\n`);
                } else {
                    console.log(`[MAX] ❌ ${data.error || 'Not found'}\n`);
                }
            } catch (err) {
                console.log(`[MAX] Error: ${err.message}\n`);
            }
            isThinking = false; ask(); return;
        }

        if (line === '/pause') {
            const ok = max.agentLoop?.interrupt();
            console.log(ok ? '[MAX] ⏸️  Pause requested — will stop at next step boundary.\n' : '[MAX] No active task to pause.\n');
            isThinking = false; ask(); return;
        }

        if (line === '/resume') {
            console.log('[MAX] ▶️  Resuming...\n');
            max.agentLoop?.runCycle().catch(e => console.error('[MAX] Resume error:', e.message));
            isThinking = false; ask(); return;
        }

        // ── /run <command> — direct shell, no LLM ─────────────────────────
        if (line.startsWith('/run ')) {
            const cmd = line.slice(5).trim();
            if (!cmd) { isThinking = false; ask(); return; }
            try {
                await max.tools.execute('shell', 'run', { command: cmd });
            } catch (err) { console.log(`[MAX] Shell error: ${err.message}\n`); }
            isThinking = false; ask(); return;
        }

        // ── /ps — list background processes ───────────────────────────────
        if (line === '/ps') {
            try {
                const res = await max.tools.execute('shell', 'ps', {});
                if (res.count === 0) {
                    console.log('[MAX] No background processes running.\n');
                } else {
                    console.log(`\n[MAX] ${res.count} background process(es):\n`);
                    for (const p of res.processes) {
                        console.log(`  [${p.name}]  pid ${p.pid}  ${p.command}`);
                        if (p.lastLog) console.log(`         last: ${p.lastLog}`);
                    }
                    console.log();
                }
            } catch (err) { console.log(`[MAX] Error: ${err.message}\n`); }
            isThinking = false; ask(); return;
        }

        // ── /kill <name> — stop a named background process ────────────────
        if (line.startsWith('/kill ')) {
            const name = line.slice(6).trim();
            if (!name) { isThinking = false; ask(); return; }
            try {
                const res = await max.tools.execute('shell', 'stop', { name });
                if (res.success) console.log(`[MAX] Stopped process "${name}" (pid ${res.pid})\n`);
                else console.log(`[MAX] ${res.error}\n`);
            } catch (err) { console.log(`[MAX] Error: ${err.message}\n`); }
            isThinking = false; ask(); return;
        }

        // ── /goals — manage goal queue ────────────────────────────────────
        if (line === '/goals' || line.startsWith('/goals ')) {
            const sub = line.slice(6).trim();
            const goals = max.goals;
            if (!goals) { console.log('[MAX] Goal engine not available.\n'); isThinking = false; ask(); return; }

            if (!sub || sub === 'list') {
                const active = goals.listActive();
                if (active.length === 0) {
                    console.log('[MAX] No active goals.\n');
                } else {
                    console.log(`\n[MAX] ${active.length} goal(s):\n`);
                    for (const g of active) {
                        const blocked = g.blockedBy?.length ? ` [blocked: ${g.blockedBy.join(', ')}]` : '';
                        console.log(`  [${g.id.slice(0, 8)}] [${g.status.padEnd(10)}] p${(g.priority || 0).toFixed(1)}  ${g.title}${blocked}`);
                    }
                    console.log();
                }
            } else if (sub.startsWith('add ')) {
                const title = sub.slice(4).trim().replace(/^["']|["']$/g, '');
                if (!title) { console.log('[MAX] Usage: /goals add "goal title"\n'); }
                else {
                    const id = goals.addGoal({ title, priority: 0.6, source: 'user' });
                    console.log(`[MAX] ✅ Goal added: [${id.slice(0, 8)}] "${title}"\n`);
                }
            } else if (sub === 'clear') {
                const active = goals.listActive();
                let cleared = 0;
                for (const g of active) {
                    if (g.status === 'pending' || g.status === 'ready') {
                        goals._active.delete(g.id);
                        cleared++;
                    }
                }
                console.log(`[MAX] Cleared ${cleared} pending goal(s).\n`);
            } else if (sub.startsWith('done ')) {
                const id = sub.slice(5).trim();
                const goal = [...(goals._active?.values() || [])].find(g => g.id.startsWith(id));
                if (!goal) { console.log(`[MAX] Goal "${id}" not found.\n`); }
                else { goals.markComplete(goal.id); console.log(`[MAX] Marked complete: "${goal.title}"\n`); }
            } else {
                console.log('[MAX] Usage: /goals [list|add "title"|done <id>|clear]\n');
            }
            isThinking = false; ask(); return;
        }

        // ── /research — trigger frontier research cycle now ──────────────
        if (line === '/research') {
            if (!max.frontier) { console.log('[MAX] Frontier research not available.\n'); isThinking = false; ask(); return; }
            console.log('[MAX] 🔬 Starting research cycle — this takes a few minutes...\n');
            try {
                const stop = startSpinner('researching');
                const result = await max.frontier.runCycle();
                stop();
                if (result) {
                    console.log(`\n[MAX] Research cycle done.`);
                    console.log(`  Papers processed: ${result.papers}`);
                    console.log(`  Engineering tasks generated: ${result.tasks}`);
                    console.log(`  Results in: research.md, frontier_map.md, todo.md, system_report.md\n`);
                } else {
                    console.log('[MAX] Research cycle returned no results.\n');
                }
            } catch (err) { console.log(`[MAX] Research error: ${err.message}\n`); }
            isThinking = false; ask(); return;
        }

        // ── /frontier — show current capability map ───────────────────────
        if (line === '/frontier') {
            const { readFileSync, existsSync } = await import('fs');
            const mapPath = new URL('../frontier_map.md', import.meta.url).pathname.slice(1);
            if (!existsSync(mapPath)) { console.log('[MAX] frontier_map.md not found — run /research first.\n'); isThinking = false; ask(); return; }
            console.log('\n' + readFileSync(mapPath, 'utf8').slice(0, 3000) + '\n');
            isThinking = false; ask(); return;
        }

        // ── /sysreport — show latest system report ────────────────────────
        if (line === '/sysreport') {
            const { readFileSync, existsSync } = await import('fs');
            const rptPath = new URL('../system_report.md', import.meta.url).pathname.slice(1);
            if (!existsSync(rptPath)) { console.log('[MAX] system_report.md not found — run /research first.\n'); isThinking = false; ask(); return; }
            console.log('\n' + readFileSync(rptPath, 'utf8') + '\n');
            isThinking = false; ask(); return;
        }

        // ── /reflect — trigger deep reflection immediately ────────────────
        if (line === '/reflect') {
            if (!max.reflection) { console.log('[MAX] Reflection engine not available.\n'); isThinking = false; ask(); return; }
            try {
                const stop = startSpinner('reflecting');
                const summary = await max.reflection.forceReflect();
                stop();
                console.log('\n[MAX] Deep reflection complete.');
                if (summary?.promptPatch) console.log(`  Prompt patch: "${summary.promptPatch.slice(0, 120)}"`);
                if (summary?.recentScore != null) console.log(`  Recent score: ${(summary.recentScore * 100).toFixed(0)}%`);
                console.log();
            } catch (err) { console.log(`[MAX] Reflect error: ${err.message}\n`); }
            isThinking = false; ask(); return;
        }

        if (line === '/artifacts' || line.startsWith('/artifacts ')) {
            const sub = line.slice('/artifacts'.length).trim();
            const arts = max.artifacts;
            if (!sub || sub === 'list') {
                const list = arts.list();
                if (list.length === 0) {
                    console.log('[MAX] No artifacts stored.\n');
                } else {
                    console.log(`\n[MAX] ${list.length} artifact(s):\n`);
                    for (const a of list) {
                        console.log(`  ${a.id}  "${a.name}"  (${a.type}, ${a.lineCount} lines, ${(a.byteSize/1024).toFixed(1)}KB)  ${a.timestamp}`);
                    }
                    console.log();
                }
            } else if (sub.startsWith('open ')) {
                const id = sub.slice(5).trim();
                const r  = await arts.open(id);
                console.log(r.success ? `[MAX] ${r.message}\n` : `[MAX] Error: ${r.error}\n`);
            } else if (sub.startsWith('delete ')) {
                const id = sub.slice(7).trim();
                const r  = arts.delete(id);
                console.log(r.success ? `[MAX] ${r.message}\n` : `[MAX] Error: ${r.error}\n`);
            } else if (sub.startsWith('get ')) {
                const id  = sub.slice(4).trim();
                const art = arts.get(id);
                if (!art) { console.log(`[MAX] Artifact ${id} not found.\n`); }
                else {
                    console.log(`\n[MAX] Artifact: "${art.name}" (${art.type})\n${'─'.repeat(60)}`);
                    console.log(art.content.slice(0, 3000));
                    if (art.content.length > 3000) console.log(`\n... (${art.lineCount} lines total)`);
                    console.log();
                }
            } else {
                console.log('[MAX] Usage: /artifacts [list|get <id>|open <id>|delete <id>]\n');
            }
            isThinking = false;
            ask(); return;
        }

        // ── /self — self-editing loop ──────────────────────────────────
        if (line.startsWith('/self')) {
            const sub = line.slice(5).trim();
            const se  = max.selfEditor;

            // /self read <path>
            if (sub.startsWith('read ')) {
                const relPath = sub.slice(5).trim();
                try {
                    const { code, lines } = await se.readSource(relPath);
                    console.log(`\n[MAX] ${relPath}  (${lines} lines)\n${'─'.repeat(60)}`);
                    console.log(code.slice(0, 4000));
                    if (code.length > 4000) console.log(`\n... (truncated — ${lines} lines total)`);
                    console.log();
                } catch (err) { console.log(`[MAX] ${err.message}\n`); }

            // /self edit <path> <instruction>
            } else if (sub.startsWith('edit ')) {
                const rest        = sub.slice(5).trim();
                const spaceIdx    = rest.indexOf(' ');
                if (spaceIdx === -1) {
                    console.log('[MAX] Usage: /self edit <path> <instruction>\n');
                } else {
                    const relPath     = rest.slice(0, spaceIdx).trim();
                    const instruction = rest.slice(spaceIdx + 1).trim();
                    try {
                        const stop = startSpinner('editing');
                        console.log(`\n[MAX] Proposing edit to ${relPath}...`);
                        const newCode  = await se.proposeEdit(relPath, instruction, max.brain);
                        const stagePath = await se.stage(relPath, newCode);
                        stop();

                        console.log(`[MAX] Staged → ${stagePath}`);
                        process.stdout.write('[MAX] Validating (syntax + import)...');
                        const validation = await se.validate(relPath);
                        process.stdout.write('\r' + ' '.repeat(50) + '\r');

                        if (!validation.ok) {
                            console.log(`[MAX] ❌ Validation failed (${validation.stage}): ${validation.error}\n`);
                            console.log(`[MAX] Staged version kept — fix with /self edit or /self rollback ${relPath}\n`);
                        } else {
                            const diffResult = await se.diff(relPath);
                            console.log(`[MAX] ✅ Valid — ${diffResult?.changes ?? 0} line(s) changed`);
                            try {
                                const opened = await se.openDiff(relPath);
                                console.log(`[MAX] 🪟 Diff open in ${opened.method === 'vscode' ? 'VS Code' : 'system editor'}`);
                            } catch { /* editor not available */ }
                            console.log(`[MAX] Review the changes, then:\n  /self commit ${relPath}   — apply\n  /self rollback ${relPath} — discard\n`);
                        }
                    } catch (err) { console.log(`[MAX] Edit failed: ${err.message}\n`); }
                }

            // /self diff <path>
            } else if (sub.startsWith('diff ')) {
                const relPath = sub.slice(5).trim();
                try {
                    const d = await se.diff(relPath);
                    if (!d) { console.log(`[MAX] No staged version of ${relPath}\n`); }
                    else {
                        console.log(`\n[MAX] Diff for ${relPath}  (+${d.addedLines} lines, ${d.changes} change(s)):`);
                        console.log('─'.repeat(60));
                        console.log(d.diff.slice(0, 3000));
                        console.log();
                    }
                } catch (err) { console.log(`[MAX] ${err.message}\n`); }

            // /self test <path>
            } else if (sub.startsWith('test ')) {
                const relPath = sub.slice(5).trim();
                try {
                    process.stdout.write(`[MAX] Testing ${relPath}...`);
                    const result = await se.validate(relPath);
                    process.stdout.write('\r' + ' '.repeat(60) + '\r');
                    if (result.ok) {
                        console.log(`[MAX] ✅ ${relPath} passes syntax + import validation\n`);
                    } else {
                        console.log(`[MAX] ❌ ${result.stage} error: ${result.error}\n`);
                    }
                } catch (err) { console.log(`[MAX] ${err.message}\n`); }

            // /self commit <path>
            } else if (sub.startsWith('commit ')) {
                const relPath = sub.slice(7).trim();
                try {
                    const { committed, backup } = await se.commit(relPath);
                    console.log(`[MAX] ✅ Committed: ${committed}`);
                    console.log(`[MAX] 📦 Backup saved: ${backup}\n`);
                } catch (err) { console.log(`[MAX] Commit failed: ${err.message}\n`); }

            // /self rollback <path>
            } else if (sub.startsWith('rollback ')) {
                const relPath = sub.slice(9).trim();
                try {
                    await se.rollback(relPath);
                    console.log(`[MAX] ↩️  Rolled back ${relPath} — staged changes discarded\n`);
                } catch (err) { console.log(`[MAX] ${err.message}\n`); }

            // /self list
            } else if (sub === 'list') {
                const staged  = se.listStaged();
                const backups = await se.listBackups();
                if (staged.length > 0) {
                    console.log(`\n[MAX] Staged (awaiting commit):\n${staged.map(p => `  ${p}`).join('\n')}`);
                } else {
                    console.log('[MAX] No staged edits.');
                }
                if (backups.length > 0) {
                    console.log(`[MAX] Backups (${backups.length}):\n${backups.slice(0, 5).map(b => `  ${b}`).join('\n')}`);
                }
                console.log();

            } else {
                console.log('[MAX] /self commands:');
                console.log('  /self read <path>              — view source file');
                console.log('  /self edit <path> <instruction> — propose edit via brain');
                console.log('  /self diff <path>              — show staged changes');
                console.log('  /self test <path>              — validate staged version');
                console.log('  /self commit <path>            — apply changes (backs up original)');
                console.log('  /self rollback <path>          — discard staged changes');
                console.log('  /self list                     — staged files + backups\n');
            }

            isThinking = false;
            ask(); return;
        }

        if (line === '/swarm') {
            swarmNext = true;
            console.log('[MAX] Next message → swarm.\n');
            isThinking = false;
            ask(); return;
        }
        if (line === '/debate') { 
            debateNext = true; 
            console.log('[MAX] Next message → debate.\n'); 
            isThinking = false;
            ask(); return; 
        }

        if (line.startsWith('/persona')) {
            const p = line.split(' ')[1];
            if (p) {
                try { 
                    max.persona.switchTo(p); 
                    activePersona = p; 
                    console.log(`[MAX] Persona → ${p}\n`); 
                } 
                catch (err) { console.log(`[MAX] ${err.message}\n`); }
            } else { 
                console.log('[MAX] Options: architect/grinder/paranoid/breaker/explainer/devil\n'); 
            }
            isThinking = false;
            ask(); return;
        }

        // ── Swarm ──
        if (swarmNext) {
            swarmNext = false;
            try {
                const stop = startSpinner('swarming');
                const res = await max.swarmThink(line);
                stop();
                console.log('\n' + '═'.repeat(60) + '\nMAX (Swarm synthesis):\n' + (res.synthesis || 'No synthesis.') + '\n' + '═'.repeat(60) + '\n');
            } catch (err) { console.error('[MAX] Swarm error:', err.message); }
            isThinking = false;
            ask(); return;
        }

        // ── Chat ──
        try {
            // Streaming: stop spinner on first token, print tokens live.
            // If the response had tool calls (wasStreamed=false), print the final clean reply normally.
            const stop = startSpinner('thinking');
            let streamStarted = false;

            const res = await max.think(line, {
                persona: activePersona,
                onToken: (token) => {
                    if (!streamStarted) {
                        stop();
                        process.stdout.write('\nMAX: ');
                        streamStarted = true;
                    }
                    process.stdout.write(token);
                }
            });

            if (streamStarted) {
                process.stdout.write('\n');
                if (!res.wasStreamed) {
                    const reply = cleanReply(res.response || '');
                    console.log('\nMAX: ' + reply);
                }
            } else {
                stop();
                const reply = cleanReply(res.response || '');
                console.log('\nMAX: ' + reply);
            }

            console.log(`\n[${res.persona} | tension ${(res.drive.tension * 100).toFixed(0)}%]\n`);
        } catch (err) { console.error('[MAX] Error:', err.message); }
        
        isThinking = false;

        // Drain the queue — if user typed while we were thinking, process it now
        if (pendingInput) {
            const queued = pendingInput;
            pendingInput = null;
            process.stdout.write('\r' + ' '.repeat(40) + '\r');
            console.log(`[MAX] Processing queued message: "${queued.slice(0, 60)}"\n`);
            processInput(queued);
        } else {
            ask();
        }
    };

    rl.on('line', (line) => {
        // Only pause the spinner on the FIRST line of each input burst.
        // Without this, every line of a multi-line paste calls clearLine + cursorTo,
        // which mangles the terminal output during large pastes.
        if (!bufferTimer) pauseSpinner();

        inputBuffer += (inputBuffer ? '\n' : '') + line;
        if (bufferTimer) clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => {
            bufferTimer = null;
            const full = inputBuffer;
            inputBuffer = '';
            // resumeSpinner is intentionally NOT called here — processInput handles
            // spinner state itself. Calling it here caused the spinner to flash
            // mid-paste, making it look like the message had already sent.
            processInput(full);
        }, 3000); // 3000ms — wide window for slow Windows paste / multi-paragraph text
    });

    max.heartbeat.on('insight', printInsight);
    
    // ── Proactive direct messages from background systems ──
    max.heartbeat.on('message', (msg) => {
        console.log(`\nMAX [background]: ${msg.text}`);
        if (msg.details) console.log(`[${msg.details}]`);
        console.log();
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is live. Dashboard: http://localhost:3100/dashboard');
    console.log('  Commands: /status, /persona <p>, /reason <q>, /run <cmd>, /ps, /kill <n>, /goals [list|add|clear], /reflect, /swarm, /debate, /expand, /artifacts, /pause, /resume, /quit');
    console.log('  Research: /research (run cycle now), /frontier (capability map), /sysreport (latest report)');
    console.log('  Self-edit: /self edit <path> <instruction>  →  /self test  →  /self commit | /self rollback');
    console.log('─'.repeat(60) + '\n');

    // Delay the ready message so boot logs print first, then MAX speaks last
    setTimeout(() => {
        const status  = max.brain?.getStatus?.();
        const backend = status?.smart?.backend || 'local';
        const model   = status?.smart?.model   || 'unknown';
        console.log(`\nMAX: Online. Running on ${backend} (${model}). What are we building?\n`);
        ask();
    }, 1500);
}

async function main() {
    loadEnv();
    const opts = parseArgs();
    console.log('[Launcher] 🚀 Booting MAX...');

    const max = new MAX({
        geminiKey:  process.env.GEMINI_API_KEY,
        memory:     { dbPath: join(__dirname, '.max', 'memory.db') },
        // 'write' = auto-approve reads + writes; only gate git push/commit + file delete
        // Set MAX_AUTO_APPROVE=all in api-keys.env for fully hands-off operation
        agentLoop:  { autoApproveLevel: process.env.MAX_AUTO_APPROVE || 'write' }
    });

    console.log('[Launcher] ⚙️  Initializing core systems...');
    await max.initialize();
    
    // Always start API server for Dashboard
    const { createServer } = await import('./server/server.js');
    await createServer(max, opts.port || process.env.MAX_PORT || 3100);

    if (opts.mode === 'chat') {
        await chatMode(max, opts);
    }
}

// Catch unhandled rejections from background tasks — log and continue rather than crash
process.on('unhandledRejection', (err) => {
    console.error('[MAX] ⚠️  Unhandled rejection (background task):', err?.message || err);
});
process.on('uncaughtException', (err) => {
    console.error('[MAX] ⚠️  Uncaught exception:', err?.message || err);
});

main().catch(err => { console.error('[MAX] Fatal:', err); process.exit(1); });
