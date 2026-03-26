#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Choko Launcher
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import readline from 'readline';
import { Choko } from './Agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load config ─────────────────────────────────────────────────────────
function loadEnv() {
    const envPath = join(__dirname, '..', 'config', 'api-keys.env');
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

async function main() {
    loadEnv();
    console.log('[Choko] 🚀 Booting...');

    const agent = new Choko({
        geminiKey: process.env.GEMINI_API_KEY
    });

    await agent.initialize();

    const rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout, 
        terminal: true 
    });

    const ask = () => {
        process.stdout.write('\nYOU: ');
    };

    rl.on('line', async (line) => {
        const input = line.trim();
        if (input === '/quit' || input === '/exit') {
            console.log('[Choko] Shutting down.');
            process.exit(0);
        }

        try {
            process.stdout.write(`\r[Choko] Thinking...\r`);
            const response = await agent.think(input);
            console.log(`\nChoko: ${response}`);
        } catch (err) {
            console.error(`\n[Choko] Error: ${err.message}`);
        }
        ask();
    });

    console.log('\n' + '─'.repeat(40));
    console.log('  Choko is live. Type /quit to exit.');
    console.log('─'.repeat(40));
    ask();
}

main().catch(err => {
    console.error('[Agent0] Fatal:', err);
    process.exit(1);
});
