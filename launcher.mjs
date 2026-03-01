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
// Handles markdown stripping, newlines, and word-wrap cleanly.
const BOX_WIDTH = 60;  // inner content width
const INNER     = BOX_WIDTH - 4;  // after '║  ' prefix and trailing space

function stripMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
        .replace(/\*(.+?)\*/g,     '$1')   // *italic*
        .replace(/`(.+?)`/g,       '$1')   // `code`
        .replace(/^#{1,6}\s+/gm,   '')     // ## headings
        .replace(/^\s*[-*]\s+/gm,  '• ')  // bullet points → •
        .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link](url) → text
        .trim();
}

function boxLine(text) {
    // Word-wrap a single paragraph into box lines
    const words = text.split(' ').filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
        if (current.length + word.length + 1 > INNER) {
            if (current) lines.push(`║  ${current}`);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) lines.push(`║  ${current}`);
    return lines;
}

function printInsight(insight) {
    process.stdout.write('\n');

    const border = '═'.repeat(BOX_WIDTH);
    const div    = '─'.repeat(BOX_WIDTH);
    console.log(`╔${border}╗`);
    console.log(`║  💡 MAX [${insight.source}]`);
    console.log(`║  ${insight.label}`);
    console.log(`╟${div}╢`);

    // Clean and split the result into paragraphs
    const cleaned    = stripMarkdown(insight.result || '');
    const paragraphs = cleaned.split(/\n+/).map(p => p.trim()).filter(Boolean);

    for (const para of paragraphs) {
        // Blank line between paragraphs (but not before the first)
        const isFirst = para === paragraphs[0];
        if (!isFirst) console.log('║');
        for (const line of boxLine(para)) {
            console.log(line);
        }
    }

    console.log(`╚${border}╝`);
    process.stdout.write('YOU: ');
}

