import { jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { GameCodeTool } from '../../../tools/GameCodeTool.js';

function tmpDir() {
    return path.join(os.tmpdir(), `max-test-gamecode-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('GameCodeTool', () => {
    describe('list_templates', () => {
        test('returns all 6 template types', () => {
            const result = GameCodeTool.actions.list_templates();
            expect(result.success).toBe(true);
            expect(result.templates).toHaveLength(6);
            const types = result.templates.map(t => t.type);
            expect(types).toContain('pong');
            expect(types).toContain('snake');
            expect(types).toContain('breakout');
            expect(types).toContain('platformer');
            expect(types).toContain('top-down');
            expect(types).toContain('shooter');
        });

        test('canvas types have framework=canvas', () => {
            const { templates } = GameCodeTool.actions.list_templates();
            for (const t of templates.filter(t => ['pong','snake','breakout'].includes(t.type))) {
                expect(t.framework).toBe('canvas');
            }
        });

        test('phaser types have framework=phaser', () => {
            const { templates } = GameCodeTool.actions.list_templates();
            for (const t of templates.filter(t => ['platformer','top-down','shooter'].includes(t.type))) {
                expect(t.framework).toBe('phaser');
            }
        });
    });

    describe('scaffold - canvas games', () => {
        let outDir;
        beforeEach(() => { outDir = tmpDir(); });
        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('generates pong as a single .html file', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'pong', title: 'My Pong', outDir });
            expect(result.success).toBe(true);
            expect(result.framework).toBe('canvas');
            expect(result.outPath).toMatch(/my_pong\.html$/);
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('<!doctype html>');
            expect(html).toContain('My Pong');
            expect(html).toContain('canvas');
        });

        test('pong html has game loop and collision logic', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'pong', title: 'Pong', outDir });
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('requestAnimationFrame');
            expect(html).toContain('PAD_W');
        });

        test('generates snake as .html file', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'snake', title: 'Snake Game', outDir });
            expect(result.success).toBe(true);
            expect(result.framework).toBe('canvas');
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('Snake Game');
            expect(html).toContain('requestAnimationFrame');
        });

        test('generates breakout as .html file', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'breakout', title: 'Breakout', outDir });
            expect(result.success).toBe(true);
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('Breakout');
            expect(html).toContain('bricks');
        });

        test('custom width and height are embedded in canvas games', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'pong', title: 'Pong', width: 1024, height: 768, outDir });
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('1024');
            expect(html).toContain('768');
        });
    });

    describe('scaffold - phaser games', () => {
        let outDir;
        beforeEach(() => { outDir = tmpDir(); });
        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('generates platformer with Phaser CDN', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'platformer', title: 'Jump Quest', outDir });
            expect(result.success).toBe(true);
            expect(result.framework).toBe('phaser');
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('phaser');
            expect(html).toContain('Jump Quest');
            expect(html).toContain('arcade');
        });

        test('generates top-down game', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'top-down', title: 'Top View', outDir });
            expect(result.success).toBe(true);
            expect(result.framework).toBe('phaser');
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('Top View');
        });

        test('generates shooter game', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'shooter', title: 'Space Blaster', outDir });
            expect(result.success).toBe(true);
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('Space Blaster');
            expect(html).toContain('bullet');
        });

        test('phaser games include WASD movement code', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'platformer', title: 'Plat', outDir });
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('wasd');
        });
    });

    describe('scaffold - error cases', () => {
        let outDir;
        beforeEach(() => { outDir = tmpDir(); });
        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('returns error for unknown type', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'tetris', title: 'T', outDir });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/unknown type/i);
            expect(result.error).toContain('tetris');
        });

        test('creates outDir if it does not exist', async () => {
            const nested = path.join(outDir, 'deep', 'nested');
            const result = await GameCodeTool.actions.scaffold({ type: 'pong', title: 'P', outDir: nested });
            expect(result.success).toBe(true);
            const stat = await fs.stat(nested);
            expect(stat.isDirectory()).toBe(true);
        });

        test('slug is safe filename (title with special chars)', async () => {
            const result = await GameCodeTool.actions.scaffold({ type: 'snake', title: 'My <Game> & More!', outDir });
            expect(result.success).toBe(true);
            expect(result.outPath).toMatch(/my_game_more\.html$/);
        });
    });

    describe('from_world', () => {
        let outDir;
        let worldPath;
        let manifestPath;

        beforeEach(async () => {
            outDir = tmpDir();
            await fs.mkdir(outDir, { recursive: true });

            const manifest = {
                schema: 'max-game-assets-v1',
                assetDir: 'game_assets',
                assets: [
                    { id: 'floor_wood', path: 'tiles/floor_wood.png', type: 'tile', size: [16,16], frames: 1, tags: ['floor'] },
                    { id: 'wall_stone', path: 'tiles/wall_stone.png', type: 'tile', size: [16,16], frames: 1, tags: ['wall'] },
                ]
            };
            const world = {
                schema: 'max-game-world-v1',
                title: 'Test Dungeon',
                style: 'top-down 2D',
                theme: 'dungeon',
                size: { width: 10, height: 8, tileSize: 16 },
                assetDir: 'game_assets',
                assetsUsed: ['floor_wood', 'wall_stone'],
                zones: [{ id: 'entrance', name: 'Entrance', bounds: [1, 5, 3, 2] }],
                paths: [],
                layers: {
                    terrain: Array.from({ length: 8 }, (_, y) => Array.from({ length: 10 }, (__, x) => (x===0||x===9||y===0||y===7)?'wall_stone':'floor_wood')),
                    collision: Array.from({ length: 8 }, (_, y) => Array.from({ length: 10 }, (__, x) => (x===0||x===9||y===0||y===7)?1:0))
                },
                objects: [],
                animationNotes: [],
                prototypeFirst: 'Test'
            };

            manifestPath = path.join(outDir, 'manifest.json');
            worldPath = path.join(outDir, 'world.json');
            await fs.writeFile(manifestPath, JSON.stringify(manifest));
            await fs.writeFile(worldPath, JSON.stringify(world));
        });

        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('generates a Phaser HTML game from world JSON', async () => {
            const result = await GameCodeTool.actions.from_world({ worldPath, manifestPath, outDir });
            expect(result.success).toBe(true);
            expect(result.framework).toBe('phaser');
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('Test Dungeon');
            expect(html).toContain('phaser');
        });

        test('includes asset preload calls for used tiles', async () => {
            const result = await GameCodeTool.actions.from_world({ worldPath, manifestPath, outDir });
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain("load.image('floor_wood'");
            expect(html).toContain("load.image('wall_stone'");
        });

        test('includes collision wall data', async () => {
            const result = await GameCodeTool.actions.from_world({ worldPath, manifestPath, outDir });
            const html = await fs.readFile(result.outPath, 'utf8');
            expect(html).toContain('wallData');
            expect(html).toContain('walls');
        });

        test('returns error when worldPath is missing', async () => {
            const result = await GameCodeTool.actions.from_world({ worldPath: undefined, manifestPath, outDir });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/worldPath is required/i);
        });

        test('returns error when world schema is wrong', async () => {
            const badWorld = { schema: 'some-other-schema', title: 'Bad' };
            const badPath = path.join(outDir, 'bad.json');
            await fs.writeFile(badPath, JSON.stringify(badWorld));
            const result = await GameCodeTool.actions.from_world({ worldPath: badPath, manifestPath, outDir });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/max-game-world-v1/);
        });

        test('returns error when file does not exist', async () => {
            const result = await GameCodeTool.actions.from_world({
                worldPath: path.join(outDir, 'nonexistent.json'),
                manifestPath,
                outDir
            });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/from_world failed/i);
        });
    });
});
