#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// MAX launcher
// Usage: node launcher.mjs [--mode chat|swarm|api] [--persona architect]
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'fs';
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
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
    }
    console.log(`  💡 [${insight.source}] ${label}  — /expand ${id}`);
    if (_rl) {
        process.stdout.write('YOU: ');
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
            console.log('\n[MAX] Shutting down.');
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
    
    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is live. Dashboard: http://localhost:3100/dashboard');
    console.log('  Commands: /status, /persona <p>, /reason <q>, /swarm, /debate, /expand, /quit');
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