// ─── Chat mode — interactive REPL ────────────────────────────────────────
async function chatMode(max, opts) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // ── Wire proactive insights to terminal output ──
    max.heartbeat.on('insight', printInsight);

    // ── Wire approval requests — pause and ask the user ──
    max.heartbeat.on('approvalNeeded', ({ description, goal, step, approve, deny }) => {
        process.stdout.write('\n');
        console.log('╔' + '═'.repeat(58) + '╗');
        console.log('║  ⚠️  MAX needs your approval before continuing');
        console.log('╟' + '─'.repeat(58) + '╢');
        console.log(`║  Goal: ${goal}`);
        console.log(`║  Step: ${step}`);
        const descLines = description.split('\n');
        for (const dl of descLines) console.log(`║  ${dl}`);
        console.log('╟' + '─'.repeat(58) + '╢');
        console.log('║  Type /approve to allow  |  /deny to skip');
        console.log('╚' + '═'.repeat(58) + '╝');
        process.stdout.write('YOU: ');
    });

    console.log('\n' + '─'.repeat(60));
    console.log('  MAX is live. I run things in the background.');
    console.log('  Commands:');
    console.log('  /status      — show internal state (tension, jobs, memory)');
    console.log('  /jobs        — list scheduled jobs and next run times');
    console.log('  /goals       — list MAX\'s active autonomous goals');
    console.log('  /addgoal <t> — add a goal for MAX to pursue autonomously');
    console.log('  /ingest <p>  — ingest a file, folder, or URL into knowledge base');
    console.log('  /kb          — list knowledge base sources');
    console.log('  /kbdrop <id> — remove a source from the knowledge base');
    console.log('  /createtool  — ask MAX to write a new tool at runtime');
    console.log('  /inspect     — MAX reads his own source and queues improvements');
  console.log('  /reflect     — force a deep self-reflection right now');
    console.log('  /approve     — approve a pending destructive action');
    console.log('  /deny        — deny a pending destructive action');
    console.log('  /swarm       — next message runs as parallel swarm');
    console.log('  /debate      — next message gets pro/con/verdict');
    console.log('  /persona     — switch: architect/grinder/paranoid/breaker/explainer/devil');
    console.log('  /memory      — show recent background discoveries');
    console.log('  /recall <q>  — semantic search across everything MAX knows');
    console.log('  /tasks       — show active tasks from tasks.md');
    console.log('  /addtask <t> — add a task to tasks.md');
    console.log('  /done <t>    — mark a task complete');
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
                await max.memory?.shutdown?.();
                await max.outcomes?.shutdown?.();
                rl.close();
                process.exit(0);
            }

            if (line === '/approve') {
                const ok = max.agentLoop?.approve();
                console.log(ok ? '[MAX] ✅ Action approved.\n' : '[MAX] No pending action.\n');
                ask(); return;
            }

            if (line === '/deny') {
                const ok = max.agentLoop?.deny();
                console.log(ok ? '[MAX] ❌ Action denied.\n' : '[MAX] No pending action.\n');
                ask(); return;
            }

            if (line.startsWith('/ingest ')) {
                const src = line.slice(8).trim();
                if (!src) { console.log('[MAX] Usage: /ingest <file|folder|url>\n'); ask(); return; }
                try {
                    console.log(`[MAX] 📥 Ingesting "${src}"...`);
                    const result = await max.kb.ingest(src);
                    if (result.success) {
                        if (result.type === 'directory') {
                            console.log(`[MAX] ✅ Ingested ${result.ingested} files (${result.skipped} skipped) from directory.\n`);
                        } else {
                            console.log(`[MAX] ✅ Ingested "${result.name}" — ${result.chunks} chunks.\n`);
                        }
                    } else {
                        console.log(`[MAX] ❌ Ingest failed: ${result.error}\n`);
                    }
                } catch (err) {
                    console.error(`[MAX] Ingest error: ${err.message}\n`);
                }
                ask(); return;
            }

            if (line === '/kb') {
                const sources = max.kb.listSources();
                const status  = max.kb.getStatus();
                console.log(`\n[MAX] Knowledge base — ${status.sources} sources | ${status.chunks} chunks | ${status.vectors} vectors`);
                if (sources.length === 0) {
                    console.log('  Empty. Use /ingest <file|folder|url> to add knowledge.\n');
                } else {
                    sources.forEach((s, i) =>
                        console.log(`  ${i+1}. [${s.id.slice(0,8)}] ${s.name} (${s.type}, ${s.chunk_count} chunks, ${s.ingested_at})`)
                    );
                    console.log();
                }
                ask(); return;
            }

            if (line.startsWith('/kbdrop ')) {
                const id = line.slice(8).trim();
                if (!id) { ask(); return; }
                try {
                    await max.kb.remove(id);
                    console.log(`[MAX] ✅ Removed source ${id} from knowledge base.\n`);
                } catch (err) {
                    console.error(`[MAX] Drop error: ${err.message}\n`);
                }
                ask(); return;
            }

            if (line.startsWith('/createtool ')) {
                const desc = line.slice(12).trim();
                if (!desc) { console.log('[MAX] Usage: /createtool <description of what the tool should do>\n'); ask(); return; }
                try {
                    console.log('[MAX] 🔧 Writing new tool...');
                    const result = await max.toolCreator.create(desc);
                    console.log(`[MAX] ✅ Tool "${result.name}" created and registered.\n`);
                } catch (err) {
                    console.error(`[MAX] Tool creation failed: ${err.message}\n`);
                }
                ask(); return;
            }

            if (line === '/reflect') {
                if (!max.reflection) { console.log('[MAX] ReflectionEngine not initialized.\n'); ask(); return; }
                console.log('[MAX] 🧠 Running deep self-reflection...');
                const summary = await max.reflection.forceReflect();
                console.log(`\n[MAX] Reflection complete:`);
                console.log(`  Total reflections : ${summary.reflections}`);
                console.log(`  Strengths (${summary.strengths.length}): ${summary.strengths.join('; ') || 'none yet'}`);
                console.log(`  Weaknesses (${summary.weaknesses.length}): ${summary.weaknesses.join('; ') || 'none yet'}`);
                console.log(`  Prompt patches: ${summary.promptPatches.length > 0 ? summary.promptPatches.join(' | ') : 'none yet'}`);
                console.log(`  Patterns: ${summary.patterns.join(', ') || 'none yet'}\n`);
                ask(); return;
            }

            if (line === '/inspect') {
                console.log('[MAX] 🔍 Inspecting own source...');
                await max.selfInspector.inspect();
                console.log(`[MAX] ${max.selfInspector.getSummary()}`);
                const queued = max.selfInspector.queueGoals(3);
                console.log(`[MAX] Queued ${queued.length} improvement goal(s).\n`);
                ask(); return;
            }

            if (line === '/goals') {
                const goals = max.goals?.listActive() || [];
                console.log(`\n[MAX] Active goals (${goals.length}):`);
                if (goals.length === 0) console.log('  None. Add one with /addgoal');
                goals.forEach((g, i) => console.log(`  ${i+1}. [${(g.priority*100).toFixed(0)}%] ${g.title} (${g.source})`));
                const completed = max.goals?.getStatus()?.completed || 0;
                console.log(`  Completed: ${completed}\n`);
                ask(); return;
            }

            if (line.startsWith('/addgoal ')) {
                const title = line.slice(9).trim();
                if (title) {
                    const id = max.goals?.addGoal({ title, source: 'user', type: 'task' });
                    console.log(id ? `[MAX] Goal added: "${title}"\n` : '[MAX] Could not add goal.\n');
                }
                ask(); return;
            }

            if (line === '/status') {
                const s = max.getStatus();
                const d = s.drive;
                const brain = s.brain;
                const fastInfo  = brain.fast?.ready  ? `${brain.fast.backend}/${brain.fast.model}`   : 'none';
                const smartInfo = brain.smart?.ready ? `${brain.smart.backend}/${brain.smart.model}` : 'none';
                console.log(`\n[MAX] Tension: ${(d.tension*100).toFixed(0)}% | Satisfaction: ${(d.satisfaction*100).toFixed(0)}% | Goals done: ${d.goalsCompleted}`);
                console.log(`[MAX] Brain — fast: ${fastInfo} | smart: ${smartInfo}`);
                console.log(`[MAX] Persona: ${s.persona.name} | Style: ${max.profile.styleName} | Memory: ${s.memory.totalMemories} facts | Conversations: ${s.memory.conversationTurns}`);
                console.log(`[MAX] Heartbeat: ${s.heartbeat?.running ? 'running' : 'stopped'} | Scheduler: ${s.scheduler?.running ? 'running' : 'stopped'} (${s.scheduler?.jobsRun} jobs run)`);
                if (s.goals) console.log(`[MAX] Goals: ${s.goals.active} active | ${s.goals.completed} completed | ${s.goals.failed} failed`);
                if (s.agentLoop) console.log(`[MAX] AgentLoop: ${s.agentLoop.cyclesRun} cycles | ${s.agentLoop.goalsCompleted} goals done | pending: ${s.agentLoop.pending ? 'YES (/approve or /deny)' : 'none'}`);
                if (s.outcomes && s.outcomes.total > 0) {
                    const rate = ((s.outcomes.success / s.outcomes.total) * 100).toFixed(0);
                    console.log(`[MAX] Outcomes: ${s.outcomes.total} tracked | ${rate}% success rate`);
                }
                console.log();
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

            if (line === '/tasks') {
                const tasks = max.profile.getActiveTasks();
                console.log(`\n[MAX] Active tasks (${tasks.length}):`);
                if (tasks.length === 0) console.log('  None. Add some with /addtask');
                tasks.forEach((t, i) => console.log(`  ${i+1}. ${t}`));
                console.log();
                ask(); return;
            }

            if (line.startsWith('/addtask ')) {
                const t = line.slice(9).trim();
                if (t) {
                    max.profile.addTask(t);
                    console.log(`[MAX] Added: "${t}"\n`);
                }
                ask(); return;
            }

            if (line.startsWith('/done ')) {
                const t = line.slice(6).trim();
                const ok = max.profile.completeTask(t);
                console.log(ok ? `[MAX] Done: "${t}" ✓\n` : `[MAX] Couldn't find that task.\n`);
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

    // First-run onboarding — runs before chat, only once
    if (isFirstRun() && opts.mode === 'chat') {
        await runOnboarding();
        // Reload profile now that onboarding saved the files
        max.profile.load();
    }

    // Returning user greeting
    if (!isFirstRun() && opts.mode === 'chat' && max.profile.hasProfile) {
        const tasks = max.profile.getActiveTasks();
        const name  = max.profile.name;
        console.log(`\n[MAX] Back, ${name}.${tasks.length > 0 ? ` You have ${tasks.length} active task${tasks.length > 1 ? 's' : ''}.` : ''}\n`);
    }

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
