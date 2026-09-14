const fs=require('fs');
const file=process.argv[2];
const start=parseInt(process.argv[3],10);
const end=parseInt(process.argv[4],10);
const l=fs.readFileSync(file,'utf8').split('\n');
console.log(l.slice(start,end).map((line,i)=>(i+start)+': '+line).join('\n'));
