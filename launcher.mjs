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
    _insights.push({ id, insight });
    if (_insights.length > 20) _insights.shift();

    const label = insight.label.replace(/\n.*/s, '').slice(0, 50);
    if (_rl) {
        const partial = _rl.line || '';
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  💡 [${insight.source}] ${label}  — /expand ${id}`);
        process.stdout.write('YOU: ' + partial);
    } else {
        console.log(`  💡 [${insight.source}] ${label}  — /expand ${id}`);
    }
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
        console.log(`[MAX] No insight #${arg || 'last'} found.\n`);
        return;
    }
    printFullInsight(entry.insight, entry.id);
}

// ─── Thinking spinner ─────────────────────────────────────────────────────
const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
function startSpinner(label = 'thinking') {
    let i = 0;
    const timer = setInterval(() => {
        process.stdout.write(`\r  ${SPINNER[i++ % SPINNER.length]}  MAX is ${label}...`);
    }, 80);
    return function stop() {
        clearInterval(timer);
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
    };
}

// ─── Chat mode ───────────────────────────────────────────────────────────
async function chatMode(max, opts) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    _rl = rl;

    let inputBuffer = '';
    let bufferTimer = null;
    let isThinking  = false;
    let swarmNext   = false;
    let debateNext  = false;
    let activePersona = opts.persona || null;

    const ask = () => { 
        if (!isThinking) process.stdout.write('YOU: '); 
    };

    const processInput = async (input) => {
        const line = input.trim();
        if (!line) { ask(); return; }

        isThinking = true;

        if (line === '/quit' || line === '/exit') {
            // Save session state so MAX can brief himself next boot
            try {
                const sessionState = {
                    timestamp: new Date().toISOString(),
                    goals:    max.goals?.listActive().slice(0, 8).map(g => ({ title: g.title, status: g.status })),
                    insights: _insights.slice(-5).map(i => ({ label: i.insight.label, result: i.insight.result?.slice(0, 300) })),
                    outcomes: max.outcomes?.getStats(),
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
            const stop = startSpinner('thinking');
            const res = await max.think(line, { persona: activePersona });
            stop();
            console.log('\nMAX: ' + res.response);
            console.log(`\n[${res.persona} | tension ${(res.drive.tension * 100).toFixed(0)}%]\n`);
        } catch (err) { console.error('[MAX] Error:', err.message); }
        
        isThinking = false;
        ask();
    };

    rl.on('line', (line) => {
        inputBuffer += (inputBuffer ? '\n' : '') + line;
        if (bufferTimer) clearTimeout(bufferTimer);
        bufferTimer = setTimeout(() => {
            const full = inputBuffer;
            inputBuffer = '';
            processInput(full);
        }, 300); // Increased to 300ms for safer Windows pastes
    });

    max.heartbeat.on('insight', printInsight);
    
    // ── Proactive direct messages from background systems ──
    max.heartbeat.on('message', (msg) => {
        if (_rl) {
            const partial = _rl.line || '';
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`\nMAX [background]: ${msg.text}`);
            if (msg.details) console.log(`[${msg.details}]`);
            console.log();
            process.stdout.write('YOU: ' + partial);
        } else {
            console.log(`\nMAX [background]: ${msg.text}`);
            if (msg.details) console.log(`[${msg.details}]`);
            console.log();
        }
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is live. Dashboard: http://localhost:3100/dashboard');
    console.log('  Commands: /status, /persona <p>, /reason <q>, /swarm, /debate, /expand, /artifacts, /pause, /resume, /quit');
    console.log('  Self-edit: /self edit <path> <instruction>  →  /self test  →  /self commit | /self rollback');
    console.log('─'.repeat(60) + '\n');

    ask();
}

async function main() {
    loadEnv();
    const opts = parseArgs();
    console.log('[Launcher] 🚀 Booting MAX...');

    const max = new MAX({
        geminiKey:     process.env.GEMINI_API_KEY,
        memory:        { dbPath: join(__dirname, '.max', 'memory.db') }
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

main().catch(err => { console.error('[MAX] Fatal:', err); process.exit(1); });
