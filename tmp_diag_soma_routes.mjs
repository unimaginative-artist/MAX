import fs from 'fs';
import path from 'path';

const ROOT = 'C:/Users/barry/Desktop/SOMA';
const FILE = path.join(ROOT, 'server/loaders/routes.js');
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);
console.log('TOTAL LINES:', lines.length);

console.log('\n=== ESM imports ===');
const imports = [];
const re = /^\s*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/gm;
let m;
while ((m = re.exec(src))) {
  imports.push({ clause: m[1].trim(), spec: m[2] });
  console.log(`${m[1].trim()}  <-  ${m[2]}`);
}

console.log('\n=== exports (line-level) ===');
lines.forEach((l, i) => {
  if (/^\s*export\s/.test(l)) console.log(`${i + 1}: ${l.trim()}`);
});

console.log('\n=== require() calls ===');
lines.forEach((l, i) => {
  const r = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let mm;
  while ((mm = r.exec(l))) console.log(`${i + 1}: ${mm[1]}`);
});

console.log('\n=== Resolve relative imports + check named/default exports on disk ===');
for (const imp of imports) {
  if (!imp.spec.startsWith('.')) continue;
  const resolved = path.resolve(path.dirname(FILE), imp.spec);
  let target = resolved;
  if (!fs.existsSync(target) && fs.existsSync(resolved + '.js')) target = resolved + '.js';
  if (!fs.existsSync(target) && fs.existsSync(resolved + '.cjs')) target = resolved + '.cjs';
  const ok = fs.existsSync(target);
  let names = [];
  let hasDefault = false;
  if (ok && /\.(js|cjs|mjs)$/.test(target)) {
    try {
      const t = fs.readFileSync(target, 'utf8');
      hasDefault = /export\s+default/.test(t) || /module\.exports\s*=/.test(t);
      names = [...t.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)].map(x => x[1]);
      names = names.concat([...t.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(x => x[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop())));
      names = names.concat([...t.matchAll(/exports\.(\w+)\s*=/g)].map(x => x[1]));
    } catch {}
  }
  console.log(`${ok ? 'OK   ' : 'MISS '} ${imp.spec}  ->  ${target}`);
  if (ok) console.log(`        default=${hasDefault} named=[${[...new Set(names)].join(', ')}]`);
  console.log(`        clause: ${imp.clause}`);
}
