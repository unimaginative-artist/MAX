import fs from 'fs';
import os from 'os';
import path from 'path';
import { EconomicsEngine } from '../../../core/EconomicsEngine.js';

describe('EconomicsEngine cloud reservations', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'max-economics-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('prevents concurrent calls from spending the same allowance', () => {
        const economics = new EconomicsEngine({
            dailyBudget: 0.25,
            statsFile: path.join(tempDir, 'economics.json')
        });

        const first = economics.reserveUsage('deepseek-chat', 1_000, 200_000);
        const second = economics.reserveUsage('deepseek-chat', 1_000, 200_000);

        expect(first).toBeTruthy();
        expect(second).toBeNull();
        expect(economics.getBudgetStatus().reserved).toBeGreaterThan(0.2);
    });

    test('settles a reservation against actual recorded usage', () => {
        const economics = new EconomicsEngine({
            dailyBudget: 0.25,
            statsFile: path.join(tempDir, 'economics.json')
        });

        const reservation = economics.reserveUsage('deepseek-chat', 1_000, 10_000);
        economics.recordUsage('deepseek-chat', 1_000, 1_000, reservation);

        const status = economics.getBudgetStatus();
        expect(status.reserved).toBe(0);
        expect(status.used).toBeGreaterThan(0);
        expect(status.used).toBeLessThan(0.01);
    });
});
