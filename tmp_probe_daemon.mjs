import fs from 'fs';
import path from 'path';

const hits = [];
function walk(dir, depth) {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/daemon|optim/i.test(ent.name)) hits.push('DIR: ' + full);
      walk(full, depth + 1);
    } else if (/daemon|optim/i.test(ent.name)) {
      hits.push('FILE: ' + full);
    }
  }
}
walk('.', 0);
console.log(hits.join('\n') || 'no matches');
console.log('--- top level dirs ---');
try {
  console.log(fs.readdirSync('.', { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).join('\n'));
} catch (e) { console.log(e.message); }
