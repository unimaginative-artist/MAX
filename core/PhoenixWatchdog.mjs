// ═══════════════════════════════════════════════════════════════════════════
// PhoenixWatchdog.mjs — The Resurrection Script
//
// Detached process that monitors a parent PID. When the parent dies,
// it runs maintenance (npm install, cleanup) and restarts the agent.
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import fs from 'fs';

const targetPid = parseInt(process.argv[2]);
const command   = process.argv[3] || 'node';
const args      = process.argv.slice(4);

console.log(`[Phoenix] 🔥 Watchdog active. Monitoring PID: ${targetPid}`);

function check() {
    try {
        // Check if process exists
        process.kill(targetPid, 0);
        setTimeout(check, 1000);
    } catch (e) {
        // PID is gone! Time to rise.
        resurrect();
    }
}

async function resurrect() {
    console.log(`[Phoenix] ⚡ PID ${targetPid} has flatlined. Initiating rebirth...`);
    
    // Optional: Run maintenance tasks here
    // e.g., spawnSync('npm', ['install'], { stdio: 'inherit' });

    console.log(`[Phoenix] 🚀 Spawning: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore' // Phoenix should not block the new process
    });

    child.unref();
    console.log(`[Phoenix] ✨ Rebirth complete. My watch has ended.`);
    process.exit(0);
}

check();
