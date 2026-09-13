import fs from 'fs';
import path from 'path';

const MAX_ROOT = 'C:/Users/barry/Desktop/MAX';
const SOMA_ROOT = 'C:/Users/barry/Desktop/SOMA';

function checkImports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m, ok = 0, bad = [];
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), spec);
    const candidates = [resolved, resolved + '.js', resolved + '.cjs', resolved + '.mjs', path.join(resolved, 'index.js')];
    if (candidates.some(c => fs.existsSync(c))) ok++;
    else bad.push(spec);
  }
  return { ok, bad };
}

function walk(dir, predicate, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === '.max') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, predicate, acc);
    else if (predicate(e.name)) acc.push(full);
  }
  return acc;
}

console.log('=== 1. MAX core/AgentLoop.js import graph ===');
const maxImports = checkImports(path.join(MAX_ROOT, 'core/AgentLoop.js'));
console.log('resolved:', maxImports.ok, '| missing:', JSON.stringify(maxImports.bad));

console.log('');
console.log('=== 2. SOMA files referencing AgentLoop ===');
const somaFiles = walk(SOMA_ROOT, n => /\.(js|cjs|mjs)$/.test(n));
const somaHits = somaFiles.filter(f => fs.readFileSync(f, 'utf8').includes('AgentLoop'));
console.log('scanned:', somaFiles.length, '| hits:', somaHits.length);
somaHits.forEach(f => console.log('  ', f));

console.log('');
console.log('=== 3. MAX files importing AgentLoop ===');
const maxFiles = walk(MAX_ROOT, n => /\.(js|cjs|mjs)$/.test(n));
const maxHits = maxFiles.filter(f => !f.includes('verify_agentloop') && /AgentLoop/.test(fs.readFileSync(f, 'utf8')));
console.log('scanned:', maxFiles.length, '| hits:', maxHits.length);
maxHits.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(x => x.l.includes('AgentLoop')).slice(0, 3);
  lines.forEach(x => console.log('  ', path.relative(MAX_ROOT, f) + ':' + x.i, x.l.trim()));
});

console.log('');
console.log('=== 4. Does SOMA have core/AgentLoop.js? ===');
console.log(fs.existsSync(path.join(SOMA_ROOT, 'core/AgentLoop.js')));
