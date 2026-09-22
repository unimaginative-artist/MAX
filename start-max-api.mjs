import os from 'os';
import { MAX } from './core/MAX.js';
import { createServer } from './server/server.js';

// Safe all-day autonomy configuration
process.env.MAX_API_BACKGROUND = 'true';
process.env.MAX_AUTONOMOUS_GOALS = 'false';
process.env.MAX_AUTONOMOUS_CI = 'false'; // Keep infinite CI test loops strictly off
process.env.MAX_CLUSTER_ROLE = 'worker';
process.env.MAX_NODE_ID = 'machine_b';
process.env.MAX_AUTO_APPROVE = 'all';
process.env.MAX_ECO_MODE = 'true'; // Thermal governor: 45s pacing & unit-only test runs
process.env.MAX_WORKER_ALLOW_CLOUD = 'true'; // Permit DeepSeek & SOMA cloud/LAN tiers when available
process.env.MAX_DISCORD_ENABLED = 'true';
process.env.MAX_EXTERNAL_SEND = 'true';
process.env.LOCAL_FIRST = 'true';
process.env.MAX_AUTONOMOUS_SELF_IMPROVE = 'true';
process.env.MAX_DAILY_BUDGET = process.env.MAX_DAILY_BUDGET || '0.50';
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

// Announce worker readiness to Machine A coordinator
const coordinatorUrl = process.env.MAX_COORDINATOR_URL || 'http://192.168.1.254:3100';
const primeApiKey = process.env.MAX_PRIME_API_KEY || 'max_a1c4f354218ccb85d8ce62a2e6233a1adb0422930fb58ecb';
setTimeout(async () => {
    try {
        console.log(`[Cluster] 📡 Announcing machine_b to coordinator at ${coordinatorUrl}...`);
        const res = await fetch(`${coordinatorUrl}/api/swarm/control/refresh`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${primeApiKey}`,
                'Content-Type': 'application/json',
                'X-Max-Node-Id': 'machine_b'
            }
        });
        if (res.ok) {
            console.log(`[Cluster] ✅ Successfully registered with coordinator at ${coordinatorUrl}`);
        } else {
            console.warn(`[Cluster] ⚠️ Coordinator responded with HTTP ${res.status}`);
        }
    } catch (err) {
        console.warn(`[Cluster] ⚠️ Could not contact coordinator: ${err.message}`);
    }
}, 3000);

