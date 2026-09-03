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
    },
};
