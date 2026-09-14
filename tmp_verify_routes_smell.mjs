import fs from 'fs';
import path from 'path';

const skip = new Set(['node_modules', '.git', '.max', 'dist', 'build', '.cache']);
const loadersDirs = [];
const routeFiles  = [];
const importers   = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'loaders') loadersDirs.push(full);
      walk(full);
      continue;
    }
    if (!/\.(js|cjs|mjs|ts|json)$/.test(e.name)) continue;
    if (e.name === 'routes.js') routeFiles.push(full);
    let txt;
    try { txt = fs.readFileSync(full, 'utf8'); } catch { continue; }
    if (/loaders\/routes|server\/loaders/.test(txt)) {
      txt.split(/\r?\n/).forEach((ln, i) => {
        if (/loaders\/routes|server\/loaders/.test(ln)) importers.push(`${full}:${i + 1}: ${ln.trim().slice(0, 140)}`);
      });
    }
  }
}

walk('.');

console.log('=== Directories named "loaders" ===');
console.log(loadersDirs.length ? loadersDirs.join('\n') : '(none)');
console.log('\n=== Files named routes.js ===');
console.log(routeFiles.length ? routeFiles.join('\n') : '(none)');
console.log('\n=== Files whose text references loaders/routes or server/loaders ===');
for (const line of importers) console.log(line);
