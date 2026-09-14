const fs = require('fs');
function walk(d) {
  let out = [];
  try {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = d + '/' + f.name;
      if (f.isDirectory()) {
        if (f.name !== 'node_modules' && f.name !== '.git') out = out.concat(walk(fp));
      } else if (f.name.endsWith('.test.js')) {
        out.push(fp);
      }
    }
  } catch (e) {}
  return out;
}
console.log('TEST FILES:');
console.log(walk('test').join('\n'));
console.log('---');
try { console.log('test/shims:', fs.readdirSync('test/shims').join(', ')); } catch (e) { console.log('no shims dir'); }
