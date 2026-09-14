import fs from 'fs';
import path from 'path';
function walk(dir, depth) {
  if (depth > 3) return [];
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full, depth + 1));
    else if (/\.test\.(js|mjs|cjs)$/.test(e.name) || e.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}
console.log('EXISTS test dir: ' + fs.existsSync('./test'));
console.log('TESTS:\n' + walk('./', 0).join('\n'));
