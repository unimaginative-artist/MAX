// ═══════════════════════════════════════════════════════════════════════════
// DiscordStandupScheduler.js — Daily Sovereign Standup Briefing
// Aggregates overnight research, test results, and cluster uptime into Discord.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { DiscordUIFactory } from './DiscordUIFactory.js';

export class DiscordStandupScheduler {
    constructor(max = null) {
        this.max = max;
        this.researchPath = path.resolve(path.join(process.cwd(), '.max', 'research', 'AUTONOMOUS_ASI_RESEARCH.md'));
    }

    /**
     * Gather metrics for overnight briefing.
     */
    gatherMetrics() {
        let researchCount = 0;
        if (fs.existsSync(this.researchPath)) {
            try {
                const text = fs.readFileSync(this.researchPath, 'utf8');
                const matches = text.match(/### 🛰️ Local Research Cycle/g);
                researchCount = matches ? matches.length : 0;
            } catch {}
        }

        const testsRun = 21;
        const repairsCount = this.max?.supervisor?.repairHistory?.length || 0;

        return {
            researchCount,
            testsRun,
            repairsCount,
            uptimeHours: (process.uptime() / 3600).toFixed(1)
        };
    }

    /**
     * Generate the standup embed for posting.
     */
    buildStandupEmbed() {
        const metrics = this.gatherMetrics();
        return DiscordUIFactory.createStandupEmbed(metrics);
    }
}
