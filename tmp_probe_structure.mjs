import fs from 'fs';

function show(dir) {
  if (!fs.existsSync(dir)) { console.log(dir + ' :: MISSING'); return; }
  console.log('=== ' + dir + ' ===');
  const d = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of d) {
    console.log((e.isDirectory() ? '[D] ' : '[F] ') + e.name);
  }
}

show('core');
show('tools');
show('core/loops');
show('memory');

console.log('\n=== Files matching task/exec/engine in core ===');
for (const f of fs.readdirSync('core')) {
  if (/task|exec|engine/i.test(f)) console.log(f);
}
