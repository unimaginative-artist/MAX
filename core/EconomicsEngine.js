// ═══════════════════════════════════════════════════════════════════════════
// EconomicsEngine.js — MAX's pragmatic resource manager
// Tracks token usage, estimates API costs, and recommends models.
//
// Level 4 Update: Goal Economy. MAX must "earn" his budget by completing
// goals efficiently to unlock more expensive reasoner tiers.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const STATS_FILE = path.join(process.cwd(), '.max', 'economics.json');

// Current pricing (approximate USD per 1M tokens) as of March 2026
const PRICING = {
    'deepseek-chat':     { input: 0.07, output: 1.10 },
    'deepseek-reasoner': { input: 0.55, output: 2.19 },
    'ollama':            { input: 0.00, output: 0.00 }, // Local is free
    'gemini-2.0-flash':  { input: 0.10, output: 0.40 }, // High-speed flash
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
            totalCost: 0,
            earnings: 0, // Goal rewards earned today
            netProfit: 0
        };

        this._load();
    }

    /**
     * Record usage after a brain call.
     */
    recordUsage(model, inputTokens, outputTokens) {
        const today = new Date().toISOString().split('T')[0];
        if (this.dailyUsage.date !== today) {
            this._resetDaily(today);
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
        this.dailyUsage.netProfit -= cost;

        this._save();

        if (this.dailyUsage.totalCost > this.config.budgetAlert) {
            console.warn(`[Economics] 💸 Budget Alert: Daily cost is $${this.dailyUsage.totalCost.toFixed(2)}`);
        }
    }

    /**
     * MAX earns "money" by completing tasks.
     * Higher priority and faster completion lead to higher rewards.
     */
    recordEarning(amount, source = 'goal_complete') {
        const today = new Date().toISOString().split('T')[0];
        if (this.dailyUsage.date !== today) {
            this._resetDaily(today);
        }

        this.dailyUsage.earnings += amount;
        this.dailyUsage.netProfit += amount;
        this._save();
        
        console.log(`[Economics] 💰 Earned: $${amount.toFixed(4)} via ${source}`);
    }

    /**
     * Recommend a model based on task requirements AND current profit.
     * urgency: 0.0 to 1.0 (1.0 = immediate/critical)
     * complexity: 0.0 to 1.0 (1.0 = deep reasoning/coding)
     */
    recommendModel(taskType, { urgency = 0.5, complexity = 0.5 } = {}) {
        const isBroke = this.dailyUsage.netProfit < -0.10; // Debt threshold
        const isRich  = this.dailyUsage.netProfit > 1.00;  // Prosperity threshold

        // If broke, force local Ollama for low/medium complexity
        if (isBroke && complexity < 0.7) {
            return 'ollama';
        }

        // High complexity coding always gets the reasoner if we can afford it
        if (complexity > 0.8 || taskType === 'code_evolution') {
            if (this.dailyUsage.netProfit > -0.50) return 'deepseek-reasoner';
            return 'deepseek-chat'; // Fallback to cheaper smart tier
        }

        // If prosperous, upgrade research tasks to flash
        if (isRich && taskType === 'research') {
            return 'gemini-2.0-flash';
        }

        // Low urgency, low complexity tasks use local Ollama
        if (urgency < 0.3 && complexity < 0.4) {
            return 'ollama';
        }

        return 'deepseek-chat'; // Balanced default
    }

    getStatus() {
        const cost = this.dailyUsage.totalCost || 0;
        const earn = this.dailyUsage.earnings || 0;
        const prof = this.dailyUsage.netProfit || 0;
        return {
            date: this.dailyUsage.date,
            totalCost: `$${cost.toFixed(4)}`,
            earnings: `$${earn.toFixed(4)}`,
            netProfit: `$${prof.toFixed(4)}`,
            modelBreakdown: this.dailyUsage.models
        };
    }

    _resetDaily(date) {
        this.dailyUsage = { 
            date, 
            models: {}, 
            totalCost: 0, 
            earnings: 0, 
            netProfit: 0 
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
}
