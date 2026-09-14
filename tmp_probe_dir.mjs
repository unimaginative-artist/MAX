import fs from 'fs';
for (const d of ['server', 'server/loaders']) {
  try {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    console.log(`\n[${d}] (${entries.length} entries)`);
    for (const e of entries) console.log('  ', e.isDirectory() ? 'DIR ' : 'FILE', e.name);
  } catch (err) {
    console.log(`\n[${d}] NOT FOUND: ${err.code}`);
  }
}
console.log('\nexists server/loaders/agents.js:', fs.existsSync('server/loaders/agents.js'));
