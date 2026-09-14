import fs from 'fs';
import path from 'path';

const ROOT = 'C:/Users/barry/Desktop/SOMA';
const FILE = path.join(ROOT, 'server/loaders/routes.js');
const txt = fs.readFileSync(FILE, 'utf8');

const re = /^\s*import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/gm;
let m;
let broken = 0;
const total = { n: 0 };
while ((m = re.exec(txt))) {
  const spec = m[2];
  total.n++;
  if (!spec.startsWith('.')) continue;
  const resolved = path.resolve(path.dirname(FILE), spec);
  const exists = fs.existsSync(resolved);
  if (!exists) {
    broken++;
    console.log(`BROKEN  ${spec}  ->  ${resolved}  (imported: ${m[1].trim()})`);
  }
}
console.log(`\nTotal ESM imports: ${total.n}, broken relative imports: ${broken}`);
