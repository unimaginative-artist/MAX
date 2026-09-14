import fs from 'fs';
const file = 'C:/Users/barry/Desktop/SOMA/server/loaders/websocket.js';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
console.log('TOTAL LINES:', lines.length);
for (let i = 490; i < lines.length; i++) console.log((i + 1) + ': ' + lines[i]);
