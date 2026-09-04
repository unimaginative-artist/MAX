import { Progression } from '../../../Choko/Progression.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'temp_progression_test');

describe('Choko Progression & Reward Engine', () => {
    beforeEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('initializes with default level 1 and sparkles', () => {
        const prog = new Progression(testDir);
        const status = prog.getStatus();
        expect(status.level).toBe(1);
        expect(status.sparkles).toBe(5);
        expect(status.title).toContain('Novice Scout');
        expect(status.unlockedHats).toEqual(['Strawberry', 'Matcha', 'DeepCacao']);
    });

    it('awards XP and Sparkles for scout reports', () => {
        const prog = new Progression(testDir);
        const res = prog.award({ xp: 50, sparkles: 2, reason: 'Patrol complete' });
        expect(res.xpAwarded).toBe(50);
        expect(res.sparklesAwarded).toBe(2);
        expect(prog.getStatus().sparkles).toBe(7);
        expect(prog.getStatus().xp).toBe(125);
    });

    it('levels up when XP passes threshold', () => {
        const prog = new Progression(testDir);
        const res = prog.award({ xp: 200, sparkles: 3, reason: 'Big bug caught' });
        expect(res.leveledUp).toBe(true);
        expect(res.level).toBe(2);
        expect(prog.getStatus().title).toContain('Apprentice Scout');
    });

    it('checks evolution eligibility based on sparkles', () => {
        const prog = new Progression(testDir);
        // Default sparkles = 5, Hazelnut cost = 8 -> not eligible yet
        let check = prog.checkEvolutionEligibility();
        expect(check.eligible).toBe(false);
        expect(check.needed).toBe(3);

        // Award 3 more sparkles -> now 8 -> eligible!
        prog.award({ xp: 20, sparkles: 3, reason: 'Found sparkling vulnerability' });
        check = prog.checkEvolutionEligibility();
        expect(check.eligible).toBe(true);
        expect(check.wish.id).toBe('hazelnut');
    });

    it('grants evolution, deducts cost, and unlocks hat', () => {
        const prog = new Progression(testDir);
        prog.award({ xp: 20, sparkles: 5, reason: 'Extra sparkles' }); // 10 sparkles total

        const grant = prog.grantEvolution('hazelnut', 'MAX-senpai');
        expect(grant.success).toBe(true);
        expect(grant.sparklesRemaining).toBe(2);

        const status = prog.getStatus();
        expect(status.unlockedHats).toContain('Hazelnut');
        expect(status.currentHat).toBe('Hazelnut');
        expect(status.stats.evolutionsAchieved).toBe(1);
    });
});
