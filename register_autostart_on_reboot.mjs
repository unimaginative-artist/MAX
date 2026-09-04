// ═══════════════════════════════════════════════════════════════════════════
// register_autostart_on_reboot.mjs — Windows Startup Auto-Bootstrapper
// Ensures SOMA Core (3001) and MAX Swarm API (3100) automatically start
// and re-connect to the cluster on Windows reboot.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const startupFolder = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const batPath = path.join(startupFolder, 'start_soma_max_cluster.bat');

const batContent = `@echo off
:: Auto-start SOMA Core (Port 3001) and MAX Swarm API (Port 3100) on Windows Reboot
echo [ClusterAutoStart] 🚀 Starting SOMA Core & MAX Swarm API Cluster...

cd /d "C:\\Users\\barry\\Desktop\\SOMA"
start "SOMA Core (Port 3001)" /min cmd /c "node launcher_ULTRA.mjs"

cd /d "c:\\Users\\barry\\Desktop\\MAX"
start "MAX Swarm API (Port 3100)" /min cmd /c "node start-max-api.mjs"

echo [ClusterAutoStart] ✅ SOMA and MAX launched in background!
`;

try {
    fs.writeFileSync(batPath, batContent, 'utf8');
    console.log(`[AutoStart] ✅ Windows Startup script successfully registered!`);
    console.log(`[AutoStart] 📄 Script Path: ${batPath}`);
    console.log(`[AutoStart] 🚀 SOMA & MAX will now auto-start and auto-connect after any reboot!`);
} catch (err) {
    console.error(`[AutoStart] ❌ Failed to write Startup script:`, err.message);
}
