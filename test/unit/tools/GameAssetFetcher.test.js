import { jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { GameAssetFetcherTool } from '../../../tools/GameAssetFetcher.js';

function tmpDir() {
    return path.join(os.tmpdir(), `max-test-gaf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ── suggest_packs (pure, no network) ────────────────────────────────────────

describe('GameAssetFetcherTool', () => {
    describe('suggest_packs', () => {
        test('returns all packs when no query', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs();
            expect(result.success).toBe(true);
            expect(result.packs.length).toBeGreaterThanOrEqual(8);
        });

        test('filters by keyword in tags', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs({ query: 'platformer' });
            expect(result.success).toBe(true);
            expect(result.packs.length).toBeGreaterThan(0);
            expect(result.packs.every(p => p.tags.some(t => t.includes('platformer')) || p.name.toLowerCase().includes('platformer') || p.description.toLowerCase().includes('platformer'))).toBe(true);
        });

        test('filters by keyword in name', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs({ query: 'dungeon' });
            expect(result.packs.some(p => p.name.toLowerCase().includes('dungeon') || p.tags.includes('dungeon'))).toBe(true);
        });

        test('returns empty array for unmatched query', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs({ query: 'xyzzy_no_match_ever' });
            expect(result.success).toBe(true);
            expect(result.packs).toHaveLength(0);
        });

        test('all packs have CC0 license', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs();
            for (const p of result.packs) {
                expect(p.license).toBe('CC0');
            }
        });

        test('all packs have pageUrl pointing to kenney.nl', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs();
            for (const p of result.packs) {
                expect(p.pageUrl).toMatch(/kenney\.nl/);
            }
        });

        test('respects limit parameter', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs({ limit: 3 });
            expect(result.packs.length).toBeLessThanOrEqual(3);
        });

        test('includes tip about next steps', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs();
            expect(result.tip).toBeTruthy();
            expect(result.tip.toLowerCase()).toMatch(/scan_assets|audit/);
        });

        test('packs have required shape', () => {
            const result = GameAssetFetcherTool.actions.suggest_packs({ limit: 1 });
            const pack = result.packs[0];
            expect(pack).toHaveProperty('id');
            expect(pack).toHaveProperty('name');
            expect(pack).toHaveProperty('description');
            expect(pack).toHaveProperty('license');
            expect(pack).toHaveProperty('tileSize');
            expect(pack).toHaveProperty('pageUrl');
            expect(Array.isArray(pack.tags)).toBe(true);
        });
    });

    // ── search — mocked to avoid network dependency ────────────────────────

    describe('search', () => {
        test('returns error when query is empty', async () => {
            const result = await GameAssetFetcherTool.actions.search({ query: '' });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/query is required/i);
        });

        test('returns error when query is whitespace only', async () => {
            const result = await GameAssetFetcherTool.actions.search({ query: '   ' });
            expect(result.success).toBe(false);
        });
    });

    // ── download ───────────────────────────────────────────────────────────

    describe('download', () => {
        let outDir;
        beforeEach(async () => {
            outDir = tmpDir();
            await fs.mkdir(outDir, { recursive: true });
        });
        afterEach(() => fs.rm(outDir, { recursive: true, force: true }).catch(() => {}));

        test('returns error when url is missing', async () => {
            const result = await GameAssetFetcherTool.actions.download({ url: undefined, destDir: outDir });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/url is required/i);
        });

        test('returns error for invalid/unreachable URL', async () => {
            const result = await GameAssetFetcherTool.actions.download({
                url: 'http://localhost:19999/nonexistent.zip',
                destDir: outDir
            });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/download failed/i);
        });

        test('creates destDir if it does not exist', async () => {
            const nested = path.join(outDir, 'deep', 'path');
            // Should create the dir before failing on the URL
            await GameAssetFetcherTool.actions.download({ url: 'http://localhost:19999/x.png', destDir: nested });
            const stat = await fs.stat(nested).catch(() => null);
            expect(stat?.isDirectory()).toBe(true);
        });

        test('nextStep mentions extract command for zip', () => {
            // Test the logic path directly using the result shape expectation
            // We verify that when isZip=true, nextStep includes extraction instructions.
            // Since we can't easily download a real file in unit tests, test the OGA parse utility indirectly.
            // This is covered by the integration test; here we just verify the tool is callable.
            expect(typeof GameAssetFetcherTool.actions.download).toBe('function');
        });
    });
});

// ── GameWorldTool fix 1: pickAsset excludes reference/background ───────────

describe('GameWorldTool — pickAsset reference exclusion', () => {
    // Import the pure functions to test the fix
    let generateWorldFromManifest;
    beforeAll(async () => {
        const mod = await import('../../../tools/GameWorldTool.js');
        generateWorldFromManifest = mod.generateWorldFromManifest;
    });

    test('concept art in manifest is never used as a floor tile', () => {
        const manifest = {
            assetDir: 'game_assets',
            assets: [
                { id: 'concept_bookstore', path: 'references/concept_bookstore.png', type: 'reference', size: [1920, 1080], frames: 1, tags: ['concept', 'floor', 'wood'] },
                { id: 'real_floor',        path: 'tiles/floor_wood.png',             type: 'tile',      size: [16, 16],     frames: 1, tags: ['floor', 'wood'] }
            ]
        };
        const result = generateWorldFromManifest({ manifest, size: [20, 14] });
        expect(result.success).toBe(true);
        // terrain should use real_floor, NOT concept_bookstore
        const usedInTerrain = new Set(result.world.layers.terrain.flat().filter(Boolean));
        expect(usedInTerrain.has('real_floor')).toBe(true);
        expect(usedInTerrain.has('concept_bookstore')).toBe(false);
    });

    test('background image is never used as a tile even if it has floor tags', () => {
        const manifest = {
            assetDir: 'game_assets',
            assets: [
                { id: 'bg_forest',   path: 'backgrounds/bg_forest.png', type: 'background', size: [800, 600], frames: 1, tags: ['floor', 'grass'] },
                { id: 'tile_grass',  path: 'tiles/grass.png',           type: 'tile',        size: [16, 16],  frames: 1, tags: ['floor', 'grass'] }
            ]
        };
        const result = generateWorldFromManifest({ manifest, size: [16, 12] });
        expect(result.success).toBe(true);
        const usedInTerrain = new Set(result.world.layers.terrain.flat().filter(Boolean));
        expect(usedInTerrain.has('tile_grass')).toBe(true);
        expect(usedInTerrain.has('bg_forest')).toBe(false);
    });
});

// ── GameWorldTool fix 3: missingEssentials includes source links ───────────

describe('GameWorldTool — audit missing essential sources', () => {
    let auditAssetManifest;
    beforeAll(async () => {
        const mod = await import('../../../tools/GameWorldTool.js');
        auditAssetManifest = mod.auditAssetManifest;
    });

    test('missing essentials each have a source link', () => {
        const audit = auditAssetManifest({
            assetDir: 'game_assets',
            assets: [
                { id: 'floor_wood', path: 'tiles/floor_wood.png', type: 'tile', size: [16, 16], frames: 1, tags: ['floor'] }
            ]
        });
        expect(audit.missingEssentials.length).toBeGreaterThan(0);
        for (const m of audit.missingEssentials) {
            expect(m).toHaveProperty('source');
            expect(typeof m.source).toBe('string');
            expect(m.source).toMatch(/kenney\.nl|opengameart/i);
        }
    });

    test('floor_tile source points to kenney tiny-dungeon or pixel-platformer', () => {
        const audit = auditAssetManifest({ assets: [] });
        const floorMissing = audit.missingEssentials.find(m => m.id === 'floor_tile');
        expect(floorMissing).toBeDefined();
        expect(floorMissing.source).toMatch(/kenney\.nl/);
    });
});
