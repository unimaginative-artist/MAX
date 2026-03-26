import { fileURLToPath } from 'url';
import path from 'path';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('__dirname:', __dirname);
console.log('dataDir:', path.join(__dirname, '.max'));
