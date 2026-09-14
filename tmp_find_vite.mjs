import fs from 'fs';
import path from 'path';

const hits = [];
function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); }
    else if (/vite/i.test(e.name)) { hits.push(full); }
  }
}
walk('.');
console.log('MATCHES:', hits.length);
for (const h of hits) console.log('  ', h);
console.log('HAS_FRONTEND_DIR:', fs.existsSync('frontend'));
console.log('CWD:', process.cwd());
