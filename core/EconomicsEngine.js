// ═══════════════════════════════════════════════════════════════════════════
// EconomicsEngine.js — MAX's pragmatic resource manager
// Tracks token usage, estimates API costs, and recommends models.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const STATS_FILE = path.join(process.cwd(), '.max', 'economics.json');

// Current pricing (approximate USD per 1M tokens) as of March 2026
const PRICING = {
    'deepseek-chat':     { input: 0.07, output: 1.10 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
    'ollama':            { input: 0.00, output: 0.00 }, // Local is free
    'default':           { input: 0.10, output: 1.00 }
};

export class EconomicsEngine {
    constructor(config = {}) {
        this.config = {
            budgetAlert: config.budgetAlert || 5.00, // Alert at $5 daily
            ...config
        };

        this.dailyUsage = {
            date: new Date().toISOString().split('T')[0],
            models: {}, // model -> { inputTokens, outputTokens, cost }
            totalCost: 0
        };

        this._load();
    }

    /**
     * Record usage after a brain call.
     */
    recordUsage(model, inputTokens, outputTokens) {
        const today = new Date().toISOString().split('T')[0];
        if (this.dailyUsage.date !== today) {
            this.dailyUsage = { date: today, models: {}, totalCost: 0 };
        }

        const stats = PRICING[model] || PRICING['default'];
        const cost = (inputTokens / 1_000_000 * stats.input) + (outputTokens / 1_000_000 * stats.output);

        if (!this.dailyUsage.models[model]) {
            this.dailyUsage.models[model] = { inputTokens: 0, outputTokens: 0, cost: 0 };
        }

        const m = this.dailyUsage.models[model];
        m.inputTokens += inputTokens;
        m.outputTokens += outputTokens;
        m.cost += cost;
        this.dailyUsage.totalCost += cost;

        this._save();

        if (this.dailyUsage.totalCost > this.config.budgetAlert) {
            console.warn(`[Economics] 💸 Budget Alert: Daily cost is $${this.dailyUsage.totalCost.toFixed(2)}`);
        }
    }

    /**
     * Recommend a model based on task requirements.
     * urgency: 0.0 to 1.0 (1.0 = immediate/critical)
     * complexity: 0.0 to 1.0 (1.0 = deep reasoning/coding)
     */
    recommendModel(taskType, { urgency = 0.5, complexity = 0.5 } = {}) {
        // High complexity coding always gets the reasoner if possible
        if (complexity > 0.8 || taskType === 'code_evolution') {
            return 'deepseek-reasoner';
        }

        // Low urgency, low complexity tasks (background research, acks) use local Ollama
        if (urgency < 0.3 && complexity < 0.4) {
            return 'ollama';
        }

        // Default to the standard smart model (balanced)
        return 'deepseek-chat';
    }

    getStatus() {
        return {
            date: this.dailyUsage.date,
            totalCost: `$${this.dailyUsage.totalCost.toFixed(4)}`,
            modelBreakdown: this.dailyUsage.models
        };
    }

    _save() {
        try {
            const dir = path.dirname(STATS_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(STATS_FILE, JSON.stringify(this.dailyUsage, null, 2));
        } catch { /* non-fatal */ }
    }

    _load() {
        try {
            if (fs.existsSync(STATS_FILE)) {
                const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
                const today = new Date().toISOString().split('T')[0];
                if (data.date === today) {
                    this.dailyUsage = data;
                }
            }
        } catch { /* start fresh */ }
    }

    /**
     * Project monthly cost based on current daily run rate.
     */
    getProjectedMonthlyCost() {
        return this.dailyUsage.totalCost * 30;
    }
}
