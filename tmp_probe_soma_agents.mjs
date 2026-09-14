import fs from 'fs';
import path from 'path';

const SOMA = 'C:/Users/barry/Desktop/SOMA';

const targets = [
  'microagents/BlackAgent.cjs',
  'microagents/KuzeAgent.cjs',
  'arbiters/MicroAgentPool.js',
  'arbiters/_placebo_quarantine/MicroAgentPool.js',
  'microagents/MicroAgentPool.cjs',
];

console.log('=== Dependency existence checks ===');
for (const rel of targets) {
  const p = path.join(SOMA, rel);
  console.log((fs.existsSync(p) ? 'EXISTS  ' : 'MISSING ') + rel);
}

console.log('\n=== SOMA top-level dirs ===');
for (const e of fs.readdirSync(SOMA, { withFileTypes: true })) {
  if (e.isDirectory()) console.log('  DIR ', e.name);
}

function listDir(rel) {
  const d = path.join(SOMA, rel);
  console.log(`\n=== ${rel} ===`);
  if (!fs.existsSync(d)) { console.log('  NOT FOUND'); return; }
  for (const e of fs.readdirSync(d)) console.log('  ', e);
}

listDir('microagents');
listDir('arbiters');
