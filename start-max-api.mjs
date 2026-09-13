import os from 'os';
import { MAX } from './core/MAX.js';
import { createServer } from './server/server.js';

// Safe all-day autonomy configuration
process.env.MAX_API_BACKGROUND = 'true';
process.env.MAX_AUTONOMOUS_GOALS = 'true';
process.env.MAX_AUTONOMOUS_CI = 'false'; // Keep infinite CI test loops strictly off
process.env.MAX_CLUSTER_ROLE = 'worker';
process.env.MAX_NODE_ID = 'machine_b';
process.env.MAX_AUTO_APPROVE = 'all';
process.env.MAX_ECO_MODE = 'true'; // Thermal governor: 45s pacing & unit-only test runs
process.env.MAX_WORKER_ALLOW_CLOUD = 'true'; // Permit DeepSeek & SOMA cloud/LAN tiers when available
process.env.LOCAL_FIRST = 'true';
process.env.SOMA_URL = process.env.SOMA_URL || 'http://192.168.1.254:3001';
process.env.OLLAMA_MODEL = 'max-coder:v2';
process.env.OLLAMA_MODEL_FAST = 'max-coder:v2';
process.env.OLLAMA_MODEL_SMART = 'max-coder:v2';
process.env.OLLAMA_MODEL_CODE = 'max-coder:v2';

// Set process priority to BelowNormal so laptop remains cool, responsive, and quiet
try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    console.log('🌿 Eco thermal governor active: process priority set to BelowNormal');
} catch {}

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
