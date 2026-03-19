#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════
// FILE: launcher-tui.mjs
// TUI split‑pane launcher for MAX
// Top pane: Clean chat conversation
// Bottom pane: Tool calls, file reads, shell output
// Input at bottom of screen
// ═══════════════════════════════════════════════════════════

import blessed from 'blessed';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import figlet from 'figlet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// ═══════════════════════════════════════════════════════════
// TUI SETUP
// ═══════════════════════════════════════════════════════════
const screen = blessed.screen({
    smartCSR: true,
    title: 'MAX TUI',
    fullUnicode: true,
});

// Top pane — chat conversation
const chatPane = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '70%',
    label: ' {bold}💬 MAX Chat{/bold} ',
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } },
});

// Bottom pane — tool activity
const toolPane = blessed.box({
    parent: screen,
    top: '70%',
    left: 0,
    width: '100%',
    height: '30%',
    label: ' {bold}🛠️  Tool Activity{/bold} ',
    border: { type: 'line' },
    style: { border: { fg: 'yellow' } },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } },
});

// Input bar
const input = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    inputOnFocus: true,
    border: { type: 'line' },
    style: { border: { fg: 'green' }, fg: 'white', bg: 'black' },
    keys: true,
    vi: true,
});

// ═══════════════════════════════════════════════════════════
// PANE HELPERS
// ═══════════════════════════════════════════════════════════
function addChatMessage(sender, message, color = 'white') {
    const time = new Date().toLocaleTimeString();
    const line = `{${color}-fg}{bold}${sender}:{/bold} ${message}{/}`;
    chatPane.pushLine(`[${time}] ${line}`);
    chatPane.setScrollPerc(100);
    screen.render();
}

function addToolOutput(output) {
    const time = new Date().toLocaleTimeString();
    toolPane.pushLine(`[${time}] ${output}`);
    toolPane.setScrollPerc(100);
    screen.render();
}

// ═══════════════════════════════════════════════════════════
// BOOT ANIMATION
// ═══════════════════════════════════════════════════════════
async function bootAnimation() {
    screen.clearRegion(0, screen.height, 0, screen.width);
    const banner = await new Promise((resolve) => {
        figlet('MAX', { font: 'Standard', horizontalLayout: 'full' }, (err, data) => {
            if (err) resolve('MAX');
            resolve(data);
        });
    });
    addChatMessage('SYSTEM', banner, 'magenta');
    addChatMessage('SYSTEM', `v${packageJson.version} — Autonomous Engineering Agent`, 'gray');
    addChatMessage('SYSTEM', '──────────────────────────────────────', 'gray');
    screen.render();
}

// ═══════════════════════════════════════════════════════════
// CHAT LOOP (simplified — same as launcher.mjs but with pane output)
// ═══════════════════════════════════════════════════════════
let conversation = [];

async function handleInput(inputText) {
    inputText = inputText.trim();
    if (!inputText) return;

    addChatMessage('YOU', inputText, 'green');
    conversation.push({ role: 'user', content: inputText });

    // Simulate MAX processing (this would be replaced with actual MAX API call)
    addToolOutput('Processing...');
    await new Promise(resolve => setTimeout(resolve, 300));

    // For demo: echo with tool simulation
    const response = `I heard: "${inputText}". I'll process that now.`;
    addChatMessage('MAX', response, 'cyan');
    conversation.push({ role: 'assistant', content: response });

    // Simulate tool calls
    if (inputText.includes('file')) {
        addToolOutput('TOOL: file:read → reading launcher.mjs');
    }
    if (inputText.includes('shell')) {
        addToolOutput('TOOL: shell:run → npm test');
    }
    if (inputText.includes('help')) {
        addToolOutput('TOOL: goals:add → queue investigation');
    }
}

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
async function start() {
    await bootAnimation();
    input.focus();

    input.on('submit', async (value) => {
        input.clearValue();
        screen.render();
        await handleInput(value);
    });

    screen.key(['C-c'], () => {
        screen.destroy();
        process.exit(0);
    });

    screen.render();
}

start().catch(err => {
    console.error('TUI failed:', err);
    process.exit(1);
});
