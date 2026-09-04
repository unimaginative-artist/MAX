// ═══════════════════════════════════════════════════════════════════════════
// start-gmn-public-relay.mjs — Graymatter Network Tier 3 Global Cloud Relay
// Starts an encrypted zero-config Cloudflare tunnel to port 3100,
// enabling Maxwell Satellite Orbs anywhere on the planet to auto-connect.
// ═══════════════════════════════════════════════════════════════════════════

import { GMNTunnelManager } from '../core/GMNTunnelManager.js';

async function main() {
    const port = process.env.MAX_PORT ? parseInt(process.env.MAX_PORT, 10) : 3100;
    const tunnelMgr = new GMNTunnelManager(port);

    console.log('🛸 Starting Graymatter Network (GMN) Tier 3 Cloud Relay...');
    const res = await tunnelMgr.start();

    if (!res.ok) {
        console.error('❌ Failed to start GMN Relay:', res.error);
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  👑 GMN TIER 3 GLOBAL RELAY IS ONLINE');
    console.log(`  🌐 Public Sovereign URL: ${res.url}`);
    console.log(`  🔗 Relayed Local Port:   ${port}`);
    console.log('  📡 All external Maxwell Satellites will now auto-route here.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Press Ctrl+C to close the global relay.');

    process.on('SIGINT', async () => {
        console.log('\n🛑 Closing GMN Cloud Relay...');
        await tunnelMgr.stop();
        process.exit(0);
    });

    // Keep alive
    setInterval(() => {}, 60000);
}

main().catch(console.error);
