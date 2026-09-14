import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SOMA_ROOT = 'C:/Users/barry/Desktop/SOMA';

console.log('=== SOMA external target ===');
console.log('SOMA_ROOT exists:', fs.existsSync(SOMA_ROOT));
const ld = path.join(SOMA_ROOT, 'server', 'loaders');
console.log('SOMA server/loaders exists:', fs.existsSync(ld));
console.log('SOMA server/loaders/agents.js exists:', fs.existsSync(path.join(ld, 'agents.js')));
if (fs.existsSync(ld)) {
  console.log('loaders contents:', fs.readdirSync(ld).join(', '));
}

console.log('\n=== Verify flagged broken imports (real vs artifact) ===');
const checks = [
  ['tools/Tool.js', 'core/MAX.js imports ../../tools/Tool.js'],
  ['tools/ProactiveCouncil.js', 'tools/FileTools.js imports ./ProactiveCouncil.js'],
  ['test/unit/core/Brain.js', 'test imports ./Brain.js'],
  ['core/Brain.js', 'actual Brain.js location'],
  ['tools/Tool.js', 'exact tool file'],
];
for (const [rel, note] of checks) {
  const p = path.join(ROOT, rel);
  console.log(`${fs.existsSync(p) ? 'EXISTS  ' : 'MISSING '} ${rel}   (${note})`);
}

console.log('\n=== Actual import line in core/MAX.js referencing Tool.js ===');
const maxjs = fs.readFileSync(path.join(ROOT, 'core', 'MAX.js'), 'utf8').split(/\r?\n/);
maxjs.forEach((ln, i) => {
  if (/tools\/Tool\.js/.test(ln)) console.log(`  MAX.js:${i + 1}: ${ln.trim()}`);
});

console.log('\n=== Actual import line in tools/FileTools.js referencing ProactiveCouncil ===');
const ft = fs.readFileSync(path.join(ROOT, 'tools', 'FileTools.js'), 'utf8').split(/\r?\n/);
ft.forEach((ln, i) => {
  if (/ProactiveCouncil/.test(ln)) console.log(`  FileTools.js:${i + 1}: ${ln.trim()}`);
});

console.log('\n=== Brain.js locations in repo ===');
function findBrain(d, depth = 0) {
  if (depth > 6) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.max') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) findBrain(p, depth + 1);
    else if (e.name === 'Brain.js') console.log('  ' + path.relative(ROOT, p));
  }
}
findBrain(ROOT);

console.log('\n=== All Tool.js / ProactiveCouncil.js files ===');
function findByName(d, names, depth = 0) {
  if (depth > 6) return;
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) findByName(p, names, depth + 1);
    else if (names.includes(e.name)) console.log('  ' + path.relative(ROOT, p));
  }
}
findByName(ROOT, ['Tool.js', 'ProactiveCouncil.js']);
