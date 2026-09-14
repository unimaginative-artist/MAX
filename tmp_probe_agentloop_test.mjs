import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (e) { return out; }
    for (const f of entries) {
        if (f === 'node_modules' || f === '.git') continue;
        const fp = path.join(dir, f);
        let st;
        try { st = fs.statSync(fp); } catch { continue; }
        if (st.isDirectory()) walk(fp, out);
        else if (/\.test\.js$/.test(f)) out.push(fp);
    }
    return out;
}

const tests = walk('test');
console.log('TEST FILES (' + tests.length + '):');
for (const t of tests) console.log('  ' + t);

console.log('\nTEST DIR TREE:');
function tree(dir, prefix = '') {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const f of entries) {
        const fp = path.join(dir, f);
        let st;
        try { st = fs.statSync(fp); } catch { continue; }
        if (st.isDirectory()) { console.log(prefix + f + '/'); tree(fp, prefix + '  '); }
        else console.log(prefix + f);
    }
}
try { tree('test'); } catch (e) { console.log('no test dir:', e.message); }
