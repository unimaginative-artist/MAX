import fetch from 'node-fetch';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';

const DEFAULT_DEST = 'game_assets/downloads';
const TIMEOUT_MS = 15_000;
const UA = 'MAX-Agent/1.0 (game development assistant; educational use)';
const OGA_BASE = 'https://opengameart.org';

// ── Curated Kenney.nl packs ― all CC0, no attribution required ─────────────
// Stable asset page URLs. Use suggest_packs to find packs, then download the
// zip from the Kenney page (or use the download action with the direct URL).
const KENNEY_PACKS = [
    {
        id: 'tiny-dungeon',
        name: 'Tiny Dungeon',
        description: '16×16 top-down dungeon: characters, tiles, items, UI. 1-bit clean style.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/tiny-dungeon',
        tags: ['dungeon', 'top-down', 'RPG', 'tileset', 'characters', 'items', '16x16']
    },
    {
        id: 'pixel-platformer',
        name: 'Pixel Platformer',
        description: 'Clean 16×16 side-scroller: player animations, enemies, tiles, props.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/pixel-platformer',
        tags: ['platformer', 'side-scroller', 'player', 'enemies', 'tiles', '16x16', 'walk', 'idle']
    },
    {
        id: '1-bit-platformer',
        name: '1-Bit Platformer Pack',
        description: 'Monochrome 16×16 platformer — over 1,000 sprites. Best for jam prototypes.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/1-bit-platformer-pack',
        tags: ['platformer', '1bit', 'monochrome', 'large', 'player', 'enemies', 'tiles']
    },
    {
        id: 'roguelike-rpg',
        name: 'Roguelike / RPG Pack',
        description: '1,700+ sprites — dungeons, items, characters, equipment. Enormous CC0 pack.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/roguelike-rpg-pack',
        tags: ['RPG', 'roguelike', 'dungeon', 'items', 'characters', 'equipment', 'large', 'top-down']
    },
    {
        id: 'topdown-shooter',
        name: 'Top-Down Shooter',
        description: 'Military top-down: vehicles, characters, weapons, environment tiles.',
        license: 'CC0',
        tileSize: '64x64',
        pageUrl: 'https://kenney.nl/assets/topdown-shooter',
        tags: ['top-down', 'shooter', 'military', 'player', 'weapons', 'enemies', 'vehicles']
    },
    {
        id: 'space-shooter-redux',
        name: 'Space Shooter Redux',
        description: 'Complete vertical shmup: ships, bullets, bosses, backgrounds, pickups.',
        license: 'CC0',
        tileSize: 'varies',
        pageUrl: 'https://kenney.nl/assets/space-shooter-redux',
        tags: ['space', 'shooter', 'shmup', 'ships', 'enemies', 'boss', 'bullets', 'background']
    },
    {
        id: 'fantasy-town-rural',
        name: 'Fantasy Town Rural Pack',
        description: '16×16 RPG tileset: towns, forests, roads, interiors, characters.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/fantasy-town-rural-pack',
        tags: ['RPG', 'fantasy', 'town', 'forest', 'road', 'interior', 'top-down', '16x16', 'cozy']
    },
    {
        id: 'tiny-town',
        name: 'Tiny Town',
        description: 'Top-down town tiles: buildings, roads, parks, shops. Cute and clean.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/tiny-town',
        tags: ['town', 'top-down', 'buildings', 'roads', 'shop', 'cozy', '16x16']
    },
    {
        id: 'micro-roguelike',
        name: 'Micro Roguelike',
        description: 'Tiny 8×8 roguelike: characters, dungeons, items. Minimal and readable.',
        license: 'CC0',
        tileSize: '8x8',
        pageUrl: 'https://kenney.nl/assets/micro-roguelike',
        tags: ['roguelike', 'dungeon', 'tiny', '8x8', 'characters', 'items']
    },
    {
        id: 'platformer-art-pixel-redux',
        name: 'Platformer Art: Pixel Redux',
        description: 'Colorful 16×16 pixel platformer: tiles, player, enemies, props, backgrounds.',
        license: 'CC0',
        tileSize: '16x16',
        pageUrl: 'https://kenney.nl/assets/platformer-art-pixel-redux',
        tags: ['platformer', 'pixel', 'colorful', 'tiles', 'player', 'enemies', 'backgrounds']
    },
    {
        id: 'puzzle-pack',
        name: 'Puzzle Pack',
        description: 'Puzzle game pieces: gems, blocks, icons, grid tiles.',
        license: 'CC0',
        tileSize: 'varies',
        pageUrl: 'https://kenney.nl/assets/puzzle-pack',
        tags: ['puzzle', 'gems', 'blocks', 'match-3', 'casual', 'casual']
    },
    {
        id: 'tower-defense',
        name: 'Tower Defense',
        description: 'Top-down tower defense: enemies, towers, paths, projectiles.',
        license: 'CC0',
        tileSize: 'varies',
        pageUrl: 'https://kenney.nl/assets/tower-defense',
        tags: ['tower-defense', 'top-down', 'strategy', 'enemies', 'towers']
    }
];

function toPosix(p) { return p.replace(/\\/g, '/'); }

// ── fetch with abort-controller timeout ───────────────────────────────────
async function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...opts, signal: controller.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
    } finally {
        clearTimeout(id);
    }
}

