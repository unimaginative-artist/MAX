import fs from 'fs';

const hits = [];
function walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = dir + '/' + e.name;
    if (e.isDirectory()) walk(full);
    else if (/vite/i.test(e.name)) hits.push(full);
  }
}
walk('.');

console.log('VITE_NAMED_FILES:', JSON.stringify(hits, null, 2));
console.log('HAS_frontend_DIR:', fs.existsSync('frontend'));
console.log('HAS_.max_DIR:', fs.existsSync('.max'));
if (fs.existsSync('.max')) console.log('MAX_CONTENTS:', fs.readdirSync('.max').join(', '));

// grep source text for the string 'vite' outside node_modules
const textHits = [];
const exts = ['.js', '.ts', '.mjs', '.cjs', '.json', '.html', '.md'];
function walkText(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = dir + '/' + e.name;
    if (e.isDirectory()) { walkText(full); continue; }
    if (!exts.some(x => e.name.endsWith(x))) continue;
    try {
      const c = fs.readFileSync(full, 'utf8');
      if (c.includes('vite')) textHits.push(full);
    } catch {}
  }
}
walkText('.');
console.log('FILES_CONTAINING_vite:', JSON.stringify(textHits, null, 2));
