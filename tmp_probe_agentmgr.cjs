const fs = require('fs');
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const fp = d + '/' + f;
    const st = fs.statSync(fp);
    if (st.isDirectory()) { if (f === 'node_modules') continue; walk(fp); }
    else if (f.endsWith('.test.js')) console.log(fp);
  }
}
try { walk('test'); } catch (e) { console.log('ERR', e.message); }
