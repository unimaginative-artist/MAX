import fs from 'fs';

const roots = [
  'C:/Users/barry/Desktop/SOMA',
  'C:/Users/barry/Desktop/MAX',
  process.cwd()
];

const hits = [];
const SKIP = /node_modules|\.git$|\.next|dist$|build$/i;

function walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) {
      if (!SKIP.test(e.name)) walk(p, depth + 1);
    } else if (/AutoHeal|OptimizationDaemon|somaBackend/i.test(e.name)) {
      hits.push(p);
    }
  }
}

for (const r of roots) walk(r);

console.log('--- name hits ---');
console.log(hits.join('\n') || '(none)');

// Also grep file contents for AutoHealDaemon references
const refs = [];
function scan(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) {
      if (!SKIP.test(e.name)) scan(p, depth + 1);
    } else if (/\.(js|cjs|mjs|json|md)$/i.test(e.name)) {
      try {
        const txt = fs.readFileSync(p, 'utf8');
        if (txt.includes('AutoHealDaemon')) refs.push(p);
      } catch {}
    }
  }
}
for (const r of roots) scan(r);
console.log('--- content refs ---');
console.log([...new Set(refs)].join('\n') || '(none)');
