import fs from 'fs';
const src = fs.readFileSync('./core/AgentLoop.js', 'utf8');
const lines = src.split(/\r?\n/);
const out = [];
lines.forEach((l, i) => {
  const m = l.match(/^\s{4}(async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/);
  if (m) out.push((i + 1) + ': ' + (m[1] || '') + m[2] + '(' + m[3] + ')');
  const getter = l.match(/^\s{4}get\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (getter) out.push((i + 1) + ': get ' + getter[1] + '()');
});
console.log('TOTAL LINES: ' + lines.length);
console.log(out.join('\n'));
