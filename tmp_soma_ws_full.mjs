import fs from 'fs';
import path from 'path';

const f = 'C:/Users/barry/Desktop/SOMA/server/loaders/websocket.js';
const src = fs.readFileSync(f, 'utf8');
const lines = src.split(/\r?\n/);
console.log('TOTAL LINES:', lines.length);
console.log('=== lines 168-end ===');
for (let i = 167; i < lines.length; i++) console.log(`${i + 1}: ${lines[i]}`);
