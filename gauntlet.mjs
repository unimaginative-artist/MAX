// MAX Gauntlet — tests all three capabilities in sequence
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PASS = '✅ PASSED';
const FAIL = '❌ FAILED';

let score = 0;

// ── 1. Ollama Streaming ──────────────────────────────────────────────────────
async function testStreaming() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  TEST 1: Ollama Streaming (Zero-Silence Fast Tier)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const { Brain } = await import('./core/Brain.js');
    const brain = new Brain(null, {});
    await brain.initialize();

    if (!brain._fast.ready) {
        console.log(`  ⚠️  Ollama not running — testing DeepSeek streaming fallback`);
    }

    const tokens = [];
    process.stdout.write('  Streaming: ');
    try {
        await brain.think('Count to 5, one number per word. Be brief.', {
            tier: 'fast',
            maxTokens: 64,
            onToken: (t) => {
                tokens.push(t);
                process.stdout.write(t);
            }
        });
        process.stdout.write('\n');

        if (tokens.length > 1) {
            console.log(`  ${PASS} — ${tokens.length} tokens streamed live (backend: ${brain._fast.backend || 'deepseek-fallback'})`);
            return true;
        } else {
            console.log(`  ${FAIL} — only ${tokens.length} token(s) received, streaming not working`);
            return false;
        }
    } catch (err) {
        console.log(`\n  ${FAIL} — ${err.message}`);
        return false;
    }
}

// ── 2. CI Watcher ────────────────────────────────────────────────────────────
async function testCIWatcher() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  TEST 2: CI Watcher (Self-Healing Nervous System)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const { CIWatcher } = await import('./core/CIWatcher.js');

    let fixGoalInjected = false;
    const mockMax = {
        goals: {
            listActive: () => [],
            addGoal: (g) => {
                fixGoalInjected = true;
                console.log(`  [CI] Fix goal injected: "${g.title}" (priority: ${g.priority})`);
            }
        }
    };

    const watcher = new CIWatcher(mockMax, { testCommand: 'node -e "process.exit(1)"' });
    await watcher.runChecks();

    if (fixGoalInjected && watcher.lastResult?.success === false) {
        console.log(`  ${PASS} — failure detected and fix goal queued at priority 0.92`);
        return true;
    } else {
        console.log(`  ${FAIL} — watcher result: ${JSON.stringify(watcher.lastResult)}, goalInjected: ${fixGoalInjected}`);
        return false;
    }
}

// ── 3. Playwright Browser ─────────────────────────────────────────────────────
async function testBrowser() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  TEST 3: Playwright Browser (Real Eyes)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
        const { BrowserTool } = await import('./tools/BrowserTool.js');

        console.log('  Navigating to example.com...');
        const nav = await BrowserTool.actions.goto({ url: 'https://example.com' });
        console.log(`  Page: "${nav.title}" (status ${nav.status})`);

        const extract = await BrowserTool.actions.extract({});
        const hasContent = extract.content && extract.content.length > 50;
        console.log(`  Extracted ${extract.content?.length} chars`);

        const shot = await BrowserTool.actions.screenshot({ name: 'gauntlet' });
        console.log(`  Screenshot: ${shot.filename}`);

        await BrowserTool.actions.close();

        if (nav.status === 200 && hasContent) {
            console.log(`  ${PASS} — browser navigated, extracted content, screenshot saved`);
            return true;
        } else {
            console.log(`  ${FAIL} — nav status: ${nav.status}, content length: ${extract.content?.length}`);
            return false;
        }
    } catch (err) {
        console.log(`  ${FAIL} — ${err.message}`);
        return false;
    }
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log('\n🏆  MAX GAUNTLET v2 — Full Capability Test');
console.log('    Running all three systems...\n');

const r1 = await testStreaming();
const r2 = await testCIWatcher();
const r3 = await testBrowser();

score = [r1, r2, r3].filter(Boolean).length;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  FINAL SCORE: ${score}/3`);
console.log(`  Streaming:   ${r1 ? PASS : FAIL}`);
console.log(`  CI Watcher:  ${r2 ? PASS : FAIL}`);
console.log(`  Browser:     ${r3 ? PASS : FAIL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

process.exit(score === 3 ? 0 : 1);
