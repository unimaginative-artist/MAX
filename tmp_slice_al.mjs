import fs from 'fs';
const src = fs.readFileSync('core/AgentLoop.js', 'utf8');
const lines = src.split(/\r?\n/);
const a = parseInt(process.argv[2], 10);
const b = parseInt(process.argv[3], 10);
for (let i = a - 1; i < b && i < lines.length; i++) {
    console.log(String(i + 1).padStart(4, ' ') + '| ' + lines[i]);
}
console.log('TOTAL LINES: ' + lines.length);
