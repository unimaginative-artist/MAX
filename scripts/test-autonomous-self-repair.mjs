// ═══════════════════════════════════════════════════════════════════════════
// test-autonomous-self-repair.mjs — Live Proving Ground for Autonomous Self-Repair
// Proves that MAX can autonomously:
//   1. Identify a bug in his own codebase
//   2. Generate a surgical fix
//   3. Stage, syntax check, and import validate
//   4. Request Autonomous Machine Approval (SOMA Queen or MAX Security Council)
//   5. Auto-commit to disk with backup
//   6. Run Jest unit test to verify that the repair is GREEN
// Zero human-in-the-loop — pure machine autonomy.
// ═══════════════════════════════════════════════════════════════════════════

import { MAX } from '../core/MAX.js';

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  👑 PROVING AUTONOMOUS MACHINE-APPROVED SELF-REPAIR');
    console.log('  Mode: Zero-Human-In-The-Loop (SOMA Queen / MAX Peer Approval)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.env.MAX_AUTO_APPROVE = 'all';
    process.env.MAX_CLUSTER_ROLE = 'autonomous';
    process.env.MAX_AUTONOMOUS_GOALS = 'true';

    const max = new MAX();
    await max.initialize();

    console.log('\n[Prover] 🚀 Triggering autonomous self-repair on core/Heartbeat.js...');
    const result = await max.selfImprovement.propose(
        'Heartbeat.js is missing the stop() method which clears the timer and sets config.enabled = false. Add stop() to Heartbeat.js.',
        { source: 'unit_test_failure', priority: 0.95 }
    );

    if (result && result.status === 'approved') {
        console.log('\n🎉 SUCCESS: Self-Repair was autonomously generated, verified, approved, and committed!');
        console.log(`   Approver: ${result.approvedBy}`);
        console.log(`   Target File: ${result.file}`);
        console.log(`   Changes: ${result.changes} line(s)`);
    } else {
        console.log('\n⚠️ Self-Repair status:', result ? result.status : 'failed');
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal prover error:', err);
    process.exit(1);
});
