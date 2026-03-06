
import path from 'path';

/**
 * SelfEvolutionTool — Allows MAX to safely modify his own source code.
 * Integrated with EvolutionArbiter for production-grade safety.
 */
export const createSelfEvolutionTool = (max) => ({
    name: 'self',
    description: 'Autonomous self-improvement. Use this to safely modify your own source code.',

    actions: {
        /**
         * Evolve a specific file with new logic.
         */
        async evolve({ filePath, reasoning, oldCode, newCode }) {
            if (!max.evolution) return { success: false, error: "Evolution system not initialized." };

            console.log(`[SelfEvolution] 🚀 Starting evolution cycle for: ${filePath}`);
            console.log(`[SelfEvolution] 🧠 Reasoning: ${reasoning}`);

            try {
                // 1. Propose (Copy to staging)
                const stagedPath = await max.evolution.propose(filePath);

                // 2. Modify (Apply surgical change to the staged file)
                const res = await max.tools.execute('file', 'replace', {
                    filePath: stagedPath,
                    oldText:  oldCode,
                    newText:  newCode
                });

                if (!res.success) return res;

                // 3. Verify (ESLint + Syntax + Brain Checks)
                const verification = await max.evolution.verify(stagedPath);
                if (!verification.success) {
                    return { 
                        success: false, 
                        error: `Self-Correction Required: The proposed change failed validation.`,
                        details: verification.error
                    };
                }

                // 4. Commit (Backup original + Swap)
                const commit = await max.evolution.commit(filePath);

                // 5. Record in Knowledge Base
                await max.kb.remember(
                    `Self-Evolution: Improved ${filePath}
Reasoning: ${reasoning}
Change: ${oldCode.slice(0, 50)}... -> ${newCode.slice(0, 50)}...`,
                    { source: 'evolution_arbiter', type: 'code_change' }
                );

                return {
                    success: true,
                    message: `Evolution successful. My brain has been updated.`,
                    backup:  commit.backup
                };

            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
});
