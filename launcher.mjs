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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load config/api-keys.env ────────────────────────────────────────────
function loadEnv() {
    const envPath = join(__dirname, 'config', 'api-keys.env');
    if (!existsSync(envPath)) {
        console.log('[MAX] No config/api-keys.env found — using environment variables');
        return;
    }

    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...rest] = trimmed.split('=');
            const val = rest.join('=');
            if (key && val && !process.env[key]) {
                process.env[key] = val;
            }
        }
    }
}

// ─── Parse CLI args ───────────────────────────────────────────────────────
function parseArgs() {
    const args    = process.argv.slice(2);
    const result  = { mode: 'chat', persona: null, task: null };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode' && args[i+1])     result.mode    = args[++i];
        if (args[i] === '--persona' && args[i+1])  result.persona = args[++i];
        if (args[i] === '--task' && args[i+1])     result.task    = args[++i];
        if (args[i] === '--port' && args[i+1])     result.port    = parseInt(args[++i]);
    }

    return result;
}

// ─── Chat mode — interactive REPL ────────────────────────────────────────
async function chatMode(max, opts) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is ready. Type your message, or:');
    console.log('  /status   — show MAX status');
    console.log('  /swarm    — run swarm on next message');
    console.log('  /debate   — debate next message');
    console.log('  /persona  — switch persona (architect/grinder/paranoid/breaker/explainer/devil)');
    console.log('  /clear    — clear conversation context');
    console.log('  /quit     — exit');
    console.log('─'.repeat(60) + '\n');

    let swarmNext  = false;
    let debateNext = false;
    let activePersona = opts.persona || null;

    const ask = () => {
        rl.question('YOU: ', async (input) => {
            const line = input.trim();
            if (!line) { ask(); return; }

            // ── Commands ──
            if (line === '/quit' || line === '/exit') {
                console.log('\n[MAX] Shutting down. See you around.');
                max.heartbeat?.stop();
                process.exit(0);
            }

            if (line === '/status') {
                console.log('\n[MAX] Status:', JSON.stringify(max.getStatus(), null, 2));
                ask(); return;
            }

            if (line === '/clear') {
                max.clearContext();
                ask(); return;
            }

            if (line === '/swarm') {
                swarmNext = true;
                console.log('[MAX] Next message will run as swarm job.\n');
                ask(); return;
            }

            if (line === '/debate') {
                debateNext = true;
                console.log('[MAX] Next message will be debated.\n');
                ask(); return;
            }

            if (line.startsWith('/persona')) {
                const p = line.split(' ')[1];
                if (p) {
                    try {
                        max.persona.switchTo(p);
                        activePersona = p;
                        console.log(`[MAX] Switched to persona: ${p}\n`);
                    } catch (err) {
                        console.log(`[MAX] ${err.message}\n`);
                    }
                } else {
                    console.log('[MAX] Personas: architect, grinder, paranoid, breaker, explainer, devil\n');
                }
                ask(); return;
            }

            // ── Swarm mode ──
            if (swarmNext) {
                swarmNext = false;
                try {
                    console.log('\n[MAX] 🐝 Firing up the swarm...\n');
                    const result = await max.swarmThink(line);
                    console.log('\n' + '═'.repeat(60));
                    console.log('MAX (Swarm synthesis):');
                    console.log(result.synthesis || 'No synthesis produced.');
                    console.log('═'.repeat(60) + '\n');
                } catch (err) {
                    console.error('[MAX] Swarm error:', err.message);
                }
                ask(); return;
            }

            // ── Debate mode ──
            if (debateNext) {
                debateNext = false;
                try {
                    console.log('\n[MAX] ⚔️  Starting debate...\n');
                    const result = await max.debateDecision({ title: line, description: '', stakes: 'medium' });
                    console.log('\n' + '═'.repeat(60));
                    console.log(`Verdict: ${result.verdict?.recommendation} (confidence: ${((result.verdict?.confidence || 0) * 100).toFixed(0)}%)`);
                    console.log(`Reasoning: ${result.verdict?.reasoning}`);
                    if (result.verdict?.conditions) console.log(`Conditions: ${result.verdict.conditions}`);
                    console.log('═'.repeat(60) + '\n');
                } catch (err) {
                    console.error('[MAX] Debate error:', err.message);
                }
                ask(); return;
            }

            // ── Normal chat ──
            try {
                process.stdout.write('\nMAX: ');
                const result = await max.think(line, { persona: activePersona, includeTools: false });
                console.log(result.response);
                console.log(`\n[${result.persona} | tension ${(result.drive.tension * 100).toFixed(0)}%]\n`);
            } catch (err) {
                console.error('[MAX] Error:', err.message);
            }

            ask();
        });
    };

    ask();
}

// ─── Swarm mode — one-shot task ───────────────────────────────────────────
async function swarmMode(max, opts) {
    const task = opts.task || process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ');
    if (!task) {
        console.error('[MAX] --mode swarm requires --task "your task description"');
        process.exit(1);
    }

    console.log(`\n[MAX] Swarm task: "${task}"\n`);
    const result = await max.swarmThink(task);

    console.log('\n' + '═'.repeat(60));
    console.log('SYNTHESIS:');
    console.log(result.synthesis);
    console.log('═'.repeat(60));
    process.exit(0);
}

// ─── API mode — Express REST server ──────────────────────────────────────
async function apiMode(max, opts) {
    const { createServer } = await import('./server/server.js');
    const port = opts.port || process.env.MAX_PORT || 3100;
    await createServer(max, port);
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
    loadEnv();
    const opts = parseArgs();

    const max = new MAX({
        ollamaModel: process.env.OLLAMA_MODEL,
        geminiKey:   process.env.GEMINI_API_KEY,
        openaiKey:   process.env.OPENAI_API_KEY,
        memory:      { dbPath: join(__dirname, '.max', 'memory.db') },
        autoStart:   opts.mode === 'api'  // heartbeat only in api mode
    });

    await max.initialize();

    if (!max._ready) process.exit(1);

    switch (opts.mode) {
        case 'swarm': await swarmMode(max, opts); break;
        case 'api':   await apiMode(max, opts);   break;
        default:      await chatMode(max, opts);  break;
    }
}

main().catch(err => {
    console.error('[MAX] Fatal error:', err);
    process.exit(1);
});
