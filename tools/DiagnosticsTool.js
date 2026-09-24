// ═══════════════════════════════════════════════════════════════════════════
// DiagnosticsTool.js — MAX's diagnostics and system health tool
// ═══════════════════════════════════════════════════════════════════════════

import os from 'os';

export const createDiagnosticsTool = (max) => ({
    name: 'diagnostics',
    description: `Inspect MAX's system health, memory, subsystem status, and run diagnostic scans.
Available actions:
  run     → run full architectural audits and background scanners: TOOL:diagnostics:run:{}
  status  → return immediate subsystem status and health metrics: TOOL:diagnostics:status:{}
  memory  → report process heap and system memory: TOOL:diagnostics:memory:{}`,

    actions: {
        run: async () => {
            if (max?.diagnostics?.runAll) {
                try {
                    await max.diagnostics.runAll();
                } catch (err) {
                    console.warn('[DiagnosticsTool] Scanner error:', err.message);
                }
            }
            const status = max?.getQuickStatus ? max.getQuickStatus() : (max?.getStatus ? max.getStatus() : {});
            return {
                success: true,
                status,
                scannersRun: max?.diagnostics?.scanners?.length || 0,
                timestamp: Date.now()
            };
        },

        status: async () => {
            const status = max?.getQuickStatus ? max.getQuickStatus() : (max?.getStatus ? max.getStatus() : {});
            return {
                success: true,
                status,
                timestamp: Date.now()
            };
        },

        memory: async () => {
            const mem = process.memoryUsage();
            return {
                success: true,
                process: {
                    rssMB: +(mem.rss / 1024 / 1024).toFixed(2),
                    heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(2),
                    heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(2)
                },
                system: {
                    totalMB: +(os.totalmem() / 1024 / 1024).toFixed(2),
                    freeMB: +(os.freemem() / 1024 / 1024).toFixed(2)
                },
                timestamp: Date.now()
            };
        }
    }
});
