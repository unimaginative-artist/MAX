import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const base = 'C:/Users/barry/Desktop/SOMA/';
const file = base + 'server/loaders/websocket.js';

console.log('=== Import target existence ===');
const targets = [
  'core/Logger.js',
  'server/utils/systemState.js',
  'server/utils/commandRouter.js',
  'server/ApprovalSystem.cjs',
  'core/MessageBroker.cjs',
  'config/owner.json'
];
for (const t of targets) {
  console.log((fs.existsSync(base + t) ? 'EXISTS  ' : 'MISSING ') + t);
}

console.log('\n=== Relative import targets from file ===');
const dir = path.dirname(file);
for (const t of [
  '../../core/Logger.js',
  '../utils/systemState.js',
  '../utils/commandRouter.js',
  '../ApprovalSystem.cjs',
  '../../core/MessageBroker.cjs',
  '../../config/owner.json'
]) {
  console.log((fs.existsSync(path.resolve(dir, t)) ? 'EXISTS  ' : 'MISSING ') + t);
}

console.log('\n=== node --check (syntax) ===');
try {
  execSync('node --check "' + file + '"', { stdio: 'pipe' });
  console.log('SYNTAX OK');
} catch (e) {
  console.log('SYNTAX FAIL');
  console.log(e.stderr ? e.stderr.toString() : e.message);
}

console.log('\n=== require() targets reachable ===');
console.log('MessageBroker.cjs exists:', fs.existsSync(base + 'core/MessageBroker.cjs'));
console.log('ApprovalSystem.cjs exists:', fs.existsSync(base + 'server/ApprovalSystem.cjs'));

console.log('\n=== addWebSocketListener defined in ApprovalSystem? ===');
try {
  const aps = fs.readFileSync(base + 'server/ApprovalSystem.cjs', 'utf8');
  console.log('has addWebSocketListener:', /addWebSocketListener/.test(aps));
  console.log('has respondToApproval  :', /respondToApproval/.test(aps));
  console.log('has initialize         :', /\binitialize\b/.test(aps));
} catch (e) { console.log('cannot read ApprovalSystem.cjs:', e.message); }

console.log('\n=== exports in systemState / commandRouter ===');
for (const t of ['server/utils/systemState.js', 'server/utils/commandRouter.js']) {
  try {
    const s = fs.readFileSync(base + t, 'utf8');
    const exps = [...s.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(m => m[1]);
    console.log(t + ' exports:', exps.join(', ') || '(none detected)');
  } catch (e) { console.log(t + ' unreadable:', e.message); }
}
