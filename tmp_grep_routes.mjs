import fs from 'fs';
import path from 'path';

const SKIP = new Set(['node_modules', '.git', '.max', 'dist', 'build', '.cache']);
const TERMS = ['server/loaders', 'loaders/routes', 'loaders.js', 'routes.js', "from 'server", 'from "server'];
const hits = {};
for (const t of TERMS) hits[t] = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(js|cjs|mjs|json|ts)$/.test(e.name)) continue;
    let txt;
    try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const lines = txt.split(/\r?\n/);
    for (const t of TERMS) {
      lines.forEach((ln, i) => {
        if (ln.includes(t)) hits[t].push(`${p}:${i + 1}: ${ln.trim().slice(0, 160)}`);
      });
    }
  }
}
walk('.');
for (const t of TERMS) {
  console.log(`\n=== "${t}" (${hits[t].length}) ===`);
  for (const h of hits[t].slice(0, 40)) console.log(h);
}
