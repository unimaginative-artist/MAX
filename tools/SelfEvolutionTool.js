// ═══════════════════════════════════════════════════════════════════════════
// SelfEvolutionTool — MAX manages his own code evolution
// 
// Bridges MAX with the EvolutionArbiter to safely propose, verify, and
// commit changes to his own source code.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';

export const createSelfEvolutionTool = (max) => ({
    name: 'self_evolution',
    description: `Safely modify and improve your own source code.
Use this to fix bugs, refactor for better architecture, or add new capabilities.
Available actions:
  propose → copy a file to staging for editing: TOOL:self_evolution:propose:{"filePath":"core/MAX.js"}
  verify  → run syntax, linting, and peer review checks on a staged file: TOOL:self_evolution:verify:{"stagedPath":".max/evolution/staging/MAX.js"}
  commit  → backup the original and move the verified change into production: TOOL:self_evolution:commit:{"filePath":"core/MAX.js"}`,

    actions: {
        propose: async ({ filePath }) => {
            if (!max.evolution) return { success: false, error: 'EvolutionArbiter not initialized' };
            try {
                const stagedPath = await max.evolution.propose(filePath);
                return { 
                    success: true, 
                    stagedPath,
                    message: `File copied to staging. Edit ${stagedPath} and then call verify.`
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        verify: async ({ stagedPath }) => {
            if (!max.evolution) return { success: false, error: 'EvolutionArbiter not initialized' };
            try {
                const result = await max.evolution.verify(stagedPath);
                return result;
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        commit: async ({ filePath }) => {
            if (!max.evolution) return { success: false, error: 'EvolutionArbiter not initialized' };
            try {
                const result = await max.evolution.commit(filePath);
                return result;
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
});
