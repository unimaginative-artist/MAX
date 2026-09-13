import fs from 'fs';
import path from 'path';

function walk(d, dep) {
  if (dep > 4) return;
  let e = [];
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const x of e) {
    const fp = path.join(d, x.name);
    if (x.isDirectory()) {
      if (['node_modules', '.git', '.max', 'dist-electron'].includes(x.name)) continue;
      walk(fp, dep + 1);
    } else if (/\.test\.js$/.test(x.name)) {
      console.log(fp);
    }
  }
}
walk('.', 0);
console.log('---dirs---');
for (const d of ['test', 'test/unit', 'test/integration', 'test/shims', 'test/unit/core']) {
  try {
    const e = fs.readdirSync(d, { withFileTypes: true });
    console.log(d, '=>', e.map(x => (x.isDirectory() ? x.name + '/' : x.name)).join(', '));
  } catch (err) {
    console.log(d, '=> MISSING');
  }
}