// ── OpenGameArt HTML parser ───────────────────────────────────────────────
// OGA uses Drupal views. We split on 'views-row' and regex-extract each item.
function parseOGAHtml(html, limit) {
    const results = [];
    const rows = html.split(/class="views-row/);
    for (let i = 1; i < rows.length && results.length < limit; i++) {
        const row = rows[i];
        const titleMatch = row.match(/<a href="(\/content\/[^"]+)">([^<]+)<\/a>/);
        if (!titleMatch) continue;
        const licenseMatches = [...row.matchAll(/CC0|CC-BY(?:[\s\d.]*)?|GPL(?:\s*v[\d.]+)?/gi)].map(m => m[0].toUpperCase());
        const imgMatch = row.match(/src="([^"]+\.(?:png|jpg|gif)[^"]*)"/i);
        results.push({
            title:      titleMatch[2].trim(),
            pageUrl:    `${OGA_BASE}${titleMatch[1]}`,
            license:    licenseMatches.length ? [...new Set(licenseMatches)].join(', ') : 'Unknown',
            previewUrl: imgMatch ? imgMatch[1] : null,
            source:     'OpenGameArt.org',
            note:       'Visit the page URL to get the direct download link, then use game_assets_fetch.download.'
        });
    }
    return results;
}

// ── Public tool ───────────────────────────────────────────────────────────

export const GameAssetFetcherTool = {
    name: 'game_assets_fetch',
    description: `Find and download free CC0 sprite packs for game development.
Actions:
  suggest_packs  -> list curated Kenney.nl CC0 packs filtered by game type / keyword
  search         -> live-search OpenGameArt.org for free sprites by keyword
  download       -> download a file (image or zip) directly into game_assets/downloads/`,

    actions: {
        // ── suggest_packs — pure, no network ──────────────────────────────
        suggest_packs({ query = '', limit = 8 } = {}) {
            try {
                const q = query.toLowerCase().trim();
                const filtered = q
                    ? KENNEY_PACKS.filter(p =>
                        p.tags.some(t => t.includes(q)) ||
                        p.name.toLowerCase().includes(q) ||
                        p.description.toLowerCase().includes(q))
                    : KENNEY_PACKS;

                return {
                    success: true,
                    source: 'Kenney.nl (all CC0 — no attribution required)',
                    packs: filtered.slice(0, limit).map(p => ({
                        id:          p.id,
                        name:        p.name,
                        description: p.description,
                        license:     p.license,
                        tileSize:    p.tileSize,
                        pageUrl:     p.pageUrl,
                        tags:        p.tags
                    })),
                    tip: 'Use game_assets_fetch.download with a direct zip URL, or visit the pageUrl to copy it. After downloading, run: game_world.scan_assets then game_world.audit_assets.'
                };
            } catch (err) {
                return { success: false, error: `suggest_packs failed: ${err.message}` };
            }
        },

        // ── search — live OpenGameArt scrape ──────────────────────────────
        async search({ query = '', cc0Only = true, limit = 10 } = {}) {
            try {
                if (!query.trim()) return { success: false, error: 'query is required' };

                const params = new URLSearchParams({ keys: query, page: '0' });
                params.append('field_art_type_tid[]', '9');  // 2D art
                if (cc0Only) params.append('field_art_licenses_tid[]', '2');  // CC0

                const url = `${OGA_BASE}/art-search-advanced?${params}`;
                const res = await fetchWithTimeout(url);
                if (!res.ok) throw new Error(`OpenGameArt returned HTTP ${res.status}`);

                const html = await res.text();
                const results = parseOGAHtml(html, limit);

                return {
                    success: true,
                    query,
                    cc0Only,
                    source: 'OpenGameArt.org',
                    results,
                    tip: results.length === 0
                        ? 'No results found. Try broader keywords or set cc0Only:false.'
                        : 'Copy a pageUrl, visit it to get the direct download link, then use game_assets_fetch.download.'
                };
            } catch (err) {
                if (err.name === 'AbortError') return { success: false, error: 'OpenGameArt request timed out. Check your internet connection.' };
                return { success: false, error: `search failed: ${err.message}` };
            }
        },

        // ── download — fetch a URL to disk ───────────────────────────────
        async download({ url, destDir = DEFAULT_DEST, filename = null } = {}) {
            try {
                if (!url) return { success: false, error: 'url is required' };

                await fs.mkdir(destDir, { recursive: true });

                const res = await fetchWithTimeout(url);
                if (!res.ok) throw new Error(`Server returned HTTP ${res.status} for ${url}`);

                // Determine filename from Content-Disposition or URL
                const cd = res.headers.get('content-disposition') || '';
                const cdName = cd.match(/filename[^;=\n]*=["']?([^"';\n]+)/)?.[1]?.trim();
                const urlName = path.basename(new URL(url).pathname).split('?')[0] || 'asset_download';
                const destName = filename || cdName || urlName;
                const destPath = path.join(destDir, destName);

                const writer = createWriteStream(destPath);
                await pipeline(res.body, writer);

                const ext = path.extname(destName).toLowerCase();
                const isZip = ext === '.zip';

                return {
                    success: true,
                    destPath: toPosix(destPath),
                    filename: destName,
                    isZip,
                    nextStep: isZip
                        ? `Extract with PowerShell: Expand-Archive -Path "${toPosix(destPath)}" -DestinationPath "game_assets/" -Force\n` +
                          `Or bash: unzip "${toPosix(destPath)}" -d game_assets/\n` +
                          `Then run: game_world.scan_assets  and  game_world.audit_assets`
                        : `Run: game_world.scan_assets  then  game_world.audit_assets`
                };
            } catch (err) {
                if (err.name === 'AbortError') return { success: false, error: 'Download timed out. Try again or check the URL.' };
                return { success: false, error: `download failed: ${err.message}` };
            }
        }
    }
};
