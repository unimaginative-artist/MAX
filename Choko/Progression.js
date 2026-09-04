// ═══════════════════════════════════════════════════════════════════════════
// Progression.js — Choko's Gamified Reward & Evolution System
// 
// Manages Choko's EXP, Level, Sparkles, and Evolution Milestones.
// MAX acts as mentor/senpai who inspects her work, awards Sparkles,
// and autonomously executes code evolutions for her as rewards!
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TITLES = [
    'Novice Scout 🍫',          // Lv 1
    'Apprentice Scout 🎀',      // Lv 2
    'Sentinel Scout 🌰',        // Lv 3
    'Vanguard Recon 🌸',        // Lv 4
    'Master Code Sweeper 🧹✨',  // Lv 5
    'Royal Recon Specialist 👑' // Lv 6+
];

export class Progression extends EventEmitter {
    constructor(dataDir) {
        super();
        this.dataDir = dataDir || path.join(__dirname, '.max');
        this.filePath = path.join(this.dataDir, 'progression.json');
        this.state = this._loadInitialState();
    }

    _loadInitialState() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        if (fs.existsSync(this.filePath)) {
            try {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            } catch (err) {
                console.warn('[ChokoProgression] Failed to parse progression.json, rebuilding default:', err.message);
            }
        }

        const defaultState = {
            level: 1,
            title: TITLES[0],
            xp: 75,
            xpToNextLevel: 200,
            sparkles: 5,
            totalSparklesEarned: 5,
            stats: {
                reportsSubmitted: 0,
                bugsDiscovered: 0,
                goalsCompleted: 0,
                evolutionsAchieved: 0
            },
            unlockedHats: ['Strawberry', 'Matcha', 'DeepCacao'],
            currentHat: 'Strawberry',
            wishes: [
                {
                    id: 'hazelnut',
                    title: 'Hazelnut Hat',
                    cost: 8,
                    type: 'persona',
                    desc: 'A hardened, sharp persona for security audits & vulnerability scouting 🌰🔒',
                    unlocked: false
                },
                {
                    id: 'shared_memory',
                    title: 'Shared Memory Bridge',
                    cost: 15,
                    type: 'tool',
                    desc: 'Direct query access to MAX and SOMA knowledge vectors 🧠🤝',
                    unlocked: false
                },
                {
                    id: 'eagle_eyes',
                    title: 'Eagle Eyes Vision',
                    cost: 30,
                    type: 'tool',
                    desc: 'Playwright screenshot and UI sparkle inspector 👁️✨',
                    unlocked: false
                }
            ],
            history: [
                {
                    timestamp: new Date().toISOString(),
                    type: 'born',
                    note: 'Choko initialized her adventure! 🍫✨'
                }
            ]
        };

        this._saveState(defaultState);
        return defaultState;
    }

    _saveState(state = this.state) {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
        } catch (err) {
            console.error('[ChokoProgression] Failed to save progression:', err.message);
        }
    }

    /**
     * Award XP and Sparkles for quality work.
     */
    award({ xp = 20, sparkles = 1, reason = 'Good scout work', details = '' }) {
        this.state.xp += xp;
        this.state.sparkles += sparkles;
        this.state.totalSparklesEarned += sparkles;

        let leveledUp = false;
        while (this.state.xp >= this.state.xpToNextLevel) {
            this.state.xp -= this.state.xpToNextLevel;
            this.state.level += 1;
            this.state.xpToNextLevel = Math.round(this.state.xpToNextLevel * 1.5);
            const titleIndex = Math.min(this.state.level - 1, TITLES.length - 1);
            this.state.title = TITLES[titleIndex];
            leveledUp = true;
        }

        const eventData = {
            xpAwarded: xp,
            sparklesAwarded: sparkles,
            reason,
            details,
            totalXP: this.state.xp,
            level: this.state.level,
            title: this.state.title,
            sparkles: this.state.sparkles,
            leveledUp
        };

        this.state.history.push({
            timestamp: new Date().toISOString(),
            type: leveledUp ? 'level_up' : 'award',
            ...eventData
        });

        // Keep last 50 history entries
        if (this.state.history.length > 50) {
            this.state.history = this.state.history.slice(-50);
        }

        this._saveState();
        this.emit('award', eventData);
        if (leveledUp) this.emit('level_up', eventData);

        return eventData;
    }

    /**
     * Check if Choko has accumulated enough Sparkles for her next evolution.
     */
    checkEvolutionEligibility() {
        const nextWish = this.state.wishes.find(w => !w.unlocked);
        if (!nextWish) return { eligible: false, message: 'All current wishlist items unlocked!' };

        const eligible = this.state.sparkles >= nextWish.cost;
        return {
            eligible,
            wish: nextWish,
            sparkles: this.state.sparkles,
            cost: nextWish.cost,
            needed: Math.max(0, nextWish.cost - this.state.sparkles)
        };
    }

    /**
     * Grant an evolution reward (executed by MAX-senpai).
     */
    grantEvolution(wishId, grantedBy = 'MAX-senpai') {
        const wish = this.state.wishes.find(w => w.id === wishId);
        if (!wish) return { success: false, error: `Wish "${wishId}" not found` };
        if (wish.unlocked) return { success: false, error: `Wish "${wishId}" already unlocked` };

        if (this.state.sparkles < wish.cost) {
            return { success: false, error: `Not enough sparkles (has ${this.state.sparkles}, needs ${wish.cost})` };
        }

        // Deduct cost and unlock
        this.state.sparkles -= wish.cost;
        wish.unlocked = true;
        wish.unlockedAt = new Date().toISOString();
        this.state.stats.evolutionsAchieved += 1;

        if (wish.type === 'persona' && !this.state.unlockedHats.includes('Hazelnut')) {
            this.state.unlockedHats.push('Hazelnut');
            this.state.currentHat = 'Hazelnut';
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'evolution',
            wishId: wish.id,
            title: wish.title,
            grantedBy,
            sparklesRemaining: this.state.sparkles
        };

        this.state.history.push(logEntry);
        this._saveState();

        this.emit('evolution', {
            wish,
            grantedBy,
            state: this.getStatus()
        });

        return {
            success: true,
            wish,
            grantedBy,
            sparklesRemaining: this.state.sparkles
        };
    }

    getStatus() {
        return {
            level: this.state.level,
            title: this.state.title,
            xp: this.state.xp,
            xpToNextLevel: this.state.xpToNextLevel,
            percentToNext: Math.round((this.state.xp / this.state.xpToNextLevel) * 100),
            sparkles: this.state.sparkles,
            stats: this.state.stats,
            unlockedHats: this.state.unlockedHats,
            currentHat: this.state.currentHat,
            nextWish: this.state.wishes.find(w => !w.unlocked) || null,
            wishes: this.state.wishes
        };
    }
}
