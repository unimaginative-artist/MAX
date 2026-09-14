import fs from 'fs';
import path from 'path';

const root = 'server';
console.log('server exists:', fs.existsSync(root));

function walk(dir, depth = 0) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      console.log('  '.repeat(depth) + '[D] ' + p);
      walk(p, depth + 1);
    } else {
      console.log('  '.repeat(depth) + '[F] ' + p);
    }
  }
}
walk(root);

console.log('\n--- Searching for websocket.js anywhere ---');
function find(dir, target, depth = 0) {
  if (!fs.existsSync(dir) || depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.venv') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) find(p, target, depth + 1);
    else if (e.name.toLowerCase().includes(target)) console.log('MATCH:', p);
  }
}
find('.', 'websocket');
