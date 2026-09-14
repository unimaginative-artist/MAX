import fs from 'fs';

const candidates = [
  'frontend/vite.config.js',
  'vite.config.js',
  'agents.js',
  'extended.js',
  'routes.js',
  'websocket.js',
  'somaRoutes.js',
  'server/routes.js',
  'server/websocket.js',
  'server/somaRoutes.js',
  'server/agents.js',
  'server/extended.js',
  'core/agents.js',
  'core/routes.js'
];

for (const f of candidates) {
  console.log((fs.existsSync(f) ? 'EXISTS  ' : 'MISSING ') + f);
}

console.log('---');
console.log('frontend dir exists:', fs.existsSync('frontend'));
console.log('server dir contents:', fs.existsSync('server') ? fs.readdirSync('server').join(', ') : 'N/A');
