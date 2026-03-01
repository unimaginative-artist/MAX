// ═══════════════════════════════════════════════════════════════════════════
// FirstRun.js — MAX's onboarding interview
// Runs once on first boot. Saves everything to .max/user.md and .max/tasks.md
// MAX reads those files on every subsequent boot.
// ═══════════════════════════════════════════════════════════════════════════

import readline from 'readline';
import fs       from 'fs';
import path     from 'path';

const DATA_DIR  = path.join(process.cwd(), '.max');
const USER_FILE = path.join(DATA_DIR, 'user.md');
const TASK_FILE = path.join(DATA_DIR, 'tasks.md');

export function isFirstRun() {
    return !fs.existsSync(USER_FILE);
}

export async function runOnboarding() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    // ── Intro ─────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(62));
    console.log('  M-M-MAX. Autonomous engineering agent.');
    console.log('  First time we\'ve met.');
    console.log('  I need to know who I\'m working with.');
    console.log('  Answer what you can. Skip what you can\'t. Let\'s go.');
    console.log('═'.repeat(62) + '\n');

    await pause(600);

    // ── Questions ─────────────────────────────────────────────────────────
    const name = (await ask('  What do I call you? > ')).trim() || 'User';
    await pause(200);

    const role = (await ask(`\n  What do you do, ${name}? (developer, architect, student...) > `)).trim();
    await pause(200);

    const building = (await ask('\n  What are you building right now? > ')).trim();
    await pause(200);

    const stack = (await ask('\n  What\'s your stack? (languages, frameworks, tools) > ')).trim();
    await pause(200);

    const challenge = (await ask('\n  What\'s your biggest current challenge or blocker? > ')).trim();
    await pause(200);

    const style = (await ask('\n  How do you want me to talk to you? (blunt/detailed/brief) > ')).trim() || 'blunt';
    await pause(200);

    const tasks = (await ask('\n  List 1-3 active tasks you want me to track (comma separated) > ')).trim();
    await pause(200);

    const goals = (await ask('\n  Any longer-term goals? What are you trying to ship? > ')).trim();

    rl.close();

    // ── Build user.md ─────────────────────────────────────────────────────
    const now     = new Date().toISOString().split('T')[0];
    const taskList = tasks
        ? tasks.split(',').map(t => `- [ ] ${t.trim()}`).join('\n')
        : '- [ ] (add your tasks here)';

    const userMd = `# User Profile
> Edit this file anytime. MAX reads it on every boot.

**Name:** ${name}
**Role:** ${role || 'Not specified'}
**First session:** ${now}

## Current Project
${building || 'Not specified'}

## Stack
${stack || 'Not specified'}

## Current Challenge
${challenge || 'Not specified'}

## Communication Style
${style}

## Notes
(MAX will add notes here as he learns about you)
`;

    const tasksMd = `# Tasks
> Edit this file anytime. MAX checks it regularly and will remind you.
> Format: - [ ] pending | - [x] done | - [~] in progress

## Active
${taskList}

## Goals
${goals || '(add longer-term goals here)'}

## Backlog
(add future tasks here)

## Completed
(MAX moves finished tasks here)
`;

    // ── Save files ────────────────────────────────────────────────────────
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USER_FILE,  userMd);
    fs.writeFileSync(TASK_FILE, tasksMd);

    // ── Closing ───────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(62));
    console.log(`  Got it, ${name}.`);
    console.log(`  Your profile is at  .max/user.md`);
    console.log(`  Your tasks are at   .max/tasks.md`);
    console.log('  Edit them anytime. I\'ll pick up the changes.');
    console.log('─'.repeat(62) + '\n');

    await pause(800);

    return { name, role, building, stack, challenge, style };
}

function pause(ms) {
    return new Promise(r => setTimeout(r, ms));
}
