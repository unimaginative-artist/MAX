import fs from 'fs';
function walk(d, depth) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return ['ERR ' + d + ' ' + e.message]; }
  for (const f of entries) {
    const fp = d + '/' + f.name;
    out.push(fp);
    if (f.isDirectory() && depth > 0) out = out.concat(walk(fp, depth - 1));
  }
  return out;
}
const tree = walk('test', 3);
console.log('TEST TREE (' + tree.length + ' entries):');
console.log(tree.join('\n'));
