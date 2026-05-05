// ═══════════════════════════════════════════════════════════════════════════
// SystemTool.js — MAX's system-level control tools
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const createSystemTool = (max) => ({
    name: 'system',
    description: `Perform system-level operations like rebooting or diagnostics.
Available actions:
  phoenix_reboot → trigger a detached watchdog to restart MAX after shutdown: TOOL:system:phoenix_reboot:{}
  shutdown       → gracefully shut down MAX: TOOL:system:shutdown:{}`,

    actions: {
        phoenix_reboot: async () => {
            console.log('[System] 🔥 PHOENIX PROTOCOL INITIATED.');
            
            const watchdogPath = path.join(__dirname, '..', 'core', 'PhoenixWatchdog.mjs');
            const mainPath     = path.join(__dirname, '..', 'launcher.mjs');
            
            // Spawn the watchdog as a completely detached process
            const watchdog = spawn('node', [
                watchdogPath, 
                process.pid.toString(), 
                'node', 
                mainPath,
                '--mode', 'chat' // Default back to chat mode
            ], {
                detached: true,
                stdio: 'ignore'
            });

            watchdog.unref();

            console.log('[System] 👋 Shutdown in 2 seconds for rebirth...');
            setTimeout(() => {
                process.exit(0);
            }, 2000);

            return { success: true, message: "Phoenix watchdog spawned. MAX will restart in moments." };
        },

        shutdown: async () => {
            console.log('[System] 👋 Graceful shutdown requested.');
            setTimeout(() => {
                process.exit(0);
            }, 1000);
            return { success: true, message: "Shutting down..." };
        }
    }
});
