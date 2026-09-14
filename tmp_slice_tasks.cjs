const fs=require('fs');
const f=process.argv[2];const a=+process.argv[3];const b=+process.argv[4];
const lines=fs.readFileSync(f,'utf8').split(/\r?\n/);
for(let i=a;i<b&&i<lines.length;i++)console.log((i+1)+': '+lines[i]);
