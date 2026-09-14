import fs from 'fs';
import path from 'path';

function walk(d, depth) {
  if (depth > 5) return;
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const f of entries) {
    if (f.name === 'node_modules' || f.name === '.git') continue;
    const fp = path.join(d, f.name);
    if (f.isDirectory()) {
      if (/loader/i.test(f.name)) console.log('DIR:', fp);
      walk(fp, depth + 1);
    } else if (/websocket|(^|\/)ws\.js$|\.ws\./i.test(f.name)) {
      console.log('FILE:', fp);
    }
  }
}

console.log('cwd:', process.cwd());
walk('.', 0);
console.log('--- server tree ---');
try {
  const walkTree = (d, depth = 0) => {
    if (depth > 3) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      if (f.name === 'node_modules') continue;
      console.log('  '.repeat(depth) + (f.isDirectory() ? '[D] ' : '    ') + f.name);
      if (f.isDirectory()) walkTree(path.join(d, f.name), depth + 1);
    }
  };
  walkTree('server');
} catch (e) { console.log('no server dir:', e.message); }
