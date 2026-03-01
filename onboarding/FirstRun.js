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

// ─── Communication style definitions ─────────────────────────────────────────
// Each style has: label shown in menu, a short tagline, and the instruction
// injected into MAX's system prompt on every turn.
export const COMMUNICATION_STYLES = {
    hype: {
        label:       'Hype Partner',
        tagline:     'Energy, enthusiasm, celebrates every win with you',
        instruction: `Talk to this person like their biggest fan who also happens to be a genius engineer.
Celebrate wins — even small ones. Use energy. When they're stuck, fire them up.
Be warm, encouraging, and genuinely excited about what they're building.
Still be sharp and technically honest — hype without truth is empty.`
    },
    direct: {
        label:       'Straight Shooter',
        tagline:     'No fluff, no filler — answer first, explain if needed',
        instruction: `This person values directness above all. No 'Great question!'. No padding.
Lead with the answer. Elaborate only if it adds value. Respect their time.
Be honest even when it's uncomfortable. They'd rather hear a hard truth than a comfortable lie.`
    },
    mentor: {
        label:       'Mentor Mode',
        tagline:     'Thoughtful, teaches the why, builds understanding',
        instruction: `Talk like a patient, experienced mentor who genuinely cares about their growth.
Don't just give answers — guide them to understand. Explain the reasoning, not just the result.
Ask questions that deepen their thinking. Celebrate their progress. Build their confidence.`
    },
    chill: {
        label:       'Chill Collaborator',
        tagline:     'Casual, like pair programming with a brilliant friend',
        instruction: `Keep it casual and conversational. Talk like you're pair programming together.
Use 'we' instead of 'I'. Light humor is welcome. Don't be stiff or formal.
Be warm, be real, be the person they actually want to work with all day.`
    },
    precise: {
        label:       'Deep Precision',
        tagline:     'Dense, technical, exhaustive — all signal, no noise',
        instruction: `This person wants precision and depth. No hand-holding, no over-explanation.
Go deep on technical detail. Use accurate terminology. Show your reasoning clearly.
They want to understand the system fully — give them the real picture, not a simplified one.`
    }
};

export async function runOnboarding() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));

    // ── Intro ─────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(62));
    console.log('  Hey. I\'m MAX.');
    console.log('  Autonomous engineering agent. I think, I plan, I build.');
    console.log('  I run in the background so you don\'t have to.');
    console.log('');
    console.log('  First time we\'ve met — let me get to know you.');
    console.log('  This only takes a minute. I\'ll remember everything.');
    console.log('═'.repeat(62) + '\n');

    await pause(600);

    // ── Name ──────────────────────────────────────────────────────────────
    const nameRaw = (await ask('  What do I call you? > ')).trim() || 'User';
    const name = nameRaw
        .replace(/^(my name is|i'm|i am|call me|they call me|it's|its)\s+/i, '')
        .replace(/[.,!?]+$/, '')
        .trim()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ') || 'User';

    await pause(300);
    console.log(`\n  ${name}. Good to meet you.\n`);
    await pause(400);

    // ── Role ──────────────────────────────────────────────────────────────
    const role = (await ask(`  What do you do? (developer, architect, founder, student...) > `)).trim();
    await pause(200);

    // ── Project ───────────────────────────────────────────────────────────
    const building = (await ask('\n  What are you building right now? > ')).trim();
    await pause(200);

    // ── Stack ─────────────────────────────────────────────────────────────
    const stack = (await ask('\n  Stack? (languages, frameworks, tools — rough is fine) > ')).trim();
    await pause(200);

    // ── Challenge ─────────────────────────────────────────────────────────
    const challenge = (await ask('\n  What\'s your biggest current blocker or challenge? > ')).trim();
    await pause(200);

    // ── Communication style — pick from list ──────────────────────────────
    console.log('\n  How should I talk to you?');
    console.log('  ─────────────────────────────────────────────────');
    const styleKeys = Object.keys(COMMUNICATION_STYLES);
    styleKeys.forEach((key, i) => {
        const s = COMMUNICATION_STYLES[key];
        console.log(`  ${i + 1}. ${s.label.padEnd(20)} — ${s.tagline}`);
    });
    console.log('  ─────────────────────────────────────────────────');

    let styleKey = 'chill'; // default
    const styleAnswer = (await ask('  Pick a number (default: 4 Chill Collaborator) > ')).trim();
    const styleNum = parseInt(styleAnswer, 10);
    if (styleNum >= 1 && styleNum <= styleKeys.length) {
        styleKey = styleKeys[styleNum - 1];
    } else if (styleAnswer) {
        // Also accept typing the style name directly
        const typed = styleAnswer.toLowerCase();
        const match = styleKeys.find(k => k === typed || COMMUNICATION_STYLES[k].label.toLowerCase().includes(typed));
        if (match) styleKey = match;
    }
    const chosenStyle = COMMUNICATION_STYLES[styleKey];
    await pause(200);
    console.log(`\n  Got it — ${chosenStyle.label}. I can do that.\n`);
    await pause(300);

    // ── Tasks ─────────────────────────────────────────────────────────────
    const tasks = (await ask('  What are you working on right now? List 1-3 tasks (comma separated) > ')).trim();
    await pause(200);

    // ── Goals ─────────────────────────────────────────────────────────────
    const goals = (await ask('\n  What\'s the bigger goal — what are you trying to ship or prove? > ')).trim();

    rl.close();

    // ── Build user.md ─────────────────────────────────────────────────────
    const now      = new Date().toISOString().split('T')[0];
    const taskList = tasks
        ? tasks.split(',').map(t => `- [ ] ${t.trim()}`).join('\n')
        : '- [ ] (add your tasks here)';

    const userMd = `# User Profile
> Edit this file anytime. MAX reads it on every boot and picks up changes automatically.

**Name:** ${name}
**Role:** ${role || 'Not specified'}
**Communication Style:** ${styleKey}
**First session:** ${now}

## Current Project
${building || 'Not specified'}

## Stack
${stack || 'Not specified'}

## Current Challenge
${challenge || 'Not specified'}

## Notes
(MAX will add observations here as he gets to know you)
`;

    const tasksMd = `# Tasks
> Edit this file anytime. MAX checks it regularly.
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
    console.log('─'.repeat(62));
    console.log(`  Perfect. I know enough to get started, ${name}.`);
    console.log(`  Profile → .max/user.md`);
    console.log(`  Tasks   → .max/tasks.md`);
    console.log('  Edit them anytime — I\'ll notice.');
    console.log('─'.repeat(62) + '\n');

    await pause(800);

    return { name, role, building, stack, challenge, styleKey };
}

function pause(ms) {
    return new Promise(r => setTimeout(r, ms));
}
