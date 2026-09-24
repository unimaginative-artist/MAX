import {
    getSomaConfig,
    getSomaDiagnostics,
    isSomaHealthy,
    pollReady,
    startSoma,
    stopSoma,
} from '../core/SomaController.js';

export const SomaTool = {
    name: 'soma',
    description: 'Control the external SOMA assistant server. Use this tool when the user asks to start, stop, restart, or check SOMA.',

    actionDocs: {
        start: {
            description: 'Start SOMA and wait until its health endpoint is ready.',
            params: {
                timeoutMs: { type: 'number', required: false, default: 45000, description: 'Maximum readiness wait in milliseconds.' }
            }
        },
        status: { description: 'Check SOMA health and show its configured location.', params: {} },
        restart: {
            description: 'Stop SOMA, start it again, and wait for readiness.',
            params: {
                timeoutMs: { type: 'number', required: false, default: 45000, description: 'Maximum readiness wait in milliseconds.' }
            }
        },
        stop: { description: 'Stop the SOMA server.', params: {} },
        swarm_status: { description: 'Get live status of SOMA Engineering Swarm and candidate files.', params: {} },
        swarm_debate: { description: 'Submit an architectural engineering proposal to SOMA 3-role adversarial debate.', params: { title: 'string', description: 'string', files: 'array' } },
        swarm_validate: { description: 'Validate patch files through SOMA Security Council.', params: { files: 'array', patch: 'object' } },
        swarm_deploy: { description: 'Deploy verified patch to SOMA through transactional engine.', params: { patch: 'object', note: 'string' } }
    },

    actions: {
        async start({ timeoutMs = 45_000 } = {}) {
            const launch = await startSoma();
            const healthy = launch.healthy || await pollReady(timeoutMs);
            const diagnostics = healthy ? null : await getSomaDiagnostics();
            return {
                ...launch,
                ...getSomaConfig(),
                success: healthy,
                healthy,
                diagnostics,
                message: healthy ? 'SOMA is online.' : `SOMA did not become healthy within ${timeoutMs}ms.`,
            };
        },

        async status() {
            const healthy = await isSomaHealthy();
            return { success: true, healthy, ...await getSomaDiagnostics() };
        },

        async restart({ timeoutMs = 45_000 } = {}) {
            await stopSoma();
            const launch = await startSoma();
            const healthy = await pollReady(timeoutMs);
            const diagnostics = healthy ? null : await getSomaDiagnostics();
            return {
                ...launch,
                ...getSomaConfig(),
                success: healthy,
                healthy,
                diagnostics,
                message: healthy ? 'SOMA restarted and is online.' : `SOMA did not become healthy within ${timeoutMs}ms.`,
            };
        },

        async stop() {
            await stopSoma();
            return { success: true, healthy: false, ...getSomaConfig(), message: 'SOMA stopped.' };
        },

        async swarm_status() {
            const url = process.env.SOMA_URL || 'http://127.0.0.1:3001';
            try {
                const fetch = (await import('node-fetch')).default;
                const r = await fetch(`${url}/api/soma/swarm/status`);
                if (!r.ok) return { success: false, error: `SOMA HTTP ${r.status}` };
                const data = await r.json();
                return { success: true, ...data };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async swarm_debate({ title, description, files = [] } = {}) {
            const url = process.env.SOMA_URL || 'http://127.0.0.1:3001';
            try {
                const fetch = (await import('node-fetch')).default;
                const r = await fetch(`${url}/api/soma/swarm/debate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description, files })
                });
                if (!r.ok) return { success: false, error: `SOMA HTTP ${r.status}` };
                const data = await r.json();
                return { success: true, ...data };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async swarm_validate({ files = [], patch = null } = {}) {
            const url = process.env.SOMA_URL || 'http://127.0.0.1:3001';
            try {
                const fetch = (await import('node-fetch')).default;
                const r = await fetch(`${url}/api/soma/swarm/validate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files, patch })
                });
                if (!r.ok) return { success: false, error: `SOMA HTTP ${r.status}` };
                const data = await r.json();
                return { success: true, ...data };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        async swarm_deploy({ patch, note = '' } = {}) {
            const url = process.env.SOMA_URL || 'http://127.0.0.1:3001';
            try {
                const fetch = (await import('node-fetch')).default;
                const r = await fetch(`${url}/api/soma/swarm/deploy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patch, note })
                });
                if (!r.ok) return { success: false, error: `SOMA HTTP ${r.status}` };
                const data = await r.json();
                return { success: true, ...data };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    },
};
