import { MAX } from './core/MAX.js';
import { createServer } from './server/server.js';

// Safe all-day autonomy configuration
process.env.MAX_API_BACKGROUND = 'true';
process.env.MAX_AUTONOMOUS_GOALS = 'true';
process.env.MAX_AUTONOMOUS_CI = 'false'; // Keep infinite CI test loops strictly off

console.log('🚀 Launching MAX API Server on port 3100 (Autonomous Builder Mode)...');
const max = new MAX({
    mode: 'api',
    runtimeMode: 'api'
});
await max.initialize();

const port = process.env.MAX_PORT ? parseInt(process.env.MAX_PORT, 10) : 3100;
await createServer(max, { port, host: '0.0.0.0' });
console.log(`✅ MAX REST API running at http://0.0.0.0:${port}`);
