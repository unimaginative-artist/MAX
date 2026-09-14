import fs from 'fs';
import path from 'path';

const SOMA = 'C:/Users/barry/Desktop/SOMA';
const LOADER = path.join(SOMA, 'server', 'loaders', 'extended.js');
const src = fs.readFileSync(LOADER, 'utf8');

// static imports
const staticRe = /import\s+(?:[^'\"]*?from\s+)?['\"]([^'\"]+)['\"]/g;
// dynamic imports + require()
const dynRe = /(?:import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)|require\s*\(\s*['\"]([^'\"]+)['\"]\s*\))/g;

const specs = new Set();
let m;
while ((m = staticRe.exec(src))) specs.add(m[1]);
while ((m = dynRe.exec(src))) specs.add(m[1] || m[2]);

console.log('=== Import specifiers found in extended.js ===\n');
let broken = 0;
for (const spec of specs) {
  if (!spec.startsWith('.')) {
    console.log(`[bare ] ${spec}`);
    continue;
  }
  const resolved = path.resolve(path.dirname(LOADER), spec);
  const ok = fs.existsSync(resolved);
  if (!ok) broken++;
  console.log(`${ok ? '[ OK  ]' : '[MISS ]'} ${spec}\n         -> ${resolved}`);
}

console.log(`\n=== ${broken} broken relative specifier(s) ===`);

// Compare against the .bak to spot what changed
const bak = path.join(SOMA, 'server', 'loaders', 'extended.js.bak');
if (fs.existsSync(bak)) {
  const b = fs.readFileSync(bak, 'utf8');
  const bspecs = new Set();
  const sre = /import\s+(?:[^'\"]*?from\s+)?['\"]([^'\"]+)['\"]/g;
  const dre = /(?:import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)|require\s*\(\s*['\"]([^'\"]+)['\"]\s*\))/g;
  let x; while ((x = sre.exec(b))) bspecs.add(x[1]);
  while ((x = dre.exec(b))) bspecs.add(x[1] || x[2]);
  console.log('\n=== Specs in .bak NOT in current ===');
  for (const s of bspecs) if (!specs.has(s)) console.log('  -', s);
  console.log('=== Specs in current NOT in .bak ===');
  for (const s of specs) if (!bspecs.has(s)) console.log('  +', s);
}
