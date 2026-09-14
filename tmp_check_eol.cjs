const fs = require('fs');
const b = fs.readFileSync('core/Scheduler.js');
let crlf = 0, lf = 0;
for (let i = 0; i < b.length; i++) {
  if (b[i] === 10) { if (b[i-1] === 13) crlf++; else lf++; }
}
console.log('CRLF:', crlf, 'bare LF:', lf);
