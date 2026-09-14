const fs = require('fs');
const lines = fs.readFileSync('core/AgentLoop.js', 'utf8').split(/\r?\n/);
function show(start, end) {
  console.log(`\n===== lines ${start}-${end} =====`);
  for (let i = start - 1; i < end && i < lines.length; i++) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}
show(654, 760);
show(1073, 1140);
show(1550, 1577);
