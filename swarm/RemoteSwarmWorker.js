// ═══════════════════════════════════════════════════════════════════════════
// RemoteSwarmWorker.js — Handles cross-machine remote subtask execution
// Dispatches tasks to secondary MAX cluster nodes over REST/WebSocket APIs.
// ═══════════════════════════════════════════════════════════════════════════

import fetch from 'node-fetch';

export class RemoteSwarmWorker {
    constructor(nodeUrl, apiKey, options = {}) {
        this.nodeUrl = nodeUrl.replace(/\/$/, '');
        this.apiKey  = apiKey || process.env.MAX_PRIME_API_KEY || '';
        this.timeout = options.timeout || 60000;
        this.id      = options.id || `remote_${Math.random().toString(36).substring(2, 7)}`;
    }

    /**
     * Check if the remote node is online and ready for swarm jobs.
     */
    async ping() {
        try {
            const res = await fetch(`${this.nodeUrl}/health`, {
                headers: { 'X-Api-Key': this.apiKey },
                signal: AbortSignal.timeout(3000)
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Dispatch a subtask to the remote cluster node.
     */
    async runSubtask(subtask) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        try {
            const res = await fetch(`${this.nodeUrl}/api/swarm/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'X-Api-Key': this.apiKey
                },
                body: JSON.stringify({
                    subtask,
                    workerId: this.id
                }),
                signal: controller.signal
            });

            clearTimeout(timer);

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Remote node ${this.nodeUrl} returned ${res.status}: ${errText}`);
            }

            const data = await res.json();
            return {
                workerId: this.id,
                subtaskId: subtask.id,
                result: data.result,
                discoveries: data.discoveries || null,
                remote: true
            };
        } catch (err) {
            clearTimeout(timer);
            throw new Error(`Remote subtask failed on ${this.nodeUrl}: ${err.message}`);
        }
    }
}
