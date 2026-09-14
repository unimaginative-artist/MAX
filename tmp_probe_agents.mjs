import fs from 'fs';
import path from 'path';

const root = process.cwd();
const dirHits = [];
const fileHits = [];
const loaderFiles = [];

function walk(d, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    const rel = path.relative(root, p);
    if (e.isDirectory()) {
      if (/loader/i.test(e.name)) dirHits.push(rel);
      walk(p, depth + 1);
    } else {
      if (/agents/i.test(e.name)) fileHits.push(rel);
      const parts = rel.split(path.sep);
      if (parts.some(x => /loader/i.test(x))) loaderFiles.push(rel);
    }
  }
}

walk(root, 0);
console.log('=== loader DIRS ===');
console.log(dirHits.join('\n') || 'NONE');
console.log('=== *agents* FILES ===');
console.log(fileHits.join('\n') || 'NONE');
console.log('=== files under any loader path ===');
console.log(loaderFiles.slice(0, 60).join('\n') || 'NONE');
