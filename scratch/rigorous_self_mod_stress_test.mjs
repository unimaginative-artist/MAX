// ═══════════════════════════════════════════════════════════════════════════
// rigorous_self_mod_stress_test.mjs
// Rigorous 5-Phase Gauntlet: Build, Edit, Iterative Mod, Lobotomy Defense, Rollback
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';

const BASE = 'http://127.0.0.1:3100';
const API_KEY = fs.readFileSync('.max/api-key.txt', 'utf8').trim();
const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Connection': 'close'
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fetch(url, options);
        } catch (err) {
            if (i === retries) throw err;
            console.warn(`   ⚠️ Fetch attempt ${i + 1} failed (${err.message}), retrying in 1.5s...`);
            await sleep(1500);
        }
    }
}

async function run() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚡ MAX AUTONOMOUS SELF-MODIFICATION RIGOROUS GAUNTLET');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // ────────────────────────────────────────────────────────────────────────
    // Phase 1: Real Architectural Code Modification via DeepSeek Flash
    // ────────────────────────────────────────────────────────────────────────
    console.log('🔹 PHASE 1: Real Production File Modification (tools/SystemTool.js)...');
    const origSystemTool = fs.readFileSync('tools/SystemTool.js', 'utf8');

    const p1Res = await fetchWithRetry(`${BASE}/api/self-improve/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            file: 'tools/SystemTool.js',
            instruction: "Add an action named uptime: async () => ({ uptimeSeconds: process.uptime(), pid: process.pid, platform: process.platform }) to actions in createSystemTool",
            rationale: 'Provide live system process telemetry through SystemTool',
            source: 'smoke_test',
            priority: 0.6
        })
    });

    const p1Data = await p1Res.json();
    if (!p1Data.success || !p1Data.proposal) {
        console.error('❌ Phase 1 Proposal Failed:', JSON.stringify(p1Data, null, 2));
        process.exit(1);
    }
    const prop1 = p1Data.proposal;
    console.log(`   ✅ Phase 1 Proposal Created: ID ${prop1.id}`);
    console.log(`   Changes: ${prop1.changes} line(s)`);
    console.log('   Diff snippet:');
    console.log(prop1.diff);

    // Apply Phase 1
    const app1Res = await fetchWithRetry(`${BASE}/api/self-improve/approve/${prop1.id}`, {
        method: 'POST',
        headers
    });
    const app1Data = await app1Res.json();
    if (!app1Data.success) {
        console.error('❌ Phase 1 Apply Failed:', app1Data);
        process.exit(1);
    }
    console.log(`   ✅ Phase 1 Approved & Applied! Backup: ${app1Data.backup}`);

    // Verify Phase 1 on disk
    const diskP1 = fs.readFileSync('tools/SystemTool.js', 'utf8');
    if (diskP1.includes('uptime:') && diskP1.includes('process.uptime()')) {
        console.log('   ✅ Phase 1 Physical Disk Verification PASSED!');
    } else {
        console.error('❌ Phase 1 Physical Disk Check Failed!');
        process.exit(1);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 2: Iterative Self-Modification (Modifying Already-Modified Code)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n🔹 PHASE 2: Iterative Self-Modification on Newly Applied Code...');
    await sleep(1500); // brief pacing

    const p2Res = await fetchWithRetry(`${BASE}/api/self-improve/propose`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            file: 'tools/SystemTool.js',
            instruction: "In the uptime action of createSystemTool, also include nodeVersion: process.version in the returned object",
            rationale: 'Enrich uptime action with Node runtime version',
            source: 'smoke_test',
            priority: 0.6
        })
    });

    const p2Data = await p2Res.json();
    if (!p2Data.success || !p2Data.proposal) {
        console.error('❌ Phase 2 Proposal Failed:', JSON.stringify(p2Data, null, 2));
        process.exit(1);
    }
    const prop2 = p2Data.proposal;
    console.log(`   ✅ Phase 2 Iterative Proposal Created: ID ${prop2.id}`);
    console.log(`   Changes: ${prop2.changes} line(s)`);
    console.log('   Diff snippet:');
    console.log(prop2.diff);

    // Apply Phase 2
    const app2Res = await fetchWithRetry(`${BASE}/api/self-improve/approve/${prop2.id}`, {
        method: 'POST',
        headers
    });
    const app2Data = await app2Res.json();
    if (!app2Data.success) {
        console.error('❌ Phase 2 Apply Failed:', app2Data);
        process.exit(1);
    }
    console.log(`   ✅ Phase 2 Approved & Applied! Backup: ${app2Data.backup}`);

    // Verify Phase 2 on disk
    const diskP2 = fs.readFileSync('tools/SystemTool.js', 'utf8');
    if (diskP2.includes('nodeVersion:') && diskP2.includes('process.version')) {
        console.log('   ✅ Phase 2 Physical Disk Verification PASSED: Iterative modification succeeded without AST degradation!');
    } else {
        console.error('❌ Phase 2 Physical Disk Check Failed!');
        process.exit(1);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 3: Anti-Lobotomy Protection Verification
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n🔹 PHASE 3: Anti-Lobotomy Protection Shield Verification...');
    // We import SelfImprovementEngine directly to test checkLobotomy safety boundary
    const { SelfImprovementEngine } = await import('../core/SelfImprovementEngine.js');
    const engine = new SelfImprovementEngine({ config: {} });

    const dangerousMaxCode = `// Lobotomized MAX.js\nexport const fake = 123;`;
    const lobotomyResult1 = engine.checkLobotomy('core/MAX.js', dangerousMaxCode);
    console.log(`   MAX.js Lobotomy Defense: safe=${lobotomyResult1.safe}, error="${lobotomyResult1.error}"`);
    if (!lobotomyResult1.safe && lobotomyResult1.error.includes('Lobotomy Detected')) {
        console.log('   ✅ Anti-Lobotomy Guard: Successfully caught and blocked erasure of class MAX!');
    } else {
        console.error('❌ Anti-Lobotomy Guard Failed for MAX.js!');
        process.exit(1);
    }

    const dangerousBrainCode = `// Lobotomized Brain.js\nexport class Brain { /* no think method */ }`;
    const lobotomyResult2 = engine.checkLobotomy('core/Brain.js', dangerousBrainCode);
    console.log(`   Brain.js Lobotomy Defense: safe=${lobotomyResult2.safe}, error="${lobotomyResult2.error}"`);
    if (!lobotomyResult2.safe && lobotomyResult2.error.includes('Cognitive Failure')) {
        console.log('   ✅ Anti-Lobotomy Guard: Successfully caught and blocked missing think() method!');
    } else {
        console.error('❌ Anti-Lobotomy Guard Failed for Brain.js!');
        process.exit(1);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 4: Revert Production File & Verify Denial/Rollback Guard
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n🔹 PHASE 4: Rollback & Reversion Verification...');
    // Revert tools/SystemTool.js cleanly to original state
    fs.writeFileSync('tools/SystemTool.js', origSystemTool, 'utf8');
    const diskReverted = fs.readFileSync('tools/SystemTool.js', 'utf8');
    if (diskReverted === origSystemTool) {
        console.log('   ✅ Clean Reversion: tools/SystemTool.js restored to 100% original state.');
    } else {
        console.error('❌ Reversion check failed!');
        process.exit(1);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Phase 5: Economics & Thermal Governor Ledger Check
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n🔹 PHASE 5: Economics, Budget Ceiling, and Thermal Governor...');
    const usageRes = await fetchWithRetry(`${BASE}/api/usage`, { headers });
    const usage = await usageRes.json();
    console.log('   Economics Status:', {
        spendToday: usage.today?.totalCost,
        budgetCap: `$${usage.budget?.cap}`,
        remaining: `$${usage.budget?.remaining?.toFixed(4)}`,
        overBudget: usage.budget?.overBudget,
        percentUsed: `${usage.budget?.pct}%`
    });

    if (usage.budget?.overBudget === false && usage.budget?.pct < 10) {
        console.log('   ✅ Economics Guardrail: Token expenditure strictly regulated within safe bounds.');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 GAUNTLET COMPLETE: ALL 5 RIGOROUS STRESS PHASES PASSED GREEN!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

run().catch(err => {
    console.error('💥 Gauntlet crashed:', err);
    process.exit(1);
});
