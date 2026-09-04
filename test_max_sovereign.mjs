// ═══════════════════════════════════════════════════════════════════════════
// test_max_sovereign.mjs — Verify MAX Local-First Execution & SOMA Bridge
// ═══════════════════════════════════════════════════════════════════════════

import { MAX } from './core/MAX.js';

async function testMaxLocal() {
    console.log('=== TESTING MAX LOCAL-FIRST INITIALIZATION & AGENTIC THINK ===');
    const max = new MAX();
    await max.initialize();
    console.log('\n✅ MAX successfully initialized in LOCAL_FIRST mode!');

    console.log('\n🤖 Sending Agentic Directive to MAX: "State your identity and explain how you communicate with SOMA over LAN."');
    const result = await max.think('State your identity and explain how you communicate with SOMA over LAN.');
    console.log('\n📝 MAX RESPONSE:\n' + (result.response || result.text || JSON.stringify(result)));
    process.exit(0);
}

testMaxLocal().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
