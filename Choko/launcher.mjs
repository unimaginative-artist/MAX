#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath }            from 'url';
import { dirname, join }            from 'path';
import readline                     from 'readline';
import { Choko }                    from './Agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const C = {
    RESET:  '\x1b[0m',
    BOLD:   '\x1b[1m',
    DIM:    '\x1b[2m',
    PINK:   '\x1b[38;5;213m',
    MINT:   '\x1b[38;5;121m',
    YELLOW: '\x1b[33m',
    RED:    '\x1b[31m',
};

function loadEnv() {
    const envPath = join(__dirname, '..', 'config', 'api-keys.env');
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, 'utf8').replace(/\r/g, '').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) {
            const eq = t.indexOf('=');
            if (eq > 0) {
                const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
                if (k && v && !process.env[k]) process.env[k] = v;
            }
        }
    }
}

async function main() {
    loadEnv();
    console.log(`${C.PINK}${C.BOLD}[Choko] 🍫✨ Booting Kawaii Scout...${C.RESET}`);

    const agent = new Choko({ geminiKey: process.env.GEMINI_API_KEY });
    await agent.initialize();

    // Wire approval gate — print a visible banner when AgentLoop needs approval
    agent.agentLoop?.on('approvalNeeded', ({ tool, action, params, goal }) => {
        console.log(`\n${C.YELLOW}${'═'.repeat(50)}`);
        console.log(`  🚨 Choko needs approval!`);
        console.log(`  Goal:   ${goal?.title || 'background task'}`);
        console.log(`  Action: ${tool}.${action}`);
        console.log(`  → /approve  or  /deny`);
        console.log(`${'═'.repeat(50)}${C.RESET}\n`);
    });

    // Wire insights from heartbeat
    agent.heartbeat.on('insight', ({ source, label, result }) => {
        console.log(`\n  ${C.PINK}💡 [${source}]${C.RESET} ${label.slice(0, 60)}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const prompt = () => process.stdout.write(`\n${C.PINK}${C.BOLD}YOU:${C.RESET} `);

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) return prompt();

        // ── Slash commands ────────────────────────────────────────────────
        if (input.startsWith('/')) {
            const [cmd, ...rest] = input.slice(1).split(' ');
            const arg = rest.join(' ');

            switch (cmd) {
                case 'quit': case 'exit':
                    console.log('[Choko] Bye-bye! 🍫');
                    process.exit(0);

                case 'hat':
                    if (!arg) {
                        console.log(`[Choko] Available hats: ${[...agent.hats.keys()].join(', ')}`);
                        console.log(`[Choko] Current hat: ${agent.currentHat}`);
                    } else {
                        const ok = await agent.switchHat(arg);
                        console.log(ok ? `[Choko] 👒 Hat switched to: ${arg}` : `[Choko] Hat "${arg}" not found`);
                    }
                    break;

                case 'goals': {
                    const active = agent.goals.listActive();
                    console.log(`\n[Choko] ${active.length} active goals:`);
                    for (const g of active) console.log(`  [${g.id.slice(0,8)}] ${g.title} (${g.status})`);
                    break;
                }

                case 'status': {
                    const s = agent.getStatus();
                    console.log(`\n[Choko] 🍫 Status`);
                    console.log(`  Brain:  ${s.brain.smart?.backend || 'local'}`);
                    console.log(`  Memory: ${s.memory.totalMemories} facts`);
                    console.log(`  Drive:  Tension ${(s.drive.tension * 100).toFixed(0)}%`);
                    console.log(`  Hat:    ${agent.currentHat}`);
                    break;
                }

                case 'approve':
                    if (agent.agentLoop?._pendingApproval) {
                        agent.agentLoop.approve();
                        console.log('[Choko] ✅ Approved!');
                    } else console.log('[Choko] Nothing pending.');
                    break;

                case 'deny':
                    if (agent.agentLoop?._pendingApproval) {
                        agent.agentLoop.deny();
                        console.log('[Choko] ❌ Denied.');
                    } else console.log('[Choko] Nothing pending.');
                    break;

                default:
                    console.log(`[Choko] Unknown command: /${cmd}`);
            }
            return prompt();
        }

        // ── Chat with streaming ───────────────────────────────────────────
        process.stdout.write(`${C.DIM}[Choko] Scouting...${C.RESET}\r`);

        let streamStarted = false;
        try {
            await agent.think(input, {
                onToken: (token) => {
                    if (!streamStarted) {
                        process.stdout.write(`\r${C.PINK}${C.BOLD}Choko:${C.RESET} ${C.MINT}`);
                        streamStarted = true;
                    }
                    process.stdout.write(token);
                }
            });
            if (streamStarted) process.stdout.write(`${C.RESET}\n`);
        } catch (err) {
            process.stdout.write(`\r${C.RED}[Choko] Error: ${err.message}${C.RESET}\n`);
        }

        prompt();
    });

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${C.PINK}${C.BOLD}Choko is live!${C.RESET} 🍫✨  Type /quit to exit`);
    console.log(`  Commands: /hat [name]  /goals  /status  /approve  /deny`);
    console.log(`${'─'.repeat(50)}\n`);
    prompt();
}

main().catch(err => {
    console.error('[Choko] Fatal:', err.message);
    process.exit(1);
});
