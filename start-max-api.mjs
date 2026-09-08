import { MAX } from './core/MAX.js';
import { createServer } from './server/server.js';

// Safe all-day autonomy configuration
process.env.MAX_API_BACKGROUND = 'true';
process.env.MAX_AUTONOMOUS_GOALS = 'true';
process.env.MAX_AUTONOMOUS_CI = 'false'; // Keep infinite CI test loops strictly off
process.env.MAX_CLUSTER_ROLE = 'worker';
process.env.MAX_NODE_ID = 'machine_b';
process.env.MAX_AUTO_APPROVE = 'all';

console.log('🚀 Launching MAX API Server on port 3100 (Autonomous Cluster Worker Mode)...');
const max = new MAX({
    mode: 'api',
    runtimeMode: 'api',
    clusterRole: 'worker',
    nodeId: 'machine_b'
});
await max.initialize();

const port = process.env.MAX_PORT ? parseInt(process.env.MAX_PORT, 10) : 3100;
await createServer(max, { port, host: '0.0.0.0' });
console.log(`✅ MAX REST API running at http://0.0.0.0:${port}`);
