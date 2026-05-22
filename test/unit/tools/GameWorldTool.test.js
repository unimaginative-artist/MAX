import { jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { auditAssetManifest, generateWorldFromManifest, validateWorld, renderWorldHtml, GameWorldTool } from '../../../tools/GameWorldTool.js';

function tmpDir() {
    return path.join(os.tmpdir(), `max-test-gwt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const manifest = {
    schema: 'max-game-assets-v1',
    assetDir: 'game_assets',
    assets: [
        { id: 'floor_wood',      path: 'tiles/floor_wood.png',             type: 'tile',      size: [16, 16], frames: 1, tags: ['floor', 'wood'] },
        { id: 'wall_plaster',    path: 'tiles/wall_plaster.png',           type: 'tile',      size: [16, 16], frames: 1, tags: ['wall'] },
        { id: 'lamp_wall_brass', path: 'props/lamp_wall_brass_4f.png',     type: 'prop',      size: [16, 24], frames: 4, tags: ['lamp', 'fire', 'warm'] },
        { id: 'book_shelf',      path: 'props/book_shelf.png',             type: 'prop',      size: [32, 32], frames: 1, tags: ['book', 'shelf'] },
        { id: 'shopkeeper_idle', path: 'characters/shopkeeper_idle_4f.png',type: 'character', size: [16, 24], frames: 4, tags: ['npc', 'idle'] }
    ]
};

describe('GameWorldTool pure world helpers', () => {
    describe('auditAssetManifest', () => {
        test('classifies concept art as reference-only and blocks playable readiness when essentials are missing', () => {
            const audit = auditAssetManifest({
                assetDir: 'game_assets',
                assets: [
                    { id: 'bookstore_concept', path: 'references/bookstore_concept.png', type: 'reference', size: [1024, 768], frames: 1, tags: ['concept'] },
                    { id: 'floor_wood', path: 'tiles/floor_wood.png', type: 'tile', size: [16, 16], frames: 1, tags: ['floor', 'wood'] },
                    { id: 'lamp_wall', path: 'props/lamp_wall.png', type: 'prop', size: [16, 24], frames: 1, tags: ['lamp'] }
                ]
            });

            expect(audit.success).toBe(true);
            expect(audit.summary.referenceOnly).toBe(1);
            expect(audit.summary.canBuildPlayablePrototype).toBe(false);
            expect(audit.missingEssentials.map(m => m.id)).toContain('player_idle');
            expect(audit.recommendations.some(r => r.includes('concept'))).toBe(true);
        });

        test('marks unclassified assets as needs-metadata', () => {
            const audit = auditAssetManifest({
                assets: [
                    { id: 'mystery_blob', path: 'misc/mystery_blob.png', type: 'asset', size: [33, 19], frames: 1, tags: [] }
                ]
            });

            expect(audit.summary.needsMetadata).toBe(1);
            expect(audit.buckets.needsMetadata[0].issues[0]).toMatch(/Unclassified asset/);
        });

        test('recognizes a complete minimal 2D prototype asset set', () => {
            const audit = auditAssetManifest({
                assets: [
                    { id: 'floor_wood', path: 'tiles/floor_wood.png', type: 'tile', size: [16, 16], frames: 1, tags: ['floor'] },
                    { id: 'wall_stone', path: 'tiles/wall_stone.png', type: 'tile', size: [16, 16], frames: 1, tags: ['wall'] },
                    { id: 'player_idle', path: 'characters/player_idle.png', type: 'character', size: [16, 24], frames: 1, tags: ['player', 'idle'] },
                    { id: 'player_walk', path: 'characters/player_walk_4f.png', type: 'character', size: [64, 24], frames: 4, tags: ['player', 'walk'] },
                    { id: 'door_wood', path: 'props/door_wood.png', type: 'prop', size: [16, 32], frames: 1, tags: ['door'] },
                    { id: 'lamp_wall', path: 'props/lamp_wall_4f.png', type: 'prop', size: [64, 24], frames: 4, tags: ['lamp', 'fire'] }
                ]
            });

            expect(audit.summary.canBuildPlayablePrototype).toBe(true);
            expect(audit.missingEssentials).toEqual([]);
        });
    });

    describe('generateWorldFromManifest', () => {
        test('creates a structured animated 2D world from available assets', () => {
            const result = generateWorldFromManifest({
                manifest,
                title: 'Haunted Bookstore',
                theme: 'cozy haunted bookstore',
                size: [24, 18]
            });

            expect(result.success).toBe(true);
            expect(result.world.title).toBe('Haunted Bookstore');
            expect(result.world.size.width).toBe(24);
            expect(result.world.layers.terrain).toHaveLength(18);
            expect(result.world.objects.some(o => o.asset === 'lamp_wall_brass' && o.light)).toBe(true);
            expect(result.world.assetsUsed).toContain('floor_wood');
        });

        test('returns error when manifest has no assets', () => {
            const result = generateWorldFromManifest({ manifest: { assets: [] }, size: [20, 14] });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/no assets/i);
        });

        test('returns error when manifest is null/undefined', () => {
            const result = generateWorldFromManifest({ manifest: null, size: [20, 14] });
            expect(result.success).toBe(false);
        });

        test('works with a single-asset manifest (only floor tile)', () => {
            const minManifest = {
                assetDir: 'game_assets',
                assets: [{ id: 'floor_stone', path: 'tiles/floor_stone.png', type: 'tile', tags: ['floor', 'stone'], frames: 1 }]
            };
            const result = generateWorldFromManifest({ manifest: minManifest, size: [16, 12] });
            expect(result.success).toBe(true);
            expect(result.world.assetsUsed).toContain('floor_stone');
        });

        test('collision border is fully blocked', () => {
            const result = generateWorldFromManifest({ manifest, size: [20, 14] });
            const col = result.world.layers.collision;
            const h = 14;
            const w = 20;
            // Top and bottom rows
            expect(col[0].every(v => v === 1)).toBe(true);
            expect(col[h - 1].every(v => v === 1)).toBe(true);
            // Left and right columns
            expect(col.every(row => row[0] === 1)).toBe(true);
            expect(col.every(row => row[w - 1] === 1)).toBe(true);
        });

        test('interior wall tiles are set as collision=1', () => {
            const result = generateWorldFromManifest({ manifest, size: [20, 14] });
            const col = result.world.layers.collision;
            // Row 2 at x=2,7,12,17 (step 5) should be blocked
            expect(col[2][2]).toBe(1);
            expect(col[2][7]).toBe(1);
        });

        test('paths between zones are navigable (collision=0)', () => {
            const result = generateWorldFromManifest({ manifest, size: [24, 18] });
            // entranceCenter is always within bounds — spot check that some path cell is 0
            const col = result.world.layers.collision;
            const entranceY = 18 - 5; // height - 5 = 13
            expect(col[entranceY][6]).toBe(0);
        });

        test('world includes schema, zones, paths, animationNotes, prototypeFirst', () => {
            const { world } = generateWorldFromManifest({ manifest, size: [20, 14] });
            expect(world.schema).toBe('max-game-world-v1');
            expect(Array.isArray(world.zones)).toBe(true);
            expect(world.zones.length).toBeGreaterThan(0);
            expect(Array.isArray(world.paths)).toBe(true);
            expect(Array.isArray(world.animationNotes)).toBe(true);
            expect(typeof world.prototypeFirst).toBe('string');
        });
    });

    describe('validateWorld', () => {
        test('reports success when all object assets exist', () => {
            const { world } = generateWorldFromManifest({ manifest, size: [20, 14] });
            const report = validateWorld(world, manifest);

            expect(report.success).toBe(true);
            expect(report.missingAssets).toEqual([]);
            expect(report.checks.animatedObjects).toBeGreaterThan(0);
        });

        test('reports missing assets', () => {
            const { world } = generateWorldFromManifest({ manifest, size: [20, 14] });
            world.objects.push({ asset: 'missing_lamp', x: 1, y: 1 });

            const report = validateWorld(world, manifest);

            expect(report.success).toBe(false);
            expect(report.missingAssets).toContain('missing_lamp');
        });

        test('deduplicates missing asset IDs', () => {
            const { world } = generateWorldFromManifest({ manifest, size: [20, 14] });
            world.objects.push({ asset: 'ghost_tile', x: 1, y: 1 });
            world.objects.push({ asset: 'ghost_tile', x: 2, y: 2 });

            const report = validateWorld(world, manifest);
            expect(report.missingAssets.filter(a => a === 'ghost_tile')).toHaveLength(1);
        });

        test('reports dimension failure when collision grid is wrong size', () => {
            const { world } = generateWorldFromManifest({ manifest, size: [20, 14] });
            world.layers.collision = []; // empty = wrong dimensions
            const report = validateWorld(world, manifest);
            expect(report.checks.dimensions).toBe(false);
            expect(report.success).toBe(false);
        });

        test('handles null world gracefully', () => {
            const report = validateWorld(null, manifest);
            expect(report.success).toBe(false);
        });
    });

    describe('renderWorldHtml', () => {
        test('includes sprite paths and flicker animation style', () => {
            const { world } = generateWorldFromManifest({ manifest, title: 'Lamp Test', size: [16, 12] });
            const html = renderWorldHtml(world, manifest);

            expect(html).toContain('game_assets/props/lamp_wall_brass_4f.png');
            expect(html).toContain('@keyframes flicker');
            expect(html).toContain('Lamp Test');
        });

        test('escapes HTML special characters in title and theme', () => {
            const { world } = generateWorldFromManifest({ manifest, title: '<XSS>"Test"', theme: 'Tom & Jerry', size: [16, 12] });
            const html = renderWorldHtml(world, manifest);

            expect(html).toContain('&lt;XSS&gt;&quot;Test&quot;');
            expect(html).toContain('Tom &amp; Jerry');
            expect(html).not.toContain('<XSS>');
        });

        test('produces valid HTML structure', () => {
            const { world } = generateWorldFromManifest({ manifest, title: 'Forest Level', size: [16, 12] });
            const html = renderWorldHtml(world, manifest);

            expect(html).toContain('<!doctype html>');
            expect(html).toContain('<div class="map">');
            expect(html).toContain('image-rendering:pixelated');
        });
    });

    describe('generate_world action audit gate', () => {
        let outDir;

        beforeEach(async () => {
            outDir = tmpDir();
            await fs.mkdir(outDir, { recursive: true });
        });
        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('blocks generation when manifest only has reference/concept art', async () => {
            const badManifest = {
                schema: 'max-game-assets-v1',
                assetDir: 'game_assets',
                assets: [
                    { id: 'concept_art', path: 'references/concept_art.png', type: 'reference', size: [1920, 1080], frames: 1, tags: ['concept'] }
                ]
            };
            const manifestPath = path.join(outDir, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(badManifest));

            const result = await GameWorldTool.actions.generate_world({ manifestPath, outDir });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/audit failed/i);
            expect(result.audit.missingEssentials.length).toBeGreaterThan(0);
            expect(result.audit.recommendations.some(r => r.toLowerCase().includes('prototype'))).toBe(true);
        });

        test('allows generation when audit passes with full production asset set', async () => {
            const goodManifest = {
                schema: 'max-game-assets-v1',
                assetDir: 'game_assets',
                assets: [
                    { id: 'floor_wood',  path: 'tiles/floor_wood.png',               type: 'tile',      size: [16, 16], frames: 1, tags: ['floor'] },
                    { id: 'wall_stone',  path: 'tiles/wall_stone.png',               type: 'tile',      size: [16, 16], frames: 1, tags: ['wall'] },
                    { id: 'player_idle', path: 'characters/player_idle.png',         type: 'character', size: [16, 24], frames: 1, tags: ['player', 'idle'] },
                    { id: 'player_walk', path: 'characters/player_walk_4f.png',      type: 'character', size: [64, 24], frames: 4, tags: ['player', 'walk'] },
                    { id: 'door_wood',   path: 'props/door_wood.png',                type: 'prop',      size: [16, 32], frames: 1, tags: ['door'] },
                    { id: 'lamp_wall',   path: 'props/lamp_wall_4f.png',             type: 'prop',      size: [64, 24], frames: 4, tags: ['lamp', 'fire'] }
                ]
            };
            const manifestPath = path.join(outDir, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(goodManifest));

            const result = await GameWorldTool.actions.generate_world({ manifestPath, outDir, title: 'Gate Test' });
            expect(result.success).toBe(true);
            expect(result.world).toBeDefined();
        });

        test('skipAudit bypasses the gate', async () => {
            const badManifest = {
                schema: 'max-game-assets-v1',
                assetDir: 'game_assets',
                assets: [
                    { id: 'floor_wood', path: 'tiles/floor_wood.png', type: 'tile', size: [16, 16], frames: 1, tags: ['floor'] }
                ]
            };
            const manifestPath = path.join(outDir, 'manifest.json');
            await fs.writeFile(manifestPath, JSON.stringify(badManifest));

            const result = await GameWorldTool.actions.generate_world({ manifestPath, outDir, skipAudit: true, title: 'Skip Test' });
            expect(result.success).toBe(true);
        });
    });
});
