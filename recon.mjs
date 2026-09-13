import fs from 'fs';
import path from 'path';

function walk(dir, depth = 0, maxDepth = 2) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (['node_modules', '.git', '.max'].includes(e)) continue;
    const full = path.join(dir, e);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      console.log('  '.repeat(depth) + '[DIR] ' + full);
      walk(full, depth + 1, maxDepth);
    } else if (e.endsWith('.js') || e.endsWith('.mjs')) {
      console.log('  '.repeat(depth) + full);
    }
  }
}
console.log('=== core ===');
walk('core', 0, 1);
console.log('=== memory ===');
walk('memory', 0, 1);
