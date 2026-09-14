import fs from 'fs';
import path from 'path';

const SOMA_ROOT = 'C:/Users/barry/Desktop/SOMA';
const ld = path.join(SOMA_ROOT, 'server', 'loaders');

console.log('SOMA_ROOT exists:', fs.existsSync(SOMA_ROOT));
console.log('server/loaders exists:', fs.existsSync(ld));

if (fs.existsSync(ld)) {
  const files = fs.readdirSync(ld);
  console.log('\nloaders contents:\n  ' + files.join('\n  '));

  const wsFile = path.join(ld, 'websocket.js');
  console.log('\nwebsocket.js exists:', fs.existsSync(wsFile));
  if (fs.existsSync(wsFile)) {
    const src = fs.readFileSync(wsFile, 'utf8');
    console.log('\n=== websocket.js (' + src.length + ' bytes) ===');
    src.split(/\r?\n/).forEach((ln, i) => console.log(`${i + 1}: ${ln}`));
  }

  // Also scan all loaders for anything websocket-ish
  console.log('\n=== files under loaders mentioning ws/websocket ===');
  for (const f of files) {
    if (!f.endsWith('.js') && !f.endsWith('.cjs')) continue;
    const p = path.join(ld, f);
    const s = fs.readFileSync(p, 'utf8');
    if (/websocket|WebSocket|\bws\b/i.test(s)) {
      console.log(`  ${f} (${s.length} bytes)`);
    }
  }
}
