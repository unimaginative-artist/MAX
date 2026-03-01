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
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, 'utf8').split('\n');
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

// ─── Proactive insight printer ────────────────────────────────────────────
// Prints background insights without destroying the readline prompt.
// Called when the scheduler or heartbeat produces something worth surfacing.
function printInsight(insight) {
    // Move cursor to new line (readline may have a partial prompt on screen)
    process.stdout.write('\n');
    console.log('╔' + '═'.repeat(58) + '╗');
    console.log(`║  💡 MAX [background — ${insight.source}]`);
    console.log(`║  ${insight.label}`);
    console.log('╟' + '─'.repeat(58) + '╢');

    // Word-wrap the result to 56 chars
    const words  = (insight.result || '').split(' ');
    let   line   = '║  ';
    for (const word of words) {
        if (line.length + word.length > 58) {
            console.log(line);
            line = '║  ' + word + ' ';
        } else {
            line += word + ' ';
        }
    }
    if (line.trim() !== '║') console.log(line);

    console.log('╚' + '═'.repeat(58) + '╝');
    // Re-print the prompt so the user knows they can still type
    process.stdout.write('YOU: ');
}

// ─── Chat mode — interactive REPL ────────────────────────────────────────
async function chatMode(max, opts) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // ── Wire proactive insights to terminal output ──
    // This is the key: background tasks now actually reach the user
    max.heartbeat.on('insight', printInsight);

    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is live. I run things in the background.');
    console.log('  Commands:');
    console.log('  /status      — show internal state (tension, jobs, memory)');
    console.log('  /jobs        — list scheduled jobs and next run times');
    console.log('  /swarm       — next message runs as parallel swarm');
    console.log('  /debate      — next message gets pro/con/verdict');
    console.log('  /persona     — switch: architect/grinder/paranoid/breaker/explainer/devil');
  console.log('  /memory      — show recent background discoveries');
    console.log('  /recall <q>  — semantic search across everything MAX knows');
    console.log('  /clear       — wipe conversation context');
    console.log('  /quit        — exit');
    console.log('─'.repeat(60) + '\n');

    let swarmNext     = false;
    let debateNext    = false;
    let activePersona = opts.persona || null;

    const ask = () => {
        rl.question('YOU: ', async (input) => {
            const line = input.trim();
            if (!line) { ask(); return; }

            // ── Commands ──────────────────────────────────────────────────
            if (line === '/quit' || line === '/exit') {
                console.log('\n[MAX] Shutting down. Memory saved.');
                max.scheduler?.stop();
                max.heartbeat?.stop();
                max.memory?.shutdown();
                rl.close();
                process.exit(0);
            }

            if (line === '/status') {
                const s = max.getStatus();
                const d = s.drive;
                console.log(`\n[MAX] Tension: ${(d.tension*100).toFixed(0)}% | Satisfaction: ${(d.satisfaction*100).toFixed(0)}% | Goals done: ${d.goalsCompleted}`);
                console.log(`[MAX] Persona: ${s.persona.name} | Memory: ${s.memory.totalMemories} facts | Conversations: ${s.memory.conversationTurns}`);
                console.log(`[MAX] Heartbeat: ${s.heartbeat?.running ? 'running' : 'stopped'} | Scheduler: ${s.scheduler?.running ? 'running' : 'stopped'} (${s.scheduler?.jobsRun} jobs run)\n`);
                ask(); return;
            }

            if (line === '/jobs') {
                const jobs = max.scheduler?.listJobs() || [];
                console.log('\n[MAX] Scheduled jobs:');
                for (const j of jobs) {
                    console.log(`  • ${j.label} (${j.every}) — last: ${j.lastRun} | next in: ${j.nextRunIn}`);
                }
                console.log();
                ask(); return;
            }

            if (line === '/memory') {
                const items = max.memory.recall('curiosity', 5);
                const scheduled = max.memory.recall('scheduled', 3);
                console.log('\n[MAX] Recent curiosity:');
                for (const m of items) {
                    try {
                        const parsed = JSON.parse(m.content);
                        console.log(`  • ${parsed.task}: ${String(parsed.result || '').slice(0, 120)}...`);
                    } catch { console.log(`  • ${String(m.content).slice(0, 120)}`); }
                }
                console.log('[MAX] Recent scheduled insights:');
                for (const m of scheduled) {
                    try {
                        const parsed = JSON.parse(m.content);
                        console.log(`  • ${parsed.job}: ${String(parsed.result || '').slice(0, 120)}...`);
                    } catch { console.log(`  • ${String(m.content).slice(0, 120)}`); }
                }
                console.log();
                ask(); return;
            }

            if (line.startsWith('/recall ')) {
                const q = line.slice(8).trim();
                if (!q) { ask(); return; }
                try {
                    const results = await max.memory.recall(q, { topK: 5 });
                    console.log(`\n[MAX] Memory search: "${q}"`);
                    if (results.length === 0) {
                        console.log('  Nothing found.\n');
                    } else {
                        results.forEach((r, i) => {
                            const score = r.score ? ` (${(r.score * 100).toFixed(0)}% match)` : '';
                            console.log(`  ${i+1}.${score} ${r.content.slice(0, 150)}`);
                        });
                        console.log();
                    }
                } catch (err) { console.error('[MAX] Recall error:', err.message); }
                ask(); return;
            }

            if (line === '/workspace') {
                const ws = max.memory.getWorkspaceContext();
                console.log('\n[MAX] What I know about your current work:');
                for (const [k, v] of Object.entries(ws)) {
                    console.log(`  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
                }
                console.log();
                ask(); return;
            }

            if (line === '/clear') {
                max.clearContext();
                ask(); return;
            }

            if (line === '/swarm') {
                swarmNext = true;
                console.log('[MAX] Next message → swarm.\n');
                ask(); return;
            }

            if (line === '/debate') {
                debateNext = true;
                console.log('[MAX] Next message → debate.\n');
                ask(); return;
            }

            if (line.startsWith('/persona')) {
                const p = line.split(' ')[1];
                if (p) {
                    try {
                        max.persona.switchTo(p);
                        activePersona = p;
                        console.log(`[MAX] Persona → ${p}\n`);
                    } catch (err) { console.log(`[MAX] ${err.message}\n`); }
                } else {
                    console.log('[MAX] Options: architect / grinder / paranoid / breaker / explainer / devil\n');
                }
                ask(); return;
            }

            // ── Swarm ─────────────────────────────────────────────────────
            if (swarmNext) {
                swarmNext = false;
                try {
                    console.log('\n[MAX] 🐝 Swarm starting...\n');
                    const result = await max.swarmThink(line);
                    console.log('\n' + '═'.repeat(60));
                    console.log('MAX (Swarm synthesis):');
                    console.log(result.synthesis || 'No synthesis produced.');
                    console.log('═'.repeat(60) + '\n');
                } catch (err) { console.error('[MAX] Swarm error:', err.message); }
                ask(); return;
            }

            // ── Debate ────────────────────────────────────────────────────
            if (debateNext) {
                debateNext = false;
                try {
                    console.log('\n[MAX] ⚔️  Debating...\n');
                    const result = await max.debateDecision({ title: line, description: '', stakes: 'medium' });
                    console.log('\n' + '═'.repeat(60));
                    console.log(`Verdict: ${result.verdict?.recommendation} (${((result.verdict?.confidence || 0) * 100).toFixed(0)}% confidence)`);
                    console.log(`Reasoning: ${result.verdict?.reasoning}`);
                    if (result.verdict?.conditions) console.log(`Conditions: ${result.verdict.conditions}`);
                    console.log('═'.repeat(60) + '\n');
                } catch (err) { console.error('[MAX] Debate error:', err.message); }
                ask(); return;
            }

            // ── Normal chat ───────────────────────────────────────────────
            try {
                process.stdout.write('\nMAX: ');
                const result = await max.think(line, { persona: activePersona });
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

// ─── Swarm mode — one-shot ────────────────────────────────────────────────
async function swarmMode(max, opts) {
    const task = opts.task || process.argv.slice(2).filter(a => !a.startsWith('--')).join(' ');
    if (!task) { console.error('[MAX] --mode swarm requires --task "..."'); process.exit(1); }

    const result = await max.swarmThink(task);
    console.log('\n' + '═'.repeat(60));
    console.log('SYNTHESIS:');
    console.log(result.synthesis);
    console.log('═'.repeat(60));
    max.scheduler?.stop();
    process.exit(0);
}

// ─── API mode ─────────────────────────────────────────────────────────────
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
        ollamaModel:   process.env.OLLAMA_MODEL,
        geminiKey:     process.env.GEMINI_API_KEY,
        openaiKey:     process.env.OPENAI_API_KEY,
        heartbeatMs:   5 * 60 * 1000,   // background pulse every 5 min
        memory:        { dbPath: join(__dirname, '.max', 'memory.db') }
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
    console.error('[MAX] Fatal:', err);
    process.exit(1);
});
