import fs from 'fs';
const s = fs.readFileSync('core/AgentLoop.js','utf8').split(/\r?\n/);
console.log('TOTAL LINES', s.length);
const methods = [];
const imports = [];
s.forEach((l,i)=>{
  const m = l.match(/^\s{4}(async\s+)?([A-Za-z_]\w*)\s*\(/);
  if (m && m[2] !== 'if' && m[2] !== 'for' && m[2] !== 'while' && m[2] !== 'switch') methods.push((i+1)+' '+(m[1]||'')+m[2]);
  if (/^import /.test(l)) imports.push(l.trim());
});
console.log('\n--- IMPORTS ---');
imports.forEach(x=>console.log(x));
console.log('\n--- METHODS ---');
methods.forEach(x=>console.log(x));
