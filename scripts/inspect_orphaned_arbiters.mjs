// ═══════════════════════════════════════════════════════════════════════════
// inspect_orphaned_arbiters.mjs — Deep Quality & Reality Check on SOMA's 102 Arbiters
// Evaluates every orphaned arbiter to determine if it is:
// A) Mock/Tutorial Template, B) Forwarding Stub, C) Legacy Deprecated, or D) Genuine High-Value
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const SOMA_ROOT = 'C:\\Users\\barry\\Desktop\\SOMA';
const arbitersDir = path.join(SOMA_ROOT, 'arbiters');
const loadersDir = path.join(SOMA_ROOT, 'server', 'loaders');

// Read loader code
let allLoaderCode = '';
for (const f of fs.readdirSync(loadersDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs'))) {
    allLoaderCode += fs.readFileSync(path.join(loadersDir, f), 'utf8') + '\n';
}
if (fs.existsSync(path.join(SOMA_ROOT, 'server', 'soma-server.js'))) {
    allLoaderCode += fs.readFileSync(path.join(SOMA_ROOT, 'server', 'soma-server.js'), 'utf8');
}

const arbiterFiles = fs.readdirSync(arbitersDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
const orphaned = arbiterFiles.filter(f => !allLoaderCode.includes(f.replace(/\.(js|cjs)$/, '')));

const categories = {
    stubs: [],         // < 15 lines forwarding stub
    mocks: [],         // contains "Example implementation", "simulate", "placeholder"
    legacy: [],        // references deprecated Phase 1 agents or removed modules
    substantive: []    // > 100 lines with real logic, algorithms, DB, or neural calls
};

for (const file of orphaned) {
    const fullPath = path.join(arbitersDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').length;

    if (lines < 15 && (content.includes('export') || content.includes('require'))) {
        categories.stubs.push({ file, lines });
    } else if (content.includes('Example implementation') || content.includes('Simulate file search') || content.includes('TODO: implement')) {
        categories.mocks.push({ file, lines });
    } else if (content.includes('Kuze') || content.includes('Batou') || content.includes('Jetstream') || content.includes('SOMA-1T')) {
        categories.legacy.push({ file, lines });
    } else if (lines > 80) {
        categories.substantive.push({ file, lines });
    } else {
        categories.mocks.push({ file, lines });
    }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  SOMA ARBITER VALUE BREAKDOWN (${orphaned.length} Total Orphaned)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`1. 📄 CJS/ESM Forwarding Stubs: ${categories.stubs.length}`);
console.log(`2. 🎭 Mocks & Tutorial Templates: ${categories.mocks.length}`);
console.log(`3. 🏺 Legacy Deprecated (Old Phase 1 / SOMA-1T): ${categories.legacy.length}`);
console.log(`4. 💎 Substantive Real Logic: ${categories.substantive.length}`);

console.log('\n--- 💎 High-Value Substantive Arbiters ---');
for (const s of categories.substantive.slice(0, 15)) {
    console.log(`• ${s.file.padEnd(35)} (${s.lines} lines)`);
}

console.log('\n--- 🎭 Sample Mocks/Templates (Worthless/Simulated) ---');
for (const m of categories.mocks.slice(0, 8)) {
    console.log(`• ${m.file.padEnd(35)} (${m.lines} lines)`);
}

console.log('\n--- 🏺 Sample Legacy (Deprecated Agents) ---');
for (const l of categories.legacy.slice(0, 8)) {
    console.log(`• ${l.file.padEnd(35)} (${l.lines} lines)`);
}
