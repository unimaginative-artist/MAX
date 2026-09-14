import fs from 'fs';
import path from 'path';

const file = 'C:/Users/barry/Desktop/SOMA/server/loaders/websocket.js';
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

// Collect declared names: imports, function params, const/let/var, function decls, class, catch, destructuring
const declared = new Set([
  // globals / node builtins / keywords
  'global','process','console','require','module','exports','Promise','JSON','Math','Date','Object','Array','Set','Map','String','Number','Boolean','Error','Buffer','setTimeout','setInterval','clearTimeout','clearInterval','parseInt','parseFloat','isNaN','URL','URLSearchParams','RegExp','Symbol','WeakMap','WeakSet','Proxy','Reflect','Infinity','NaN','undefined','null','true','false','this','arguments','await','async','of','in','new','typeof','instanceof','void','delete','return','if','else','for','while','do','switch','case','break','continue','try','catch','finally','throw','function','class','extends','super','import','export','default','const','let','var','yield','static','get','set','from','as'
]);

function collectFromLine(ln) {
  let m;
  // imports
  const imp = /import\s*\{([^}]*)\}/g;
  while ((m = imp.exec(ln))) m[1].split(',').forEach(p => { const n = p.trim().split(/\s+as\s+/).pop().trim(); if (n) declared.add(n); });
  const impd = /import\s+(\w+)\s+from/g;
  while ((m = impd.exec(ln))) declared.add(m[1]);
  const impns = /import\s+\*\s+as\s+(\w+)/g;
  while ((m = impns.exec(ln))) declared.add(m[1]);
  // require(...) assigned
  const req = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = req.exec(ln))) declared.add(m[1]);
  // const { a, b } = ...
  const dstru = /(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((m = dstru.exec(ln))) m[1].split(',').forEach(p => { const n = p.split(':').pop().trim().replace(/=.*/, '').trim(); if (n) declared.add(n); });
  // const [ a, b ] = ...
  const dstarr = /(?:const|let|var)\s*\[([^\]]*)\]\s*=/g;
  while ((m = dstarr.exec(ln))) m[1].split(',').forEach(p => { const n = p.trim(); if (n) declared.add(n); });
  // function decl
  const fn = /function\s+(\w+)/g;
  while ((m = fn.exec(ln))) declared.add(m[1]);
  // class
  const cl = /class\s+(\w+)/g;
  while ((m = cl.exec(ln))) declared.add(m[1]);
  // arrow / function params
  const fp = /\(([^)]*)\)\s*=>/g;
  while ((m = fp.exec(ln))) m[1].split(',').forEach(p => { const n = p.split(':')[0].split(/\s*=\s*/)[0].replace(/[.\[].*/, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n); });
  // method/function params in function(...)
  const fp2 = /function\s*\w*\s*\(([^)]*)\)/g;
  while ((m = fp2.exec(ln))) m[1].split(',').forEach(p => { const n = p.split(':')[0].split(/\s*=\s*/)[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n); });
  // single arrow param: x => 
  const fp3 = /(?:^|[\s,(])([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = fp3.exec(ln))) declared.add(m[1]);
  // catch (e)
  const ce = /catch\s*\(([^)]*)\)/g;
  while ((m = ce.exec(ln))) m[1].split(',').forEach(p => { const n = p.trim(); if (n) declared.add(n); });
}

// Two-pass: collect all declarations first
for (const ln of lines) collectFromLine(ln);

// Now find identifiers used
const used = new Map(); // name -> first line no
lines.forEach((ln, i) => {
  // strip strings and comments to reduce noise
  const stripped = ln
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/`(\\.|[^`\\])*`/g, '``')
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '');
  const ids = stripped.match(/[A-Za-z_$][\w$]*/g) || [];
  for (const id of ids) {
    // skip if preceded by a dot (property access)
    const idx = stripped.indexOf(id);
    if (!used.has(id)) used.set(id, i + 1);
  }
});

console.log('=== Candidate undefined identifiers (used but never declared) ===');
const suspicious = [];
for (const [id, ln] of used) {
  if (declared.has(id)) continue;
  // skip property accesses: check if id appears only after a dot in the file
  const re = new RegExp('([.])' + id.replace(/\$/g, '\\$') + '\\b', 'g');
  const dotCount = (src.match(re) || []).length;
  const bareRe = new RegExp('(?<![.\\w$])' + id.replace(/\$/g, '\\$') + '\\b', 'g');
  const bareCount = (src.match(bareRe) || []).length;
  if (bareCount > 0) suspicious.push({ id, ln, dotCount, bareCount });
}
suspicious.sort((a, b) => b.bareCount - a.bareCount);
for (const s of suspicious) console.log(`  line ${s.ln}: ${s.id}  (bare=${s.bareCount}, dotted=${s.dotCount})`);
if (!suspicious.length) console.log('  (none)');
