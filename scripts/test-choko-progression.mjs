import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MAX } from '../core/MAX.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🎀 TESTING CHOKO REWARD & EVOLUTION LOOP');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const relayPath = path.join(__dirname, '..', '.max', 'choko_relay.json');
    const mockReports = [
        {
            from: 'Choko',
            title: 'Security smell: found exposed token in test runner',
            detail: 'Unsafe mock token in old script. Needs fix!',
            priority: 'high',
            timestamp: new Date().toISOString(),
            emoji: '🍫'
        },
        {
            from: 'Choko',
            title: 'Cluster patrol: SOMA Queen latency 6ms',
            detail: 'All systems sparkly nominal!',
            priority: 'medium',
            timestamp: new Date().toISOString(),
            emoji: '✨'
        }
    ];

    fs.writeFileSync(relayPath, JSON.stringify(mockReports, null, 2), 'utf8');
    console.log('[Test] 📝 Injected 2 field reports from Choko into .max/choko_relay.json');

    const max = new MAX();
    await max.initialize();

    console.log('\n[Test] 👑 MAX is processing Choko relay...');
    await max._processChokoRelay();

    // Check Choko progression
    const { Progression } = await import('../Choko/Progression.js');
    const prog = new Progression(path.join(__dirname, '..', 'Choko', '.max'));
    const status = prog.getStatus();

    console.log('\n🎉 Choko Status Post-Relay:');
    console.log('   Level:', status.level, `(${status.title})`);
    console.log('   XP:', `${status.xp} / ${status.xpToNextLevel}`);
    console.log('   Sparkles:', status.sparkles);
    console.log('   Unlocked Hats:', status.unlockedHats.join(', '));
    console.log('   Current Hat:', status.currentHat);

    const hazelnutPath = path.join(__dirname, '..', 'Choko', 'personas', 'Hazelnut.md');
    if (fs.existsSync(hazelnutPath)) {
        console.log('\n🌰 Hazelnut Hat was autonomously forged on disk:');
        console.log(fs.readFileSync(hazelnutPath, 'utf8').trim());
    }

    process.exit(0);
}

run().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
