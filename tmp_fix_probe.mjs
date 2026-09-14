import fs from 'fs';
import path from 'path';

const checks = [
  ['core/MAX.js', "../../tools/Tool.js"],
  ['memory/CodeIndexer.js', './y'],
  ['tools/FileTools.js', './ProactiveCouncil.js'],
  ['core/EvolutionArbiter.js', 'path.basename'],
  ['test/unit/core/ExecutiveCoderSupervisor.test.js', './Brain.js'],
];

for (const [file, needle] of checks) {
  console.log('\n===== ' + file + ' (looking for: ' + needle + ') =====');
  if (!fs.existsSync(file)) { console.log('  FILE MISSING'); continue; }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (ln.includes(needle)) console.log('  ' + (i + 1) + ': ' + ln.trim());
  });
}

console.log('\n===== Does ../tools/Tool.js exist? =====');
console.log('  ../tools/Tool.js from core =', fs.existsSync(path.join('core', '..', 'tools', 'Tool.js')));
console.log('  tools/Tool.js =', fs.existsSync('tools/Tool.js'));
console.log('  tools/ProactiveCouncil.js =', fs.existsSync('tools/ProactiveCouncil.js'));
console.log('  core/ProactiveCouncil.js =', fs.existsSync('core/ProactiveCouncil.js'));
console.log('  test/unit/core/Brain.js =', fs.existsSync('test/unit/core/Brain.js'));
console.log('  core/Brain.js =', fs.existsSync('core/Brain.js'));
