const fs=require('fs');
const l=fs.readFileSync('core/AgentLoop.js','utf8').split(/\r?\n/);
const [a,b]=process.argv.slice(2).map(Number);
for(let i=a-1;i<b&&i<l.length;i++){console.log((i+1)+': '+l[i]);}
