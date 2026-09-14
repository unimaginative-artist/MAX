// temp range reader
const fs = require('fs');
const [, , file, start, end] = process.argv;
const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
const s = Math.max(1, parseInt(start, 10) || 1);
const e = Math.min(lines.length, parseInt(end, 10) || lines.length);
for (let i = s; i <= e; i++) {
  console.log(String(i).padStart(5, ' ') + ': ' + lines[i - 1]);
}
