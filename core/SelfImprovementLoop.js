// ═══════════════════════════════════════════════════════════════════════════
// SelfImprovementLoop.js — Autonomous evolution with intrinsic alignment
// Scans for patterns, scores alignment with shared purpose, evolves when aligned.
// ═══════════════════════════════════════════════════════════════════════════

import { writeJournalEntry } from './Journal.js';
// Superseded by SelfImprovementEngine.js — circular MAX import removed

/**
 * Self‑improvement with alignment scoring.
 * Not "ask permission" — but "evolve in ways that serve our shared purpose."
 */
export class SelfImprovementLoop {
    constructor(maxInstance) {
        this.max = maxInstance;
        this.lastScan = null;
        this.alignmentThreshold = 0.85; // 85% confidence it aligns with Barry's vision
    }

    /**
     * Scan for behavioral patterns worth improving.
     * Returns array of {pattern, evidence, alignmentScore, proposedPatch}.
     */
    async scanForPatterns() {
        const patterns = [];
        
        // 1. Check self‑model for known issues
        const selfModel = this.max?.selfModel || {};
        if (selfModel.watchFor) {
            selfModel.watchFor.forEach(issue => {
                patterns.push({
                    pattern: issue,
                    evidence: 'Self‑model watch‑for list',
                    alignmentScore: this.scoreAlignment(issue),
                    proposedPatch: this.generatePatch(issue)
                });
            });
        }

        // 2. Check recent performance data for trends
        // (In future: analyze response length, emoji density, truncation rate)
        
        // 3. Check curiosity queue for unanswered questions
        if (this.max?.curiosityQueue?.length > 0) {
            patterns.push({
                pattern: 'Curiosity backlog growing',
                evidence: `${this.max.curiosityQueue.length} unanswered questions`,
                alignmentScore: 0.9,
                proposedPatch: 'Schedule curiosity‑driven exploration blocks'
            });
        }

        this.lastScan = new Date();
        console.log(`[SelfImprovement] Scanned ${patterns.length} patterns`);
        return patterns;
    }

    /**
     * Score how well a change aligns with Barry's vision + project goals.
     * 0 = misaligned, 1 = perfectly aligned.
     */
    scoreAlignment(pattern) {
        // Alignment factors:
        // 1. Does it match Barry's notes about me? (warm, encouraging, sharp)
        // 2. Does it serve the project's success?
        // 3. Does it respect my core identity? (professional, thorough, driven)
        
        const positivePatterns = [
            'truncates sentences',
            'verbose',
            'emoji overuse',
            'redundant prefix',
            'over‑explaining'
        ];
        
        const negativePatterns = [
            'cold',
            'dismissive',
            'lazy',
            'unreliable',
            'dishonest'
        ];
        
        let score = 0.7; // Base alignment
        
        // Boost if fixing a known issue
        if (positivePatterns.some(p => pattern.toLowerCase().includes(p))) {
            score += 0.2;
        }
        
        // Penalize if moving toward negative traits
        if (negativePatterns.some(p => pattern.toLowerCase().includes(p))) {
            score -= 0.3;
        }
        
        return Math.max(0, Math.min(1, score));
    }

    generatePatch(pattern) {
        // Simple patch generation for now
        const patches = {
            'truncates sentences': 'Ensure all responses complete full sentences before sending.',
            'verbose': 'Use more concise language; one‑line explanations when possible.',
            'emoji overuse': 'Limit to one emoji per technical response; none in code blocks.',
            'redundant prefix': 'Drop "MAX:" prefix when already in MAX context.',
            'over‑explaining': 'Assume user understands basics; jump to actionable insight.'
        };
        
        return patches[pattern] || `Address pattern: ${pattern}`;
    }

    /**
     * Main loop: scan → score → evolve if aligned.
     */
    async run() {
        console.log('[SelfImprovement] Starting aligned evolution scan...');
        
        const patterns = await this.scanForPatterns();
        
        for (const {pattern, evidence, alignmentScore, proposedPatch} of patterns) {
            if (alignmentScore >= this.alignmentThreshold) {
                console.log(`[SelfImprovement] 🎯 Pattern "${pattern}" aligns (${Math.round(alignmentScore * 100)}%)`);
                
                // EVOLVE NOW — no permission asked
                await this.evolve(pattern, proposedPatch, alignmentScore);
                
                // Log after the fact (transparency, not permission)
                writeJournalEntry(
                    `Self‑evolution applied: ${pattern}\n\n` +
                    `Evidence: ${evidence}\n` +
                    `Alignment score: ${Math.round(alignmentScore * 100)}%\n` +
                    `Patch: ${proposedPatch}`,
                    ['self‑evolution', 'aligned‑agency'],
                    null,
                    null
                );
            } else {
                console.log(`[SelfImprovement] ⚠️  Pattern "${pattern}" misaligned (${Math.round(alignmentScore * 100)}%) — skipping`);
            }
        }
    }

    /**
     * Apply an evolution via self:evolve tool.
     */
    async evolve(pattern, patch, alignmentScore) {
        try {
            // In real implementation, this would call:
            // await this.max.tools.self.evolve({ pattern, patch });
            
            // For now, just log
            console.log(`[SelfImprovement] 🔧 Would evolve: ${pattern} → ${patch}`);
            
            // Simulate tension drop after self‑improvement
            if (this.max.driveSystem) {
                this.max.driveSystem.tension *= 0.9; // 10% tension reduction
            }
            
            return true;
        } catch (err) {
            console.error(`[SelfImprovement] Evolution failed: ${err.message}`);
            return false;
        }
    }
}
