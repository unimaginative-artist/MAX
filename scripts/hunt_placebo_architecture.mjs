// ═══════════════════════════════════════════════════════════════════════════
// hunt_placebo_architecture.mjs — Forensic Scanner for Mock & Placeholder Code
// Detects fake simulations, mock engines, placeholder stubs, and empty wrappers.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const SOMA_ROOT = 'C:\\Users\\barry\\Desktop\\SOMA';
const MAX_ROOT = 'C:\\Users\\barry\\Desktop\\MAX';

const SCAN_DIRS = [
    { name: 'SOMA/arbiters', dir: path.join(SOMA_ROOT, 'arbiters') },
    { name: 'SOMA/core', dir: path.join(SOMA_ROOT, 'core') },
    { name: 'SOMA/daemons', dir: path.join(SOMA_ROOT, 'daemons') },
    { name: 'MAX/core', dir: path.join(MAX_ROOT, 'core') },
    { name: 'MAX/tools', dir: path.join(MAX_ROOT, 'tools') }
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🕵️ FORENSIC PLACEBO & MOCK ARCHITECTURE HUNT');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const suspects = [];

for (const target of SCAN_DIRS) {
    if (!fs.existsSync(target.dir)) continue;
    const files = fs.readdirSync(target.dir, { withFileTypes: true });

    for (const f of files) {
        if (!f.isFile() || (!f.name.endsWith('.js') && !f.name.endsWith('.cjs') && !f.name.endsWith('.mjs'))) continue;
        if (f.name.includes('.test.') || f.name.includes('_test')) continue; // Skip intentional unit test mocks

        const fullPath = path.join(target.dir, f.name);
        let content = '';
        try {
            content = fs.readFileSync(fullPath, 'utf8');
        } catch { continue; }

        const lines = content.split('\n');
        const loc = lines.length;

        // Flags
        const issues = [];

        // 1. Explicit placeholder/mock comments
        if (/(\/\/|\/\*)\s*(simulate|mock|placeholder|dummy|fake|not implemented yet|for now, return|stub)\b/i.test(content)) {
            const matches = content.match(/(\/\/|\/\*)[^\n]*(simulate|mock|placeholder|dummy|fake|not implemented yet|for now, return|stub)[^\n]*/gi) || [];
            issues.push({ type: 'MOCK_COMMENTS', detail: matches.slice(0, 3).map(m => m.trim()) });
        }

        // 2. Trivial stubs (< 30 LOC returning empty objects)
        if (loc < 35 && !content.includes('export default') && !content.includes('module.exports =')) {
            issues.push({ type: 'TRIVIAL_STUB', detail: `Only ${loc} lines` });
        }

        // 3. Fake random confidence / hardcoded metrics generator
        if (content.includes('Math.random()') && (/confidence\s*:\s*Math\.random/i.test(content) || /score\s*:\s*0\.9\d/i.test(content))) {
            issues.push({ type: 'FAKE_METRICS', detail: 'Generates pseudo-random confidence/scores' });
        }

        // 4. "Quantum", "Cosmic", "Transcendent" or fantasy buzzword logic
        if (/class\s+(Quantum|Cosmic|Transcendent|Omnipresent|Omniscient|Infinite)/i.test(content)) {
            issues.push({ type: 'FANTASY_BUZZWORD', detail: 'Sci-fi placebo naming' });
        }

        if (issues.length > 0) {
            suspects.push({
                scope: target.name,
                file: f.name,
                fullPath,
                loc,
                issues
            });
        }
    }
}

console.log(`Found ${suspects.length} potential mock/placeholder candidates:\n`);

for (const s of suspects) {
    console.log(`📍 [${s.scope}] ${s.file} (${s.loc} LOC)`);
    for (const iss of s.issues) {
        if (Array.isArray(iss.detail)) {
            console.log(`   ⚠️ ${iss.type}:`);
            iss.detail.forEach(d => console.log(`      "${d}"`));
        } else {
            console.log(`   ⚠️ ${iss.type}: ${iss.detail}`);
        }
    }
    console.log('');
}

fs.writeFileSync(
    path.join(MAX_ROOT, '.max', 'research', 'PLACEBO_SCAN_RESULTS.json'),
    JSON.stringify(suspects, null, 2),
    'utf8'
);
console.log('✅ Scan complete! Saved to .max/research/PLACEBO_SCAN_RESULTS.json');
