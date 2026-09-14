import fs from 'fs';

const sb = fs.readFileSync('core/SomaBridge.js', 'utf8').split(/\r?\n/);
console.log('=== SomaBridge.js lines 525-560 ===');
for (let i = 524; i < 560 && i < sb.length; i++) console.log(`${i + 1}: ${sb[i]}`);

console.log('\n=== VerifiedKnowledge.js lines 1-40 ===');
const vk = fs.readFileSync('core/VerifiedKnowledge.js', 'utf8').split(/\r?\n/);
for (let i = 0; i < 40 && i < vk.length; i++) console.log(`${i + 1}: ${vk[i]}`);

console.log('\n=== Does server/loaders exist? ===');
console.log('server/loaders exists:', fs.existsSync('server/loaders'));
console.log('server/loaders/routes.js exists:', fs.existsSync('server/loaders/routes.js'));

console.log('\n=== Any file under server/ ===');
function walk(dir, depth = 0) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    console.log(' '.repeat(depth * 2) + p);
    if (e.isDirectory()) walk(p, depth + 1);
  }
}
walk('server');
