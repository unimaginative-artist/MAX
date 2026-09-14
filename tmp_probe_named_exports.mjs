import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const SOMA = 'C:/Users/barry/Desktop/SOMA';

const targets = [
  ['aperture/ApertureAutopilot.js', 'bootApertureAutopilot'],
  ['daemons/SomaNetworkSync.js', 'bootNetworkSync'],
  ['arbiters/WebTaskArbiter.js', 'bootWebTaskArbiter'],
];

for (const [rel, named] of targets) {
  const abs = path.join(SOMA, rel);
  console.log(`\n=== ${rel} ===`);
  if (!fs.existsSync(abs)) { console.log('  FILE MISSING'); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const hasNamed = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${named}\\b`).test(src)
                || new RegExp(`export\\s*\\{[^}]*\\b${named}\\b[^}]*\\}`).test(src);
  console.log(`  exports ${named}? ${hasNamed ? 'YES' : 'NO  <-- LINKER WILL THROW'}`);
  const names = new Set();
  let m;
  const r1 = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g;
  while ((m = r1.exec(src))) names.add(m[1]);
  const r2 = /export\s*\{([^}]+)\}/g;
  while ((m = r2.exec(src))) m[1].split(',').forEach(n => { const t = n.trim().split(/\s+as\s+/).pop().trim(); if (t) names.add(t); });
  console.log('  all named exports:', [...names].join(', ') || '(none / default-only)');
}

async function live() {
  console.log('\n=== LIVE IMPORT ATTEMPT ===');
  try {
    const mod = await import(pathToFileURL(path.join(SOMA, 'server', 'loaders', 'extended.js')).href);
    console.log('  IMPORT OK - exports:', Object.keys(mod).join(', '));
  } catch (e) {
    console.log('  IMPORT FAILED');
    console.log('  name:', e.name);
    console.log('  message:', e.message);
    console.log('  stack:', (e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
}
live();
