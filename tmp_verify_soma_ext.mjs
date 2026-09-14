import fs from 'fs';
import path from 'path';

const SOMA = 'C:/Users/barry/Desktop/SOMA';
const LOADER = path.join(SOMA, 'server', 'loaders', 'extended.js');
const src = fs.readFileSync(LOADER, 'utf8');

const staticRe = /import\s+(?:[^'\"]*?from\s+)?['\"]([^'\"]+)['\"]/g;
const dynRe = /(?:import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)|require\s*\(\s*['\"]([^'\"]+)['\"]\s*\))/g;

const specs = new Map();
let m;
while ((m = staticRe.exec(src))) specs.set(m[1], 'static');
while ((m = dynRe.exec(src))) specs.set(m[1] || m[2], 'dynamic');

console.log('=== Import specifiers in extended.js ===');
let broken = 0;
for (const [spec, kind] of specs) {
  if (!spec.startsWith('.')) { console.log('[bare ] ' + spec + '  (' + kind + ')'); continue; }
  const resolved = path.resolve(path.dirname(LOADER), spec);
  const ok = fs.existsSync(resolved);
  if (!ok) broken++;
  console.log((ok ? '[ OK  ] ' : '[MISS ] ') + spec + '  (' + kind + ')' + (ok ? '' : '  MISSING: ' + resolved));
}
console.log('=== ' + broken + ' broken relative specifier(s) ===');
