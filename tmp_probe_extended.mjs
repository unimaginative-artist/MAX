import fs from 'fs';
import path from 'path';

const SOMA = 'C:/Users/barry/Desktop/SOMA';
console.log('SOMA exists:', fs.existsSync(SOMA));
if (!fs.existsSync(SOMA)) process.exit(0);

const srv = path.join(SOMA, 'server');
console.log('server exists:', fs.existsSync(srv));
if (fs.existsSync(srv)) {
  console.log('server/:', fs.readdirSync(srv).join(', '));
}

const loaders = path.join(SOMA, 'server', 'loaders');
console.log('\nloaders dir exists:', fs.existsSync(loaders));
if (fs.existsSync(loaders)) {
  console.log('loaders/:', fs.readdirSync(loaders).join(', '));
}

const ext = path.join(loaders, 'extended.js');
console.log('\nextended.js exists:', fs.existsSync(ext));
if (fs.existsSync(ext)) {
  const st = fs.statSync(ext);
  console.log('  size:', st.size, 'bytes');
}

// search for loaders/extended.js anywhere under SOMA
function walk(d, depth = 0) {
  if (depth > 6) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (e.name === 'extended.js') console.log('  FOUND:', p);
  }
}
console.log('\n=== all extended.js under SOMA ===');
walk(SOMA);
