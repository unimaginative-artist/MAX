import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const EXTS = new Set(['.js', '.cjs', '.mjs']);
const IGNORE = new Set(['node_modules', '.git', '.max', 'dist', 'build', '.next']);
const files = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXTS.has(path.extname(e.name))) files.push(p);
  }
}
walk(ROOT);

// 1. Find any file whose basename contains 'routes'
console.log('=== Files with "routes" in name ===');
for (const f of files) {
  if (path.basename(f).toLowerCase().includes('route')) {
    console.log('  ' + path.relative(ROOT, f));
  }
}

// 2. Resolve relative imports across all files
console.log('\n=== Broken relative imports ===');
const importRe = /(?:import|export)\s+(?:[^'"]*?from\s*)?['"](\.[^'"]+)['"]/g;
let broken = 0;
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const spec = m[1];
    const base = path.resolve(path.dirname(f), spec);
    const cands = [base, base + '.js', base + '.mjs', base + '.cjs', path.join(base, 'index.js')];
    if (!cands.some(c => fs.existsSync(c))) {
      console.log(`  BROKEN  ${path.relative(ROOT, f)}  ->  ${spec}`);
      broken++;
    }
  }
}
console.log(`\nTotal broken relative imports: ${broken}`);

// 3. Search all file contents for references to the phantom path
console.log('\n=== Content references to "loaders" / "server/loaders" ===');
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const lines = src.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (/loaders/.test(ln)) {
      console.log(`  ${path.relative(ROOT, f)}:${i + 1}: ${ln.trim()}`);
    }
  });
}

console.log(`\nTotal script files scanned: ${files.length}`);
