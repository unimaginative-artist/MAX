import fs from 'fs';
const l = fs.readFileSync('core/AgentLoop.js','utf8').split(/\r?\n/);
const a = parseInt(process.argv[2],10), b = parseInt(process.argv[3],10);
for (let i=a-1;i<b && i<l.length;i++) console.log((i+1)+': '+l[i]);
