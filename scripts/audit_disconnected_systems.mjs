// ═══════════════════════════════════════════════════════════════════════════
// audit_disconnected_systems.mjs — Comprehensive Neural & Cluster Disconnection Audit
// Scans SOMA and MAX to identify orphaned arbiters, dormant loops, and dead wires.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const SOMA_ROOT = 'C:\\Users\\barry\\Desktop\\SOMA';
const MAX_ROOT = 'C:\\Users\\barry\\Desktop\\MAX';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🔍 SOMA & MAX SYSTEM DISCONNECTION & NEURAL AUDIT');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 1. SOMA ARBITER AUDIT ──────────────────────────────────────────────────
console.log('─── 1. SOMA Arbiters Audit ───');
const arbitersDir = path.join(SOMA_ROOT, 'arbiters');
const loadersDir = path.join(SOMA_ROOT, 'server', 'loaders');

const arbiterFiles = fs.readdirSync(arbitersDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
const loaderFiles = fs.existsSync(loadersDir) 
    ? fs.readdirSync(loadersDir).filter(f => f.endsWith('.js') || f.endsWith('.cjs'))
    : [];

// Read all server and loader code to check for imports
let allLoaderCode = '';
for (const f of loaderFiles) {
    allLoaderCode += fs.readFileSync(path.join(loadersDir, f), 'utf8') + '\n';
}
if (fs.existsSync(path.join(SOMA_ROOT, 'server', 'soma-server.js'))) {
    allLoaderCode += fs.readFileSync(path.join(SOMA_ROOT, 'server', 'soma-server.js'), 'utf8');
}

const connectedArbiters = [];
const orphanedArbiters = [];

for (const arb of arbiterFiles) {
    const base = arb.replace(/\.(js|cjs)$/, '');
    if (allLoaderCode.includes(base)) {
        connectedArbiters.push(arb);
    } else {
        orphanedArbiters.push(arb);
    }
}

console.log(`Total arbiters in SOMA/arbiters: ${arbiterFiles.length}`);
console.log(`Loaded/Wired in loaders or server: ${connectedArbiters.length}`);
console.log(`Orphaned/Dormant (never imported): ${orphanedArbiters.length}`);
console.log(`Sample orphaned arbiters:`, orphanedArbiters.slice(0, 8));


// ── 2. MAX CORE SUBSYSTEMS & WIRES AUDIT ───────────────────────────────────
console.log('\n─── 2. MAX Core Subsystems Audit ───');
const maxJs = fs.readFileSync(path.join(MAX_ROOT, 'core', 'MAX.js'), 'utf8');

// Check which subsystems in constructor are actually started/used
const instantiated = [];
const constructorRegex = /this\.([a-zA-Z0-9_]+)\s*=\s*this\._safeInstantiate\('([^']+)'/g;
let match;
while ((match = constructorRegex.exec(maxJs)) !== null) {
    instantiated.push(match[1]);
}

const dormantInWorker = [];
const activeEverywhere = [];

// Check start() method for worker vs coordinator wiring
const startMethodIndex = maxJs.indexOf('start(');
const startMethodCode = maxJs.slice(startMethodIndex, startMethodIndex + 4000);

for (const sub of instantiated) {
    if (startMethodCode.includes(`this.${sub}.start`) || startMethodCode.includes(`this.${sub}.initialize`)) {
        activeEverywhere.push(sub);
    } else {
        dormantInWorker.push(sub);
    }
}

console.log(`Total subsystems instantiated in MAX.js: ${instantiated.length}`);
console.log(`Explicitly started background loops in start(): ${activeEverywhere.length} (${activeEverywhere.join(', ')})`);
console.log(`On-demand / Dormant until explicitly invoked: ${dormantInWorker.length} (${dormantInWorker.slice(0, 10).join(', ')}...)`);

// ── 3. LAN & WEBSOCKET MESSAGE BROKER BRIDGE AUDIT ────────────────────────
console.log('\n─── 3. SOMA-MAX Network Bridge ───');
const bridgeFile = path.join(MAX_ROOT, 'tools', 'SomaBridge.js');
let bridgeStatus = 'UNKNOWN';
if (fs.existsSync(bridgeFile)) {
    const bridgeContent = fs.readFileSync(bridgeFile, 'utf8');
    bridgeStatus = bridgeContent.includes('ws://') ? 'CONFIGURED (WebSocket)' : 'HTTP ONLY';
}
console.log(`MAX SomaBridge status: ${bridgeStatus}`);

const auditSummary = {
    timestamp: new Date().toISOString(),
    soma: {
        totalArbiters: arbiterFiles.length,
        wiredArbiters: connectedArbiters.length,
        dormantArbiters: orphanedArbiters.length,
        dormantSample: orphanedArbiters.slice(0, 15)
    },
    max: {
        totalSubsystems: instantiated.length,
        activeLoops: activeEverywhere,
        dormantSubsystems: dormantInWorker
    }
};

fs.mkdirSync(path.join(MAX_ROOT, '.max', 'research'), { recursive: true });
fs.writeFileSync(path.join(MAX_ROOT, '.max', 'research', 'DISCONNECTED_SYSTEMS_AUDIT.json'), JSON.stringify(auditSummary, null, 2), 'utf8');
console.log('\n✅ Audit Complete! Results saved to .max/research/DISCONNECTED_SYSTEMS_AUDIT.json');
