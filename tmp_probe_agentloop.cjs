const fs = require('fs');
const path = require('path');

// 1. List test tree
function walk(d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    if (f.name === 'node_modules') continue;
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
console.log('=== TEST TREE ===');
console.log(walk('test').join('\n'));

// 2. Extract method names from AgentLoop.js
const s = fs.readFileSync('core/AgentLoop.js', 'utf8');
console.log('\n=== AGENTLOOP METHODS ===');
const m = s.match(/^\s{4}(async\s+)?[A-Za-z_$][\w$]*\s*\(/gm) || [];
console.log(m.map(x => x.trim()).join('\n'));
console.log('\n=== FILE TOTAL LINES ===');
console.log(s.split('\n').length);
