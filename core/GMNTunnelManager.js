// ═══════════════════════════════════════════════════════════════════════════
// GMNTunnelManager.js — Graymatter Network Tier 3 Sovereign Cloud Relay
// Manages zero-config Cloudflare tunnels for wide-area connectivity,
// allowing Satellite clients outside the home Wi-Fi to reach the host cluster.
// ═══════════════════════════════════════════════════════════════════════════

import { startTunnel } from 'untun';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export class GMNTunnelManager {
    constructor(port = 3100) {
        this.port = port;
        this.tunnel = null;
        this.publicUrl = null;
        this.relayFile = path.resolve(process.cwd(), '.max', 'gmn_public_relay.json');
    }

    async start() {
        if (this.tunnel && this.publicUrl) {
            return { ok: true, url: this.publicUrl, cached: true };
        }

        try {
            console.log(`[GMNTunnelManager] 🌐 Initializing GMN Tier 3 Cloud Relay on port ${this.port}...`);
            this.tunnel = await startTunnel({ port: this.port });
            this.publicUrl = await this.tunnel.getURL();

            console.log(`[GMNTunnelManager] 🚀 GMN Public Relay active: ${this.publicUrl}`);

            // Persist for client and cluster discovery
            await fs.mkdir(path.dirname(this.relayFile), { recursive: true });
            await fs.writeFile(this.relayFile, JSON.stringify({
                url: this.publicUrl,
                port: this.port,
                startedAt: Date.now()
            }, null, 2));

            return { ok: true, url: this.publicUrl };
        } catch (err) {
            console.warn(`[GMNTunnelManager] ⚠️ Failed to start Cloud Relay: ${err.message}`);
            return { ok: false, error: err.message };
        }
    }

    async stop() {
        if (this.tunnel) {
            try {
                await this.tunnel.close();
                console.log('[GMNTunnelManager] 🛑 GMN Public Relay closed.');
            } catch {}
            this.tunnel = null;
            this.publicUrl = null;
        }

        if (existsSync(this.relayFile)) {
            await fs.unlink(this.relayFile).catch(() => {});
        }
    }

    getUrl() {
        return this.publicUrl;
    }

    static getSavedRelayUrl() {
        const relayFile = path.resolve(process.cwd(), '.max', 'gmn_public_relay.json');
        try {
            if (existsSync(relayFile)) {
                const data = JSON.parse(require('fs').readFileSync(relayFile, 'utf8'));
                return data.url || null;
            }
        } catch {}
        return null;
    }
}
