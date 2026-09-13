import fs from 'fs';

const files = [
  'C:/Users/barry/Desktop/SOMA/build_max_coder_dataset.mjs',
  'C:/Users/barry/Desktop/SOMA/core/MaintenanceBridge.js',
  'C:/Users/barry/Desktop/SOMA/core/MaxAgentBridge.js',
];

for (const p of files) {
  console.log('\n===== ' + p.replace('C:/Users/barry/Desktop/SOMA/', '') + ' =====');
  const L = fs.readFileSync(p, 'utf8').split('\n');
  const idx = [];
  L.forEach((l, i) => { if (l.includes('AgentLoop')) idx.push(i); });
  for (const i of idx) {
    const a = Math.max(0, i - 5), b = Math.min(L.length - 1, i + 5);
    console.log('  --- line ' + (i + 1) + ' ---');
    for (let j = a; j <= b; j++) {
      console.log(String(j + 1).padStart(5) + '  ' + L[j]);
    }
  }
}
