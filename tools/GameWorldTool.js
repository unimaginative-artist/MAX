import fs from 'fs/promises';
import path from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const AUDIO_EXTS = new Set(['.ogg', '.wav', '.mp3']);
const DEFAULT_MANIFEST = 'game_assets/manifest.json';
const DEFAULT_OUT_DIR = '.max/game-worlds';

const BOOTSTRAP_HINT = `
game_assets/ not found. To get started:
  1. Create a folder: game_assets/tiles/  game_assets/props/  game_assets/characters/
  2. Drop your PNG sprites inside (name animated sheets like: lamp_4f.png for 4 frames).
  3. Run: game_world.scan_assets  to build a manifest.
Free 16×16 pixel art: https://itch.io/game-assets/free/tag-16x16
`.trim();

function toPosix(p) {
    return p.replace(/\\/g, '/');
}

function slugify(input) {
    return String(input || 'world')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'world';
}

function inferType(relPath) {
    const p = toPosix(relPath).toLowerCase();
    if (p.includes('/reference') || p.includes('/references') || p.includes('/concept') || p.includes('/mood')) return 'reference';
    if (p.includes('/background') || p.includes('/backdrop')) return 'background';
    if (p.includes('/tile')) return 'tile';
    if (p.includes('/character') || p.includes('/npc') || p.includes('/player')) return 'character';
    if (p.includes('/effect') || p.includes('/particle')) return 'effect';
    if (p.includes('/prop') || p.includes('/object')) return 'prop';
    if (p.includes('/ui')) return 'ui';
    return 'asset';
}

function inferTags(relPath, name) {
    const source = `${relPath} ${name}`.toLowerCase();
    const tags = new Set();
    const candidates = [
        'floor', 'wall', 'water', 'grass', 'stone', 'wood', 'roof', 'door', 'window',
        'lamp', 'torch', 'fire', 'glow', 'smoke', 'book', 'shelf', 'crate', 'sign',
        'tree', 'rock', 'bridge', 'stairs', 'npc', 'player', 'idle', 'walk', 'attack',
        'interior', 'exterior', 'night', 'warm', 'cold', 'shop', 'ruin', 'city',
        'concept', 'reference', 'background', 'backdrop', 'mood'
    ];
    for (const tag of candidates) {
        if (source.includes(tag)) tags.add(tag);
    }
    return [...tags];
}

function inferFrames(name) {
    const match = String(name).match(/(?:_|-)(\d+)f(?:rame)?s?/i);
    return match ? Number(match[1]) : 1;
}

async function readPngSize(filePath) {
    try {
        const fh = await fs.open(filePath, 'r');
        const buf = Buffer.alloc(24);
        await fh.read(buf, 0, 24, 0);
        await fh.close();
        if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
        return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    } catch {
        return null;
    }
}

async function walkAssets(root, dir = root, includeAudio = false) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            files.push(...await walkAssets(root, full, includeAudio));
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (IMAGE_EXTS.has(ext) || (includeAudio && AUDIO_EXTS.has(ext))) {
                files.push(full);
            }
        }
    }
    return files;
}

export async function scanGameAssets(assetDir = 'game_assets', { audio = true } = {}) {
    const root = path.resolve(process.cwd(), assetDir);

    // Check existence — guide user if folder is missing
    try { await fs.access(root); } catch {
        return { assetDir: toPosix(assetDir), count: 0, assets: [], audio: [], missing: true, hint: BOOTSTRAP_HINT };
    }

    const files = await walkAssets(root, root, audio);
    const assets = [];
    const audioAssets = [];

    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const rel = toPosix(path.relative(root, file));
        const baseName = path.parse(rel).name;

        if (AUDIO_EXTS.has(ext)) {
            audioAssets.push({ id: slugify(baseName), path: rel, type: 'audio' });
            continue;
        }

        const size = ext === '.png' ? await readPngSize(file) : null;
        const frames = inferFrames(baseName);
        const id = slugify(baseName.replace(/(?:_|-)\d+f(?:rame)?s?$/i, ''));
        assets.push({
            id,
            path: rel,
            type: inferType(rel),
            size,
            frames,
            animations: frames > 1 ? { idle: { frames, fps: 8, loop: true } } : {},
            tags: inferTags(rel, baseName)
        });
    }

    assets.sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
    audioAssets.sort((a, b) => a.id.localeCompare(b.id));
    return { assetDir: toPosix(assetDir), count: assets.length, assets, audio: audioAssets };
}

// Types that must never be used as gameplay sprites
const NON_SPRITE_TYPES = new Set(['reference', 'background', 'support']);

function pickAsset(manifest, preferredTags, fallbackType = null) {
    const assets = (manifest.assets || []).filter(a => !NON_SPRITE_TYPES.has(a.type));
    const scored = assets.map(asset => {
        const tags = new Set([asset.type, ...(asset.tags || [])]);
        let score = 0;
        for (const tag of preferredTags) if (tags.has(tag)) score += 2;
        if (fallbackType && asset.type === fallbackType) score += 1;
        return { asset, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
    return scored[0]?.asset || assets.find(a => !fallbackType || a.type === fallbackType) || null;
}

function makeLayer(width, height, fill = null) {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

function rect(layer, x, y, w, h, value) {
    for (let yy = Math.max(0, y); yy < Math.min(layer.length, y + h); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(layer[yy].length, x + w); xx++) {
            layer[yy][xx] = value;
        }
    }
}

function line(layer, x1, y1, x2, y2, value) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let i = 0; i <= steps; i++) {
        const x = Math.round(x1 + ((x2 - x1) * i) / steps);
        const y = Math.round(y1 + ((y2 - y1) * i) / steps);
        if (layer[y]?.[x] !== undefined) layer[y][x] = value;
    }
}

export function generateWorldFromManifest({ manifest, title = 'Untitled World', style = 'top-down 2D', size = [32, 24], theme = 'cozy mystery' }) {
    if (!manifest?.assets?.length) {
        return { success: false, error: 'Manifest has no assets. Run game_world.scan_assets or create_manifest first.' };
    }

    const [width, height] = size;
    const floor = pickAsset(manifest, ['floor', 'wood', 'stone', 'grass'], 'tile');
    const wall = pickAsset(manifest, ['wall', 'shelf', 'stone', 'wood'], 'tile') || floor;
    const door = pickAsset(manifest, ['door', 'gate'], 'prop');
    const lamp = pickAsset(manifest, ['lamp', 'torch', 'fire', 'glow'], 'prop');
    const shelf = pickAsset(manifest, ['shelf', 'book'], 'prop');
    const sign = pickAsset(manifest, ['sign'], 'prop');
    const npc = pickAsset(manifest, ['npc', 'idle', 'character'], 'character');

    const terrain = makeLayer(width, height, floor?.id || null);
    const collision = makeLayer(width, height, 0);
    const objects = [];
    const zones = [
        { id: 'entrance', name: 'Entrance', bounds: [2, height - 7, 8, 5], mood: 'safe' },
        { id: 'main_room', name: 'Main Room', bounds: [Math.floor(width * 0.25), Math.floor(height * 0.35), Math.floor(width * 0.45), Math.floor(height * 0.35)], mood: 'curious' },
        { id: 'secret_corner', name: 'Secret Corner', bounds: [width - 10, 3, 7, 6], mood: 'mysterious' }
    ];

    rect(collision, 0, 0, width, 1, 1);
    rect(collision, 0, height - 1, width, 1, 1);
    rect(collision, 0, 0, 1, height, 1);
    rect(collision, width - 1, 0, 1, height, 1);

    // Interior wall row — blocks row 2 in collision then punches gaps for traversal
    for (let x = 2; x < width - 2; x += 5) {
        if (wall) terrain[2][x] = wall.id;
        collision[2][x] = 1;
    }

    const entranceCenter = [6, height - 5];
    const mainCenter = [Math.floor(width * 0.48), Math.floor(height * 0.52)];
    const secretCenter = [width - 7, 6];
    // Clear paths through the interior wall so zones are reachable
    line(collision, entranceCenter[0], entranceCenter[1], mainCenter[0], mainCenter[1], 0);
    line(collision, mainCenter[0], mainCenter[1], secretCenter[0], secretCenter[1], 0);

    if (door) objects.push({ asset: door.id, x: entranceCenter[0], y: height - 2, layer: 'props', role: 'entrance' });
    if (lamp) {
        objects.push({
            asset: lamp.id,
            x: mainCenter[0] - 4,
            y: mainCenter[1] - 3,
            layer: 'props',
            animation: lamp.frames > 1 ? 'idle' : 'flicker_runtime',
            light: { color: '#ffb45a', radius: 56, intensity: [0.72, 1.0], flickerNoise: 0.12 }
        });
        objects.push({
            asset: lamp.id,
            x: secretCenter[0],
            y: secretCenter[1],
            layer: 'props',
            animation: lamp.frames > 1 ? 'idle' : 'flicker_runtime',
            light: { color: '#ff9d4d', radius: 42, intensity: [0.55, 0.95], flickerNoise: 0.18 }
        });
    }
    if (shelf) {
        objects.push({ asset: shelf.id, x: mainCenter[0] + 3, y: mainCenter[1], layer: 'props', collision: true, role: 'reward_anchor' });
        objects.push({ asset: shelf.id, x: secretCenter[0] - 2, y: secretCenter[1] + 2, layer: 'props', collision: true, role: 'secret' });
    }
    if (sign) objects.push({ asset: sign.id, x: entranceCenter[0] + 2, y: entranceCenter[1] - 2, layer: 'props', role: 'landmark' });
    if (npc) objects.push({ asset: npc.id, x: mainCenter[0], y: mainCenter[1] + 2, layer: 'characters', animation: 'idle', role: 'guide' });

    return {
        success: true,
        world: {
            schema: 'max-game-world-v1',
            title,
            style,
            theme,
            size: { width, height, tileSize: 16 },
            assetDir: manifest.assetDir,
            assetsUsed: [...new Set([floor, wall, door, lamp, shelf, sign, npc].filter(Boolean).map(a => a.id))],
            zones,
            paths: [
                { from: 'entrance', to: 'main_room', type: 'primary' },
                { from: 'main_room', to: 'secret_corner', type: 'secret_shortcut' }
            ],
            layers: { terrain, collision },
            objects,
            animationNotes: [
                'Light sources should use random flicker curves so repeated lamps do not sync.',
                'Add one-frame glow overlays for non-animated lamp sprites if no flicker sheet exists.',
                'Environmental motion budget: lamp flicker, idle NPC, one subtle particle effect per room.'
            ],
            prototypeFirst: 'Load this map, place the player at entrance, make collision visible, then verify the player can reach main_room and secret_corner.'
        }
    };
}

export function validateWorld(world, manifest) {
    const assets = new Set((manifest?.assets || []).map(a => a.id));
    const missing = [];
    for (const obj of world?.objects || []) {
        if (!assets.has(obj.asset)) missing.push(obj.asset);
    }
    for (const id of world?.assetsUsed || []) {
        if (!assets.has(id)) missing.push(id);
    }

    const width = world?.size?.width || 0;
    const height = world?.size?.height || 0;
    const collision = world?.layers?.collision || [];
    const hasBounds = width > 0 && height > 0 && collision.length === height && collision.every(row => row.length === width);

    return {
        success: missing.length === 0 && hasBounds,
        missingAssets: [...new Set(missing)],
        checks: {
            dimensions: hasBounds,
            zones: Array.isArray(world?.zones) && world.zones.length > 0,
            objects: Array.isArray(world?.objects),
            animatedObjects: (world?.objects || []).filter(o => o.animation || o.light).length
        }
    };
}

function assetArea(asset) {
    return Array.isArray(asset.size) && asset.size.length === 2
        ? Number(asset.size[0] || 0) * Number(asset.size[1] || 0)
        : 0;
}

function hasTag(asset, ...tags) {
    const all = new Set([asset.type, ...(asset.tags || []), asset.id || '', asset.path || '']);
    const haystack = [...all].join(' ').toLowerCase();
    return tags.some(tag => haystack.includes(tag));
}

function classifyAsset(asset) {
    const issues = [];
    const notes = [];
    const area = assetArea(asset);
    const frames = Number(asset.frames || 1);
    const size = asset.size || null;

    if (asset.type === 'audio') {
        return { bucket: 'support', readiness: 'support', issues: [], notes: ['Audio support asset'] };
    }

    const isReference = asset.type === 'reference'
        || hasTag(asset, 'concept', 'reference', 'mood')
        || (area >= 512 * 512 && frames <= 1 && !['tile', 'prop', 'character', 'effect', 'ui'].includes(asset.type));

    if (isReference) {
        return {
            bucket: 'referenceOnly',
            readiness: 'reference-only',
            issues: ['Use as visual direction only; do not slice into gameplay sprites without a sprite-sheet pass'],
            notes: size ? [`Large/reference image ${size[0]}x${size[1]}`] : ['Reference image']
        };
    }

    if (!size) {
        issues.push('Unknown dimensions; PNG size could not be read or file is not PNG');
    }

    if (asset.type === 'tile') {
        if (size && (size[0] !== size[1] || size[0] > 128 || size[0] < 8)) {
            issues.push(`Tile dimensions look unusual (${size[0]}x${size[1]}); expected square 8-128px`);
        }
    } else if (asset.type === 'character') {
        if (!hasTag(asset, 'idle', 'walk', 'player', 'npc')) {
            issues.push('Character asset needs role tags such as player/npc and idle/walk');
        }
        if (frames <= 1 && hasTag(asset, 'walk', 'run', 'attack')) {
            issues.push('Animation-named character asset has only one detected frame');
        }
    } else if (asset.type === 'prop') {
        if (hasTag(asset, 'lamp', 'torch', 'fire') && frames <= 1) {
            notes.push('Can be used with runtime flicker/glow, but a multi-frame sprite would look better');
        }
    } else if (asset.type === 'effect') {
        if (frames <= 1 && hasTag(asset, 'fire', 'smoke', 'glow', 'water')) {
            issues.push('Effect asset probably needs multiple frames');
        }
    } else if (asset.type === 'background') {
        return {
            bucket: 'referenceOnly',
            readiness: 'background/reference',
            issues: ['Background is usable as a backdrop layer, not as collision-ready gameplay sprites'],
            notes: size ? [`Backdrop ${size[0]}x${size[1]}`] : ['Backdrop layer']
        };
    } else {
        issues.push('Unclassified asset; place it under tiles/, props/, characters/, effects/, ui/, backgrounds/, or references/');
    }

    if (issues.length > 0) {
        return { bucket: 'needsMetadata', readiness: 'needs-metadata', issues, notes };
    }

    return {
        bucket: 'productionReady',
        readiness: 'production-ready',
        issues: [],
        notes: frames > 1 ? [`Detected ${frames} animation frames`] : []
    };
}

// Free CC0 sources linked per missing essential — always tell MAX where to look
const ESSENTIAL_SOURCES = {
    floor_tile:           'https://kenney.nl/assets/tiny-dungeon (top-down) or https://kenney.nl/assets/pixel-platformer (side-scroller)',
    wall_or_blocker_tile: 'https://kenney.nl/assets/tiny-dungeon or https://kenney.nl/assets/roguelike-rpg-pack',
    player_idle:          'https://kenney.nl/assets/pixel-platformer or https://kenney.nl/assets/roguelike-rpg-pack',
    player_walk_cycle:    'https://kenney.nl/assets/pixel-platformer (4-frame walk included)',
    interactable_prop:    'https://kenney.nl/assets/roguelike-rpg-pack (doors, chests, levers) or https://kenney.nl/assets/fantasy-town-rural-pack',
    animated_light_source:'https://kenney.nl/assets/roguelike-rpg-pack (torches) or https://opengameart.org/content/animated-flame'
};

function missingEssentialsForPrototype(assets) {
    const missing = [];
    const hasFloor = assets.some(a => a.type === 'tile' && hasTag(a, 'floor', 'grass', 'stone', 'wood'));
    const hasWall = assets.some(a => a.type === 'tile' && hasTag(a, 'wall', 'shelf', 'rock'));
    const hasPlayer = assets.some(a => a.type === 'character' && hasTag(a, 'player'));
    const hasPlayerWalk = assets.some(a => a.type === 'character' && hasTag(a, 'player', 'walk') && Number(a.frames || 1) > 1);
    const hasInteractable = assets.some(a => a.type === 'prop' && hasTag(a, 'door', 'sign', 'book', 'shelf', 'crate', 'lamp', 'switch'));
    const hasLight = assets.some(a => a.type === 'prop' && hasTag(a, 'lamp', 'torch', 'fire', 'glow'));

    const add = (id, reason) => missing.push({ id, reason, source: ESSENTIAL_SOURCES[id] || null });

    if (!hasFloor)       add('floor_tile',           'Need at least one floor/ground tile for playable space');
    if (!hasWall)        add('wall_or_blocker_tile',  'Need walls/blockers for readable collision');
    if (!hasPlayer)      add('player_idle',           'Need a player sprite before a playable prototype feels real');
    if (!hasPlayerWalk)  add('player_walk_cycle',     'Need a multi-frame walk cycle for movement feel');
    if (!hasInteractable) add('interactable_prop',    'Need at least one prop to test interaction feedback');
    if (!hasLight)       add('animated_light_source', 'A lamp/torch/glow prop helps prove environmental life');

    return missing;
}

export function auditAssetManifest(manifest) {
    const assets = manifest?.assets || [];
    const buckets = {
        productionReady: [],
        needsMetadata: [],
        needsSlicing: [],
        referenceOnly: [],
        support: []
    };

    for (const asset of assets) {
        const classification = classifyAsset(asset);
        const entry = {
            id: asset.id,
            path: asset.path,
            type: asset.type,
            size: asset.size || null,
            frames: asset.frames || 1,
            readiness: classification.readiness,
            issues: classification.issues,
            notes: classification.notes
        };

        if (classification.bucket === 'referenceOnly' && asset.type !== 'reference' && hasTag(asset, 'sheet', 'spritesheet', 'atlas')) {
            buckets.needsSlicing.push({ ...entry, readiness: 'needs-slicing' });
        } else {
            buckets[classification.bucket].push(entry);
        }
    }

    const missingEssentials = missingEssentialsForPrototype(assets);
    const canBuildStaticMockup = buckets.productionReady.some(a => a.type === 'tile')
        && buckets.productionReady.some(a => a.type === 'prop' || a.type === 'character');
    const canBuildPlayablePrototype = missingEssentials.length === 0;

    const recommendations = [];
    if (buckets.referenceOnly.length > 0) {
        recommendations.push('Treat concept/background art as reference layers. Do not blindly slice them into sprites.');
    }
    if (buckets.needsMetadata.length > 0) {
        recommendations.push('Add or correct folder placement, tags, frame counts, and dimensions for needs-metadata assets.');
    }
    if (!canBuildPlayablePrototype) {
        recommendations.push('Build a static scene or asset manifest first; do not attempt a full playable prototype yet.');
    }
    if (canBuildPlayablePrototype) {
        recommendations.push('Ready for a small playable scene: generate a map, validate collisions, then test movement feel.');
    }

    return {
        success: true,
        summary: {
            totalAssets: assets.length,
            productionReady: buckets.productionReady.length,
            needsMetadata: buckets.needsMetadata.length,
            needsSlicing: buckets.needsSlicing.length,
            referenceOnly: buckets.referenceOnly.length,
            support: buckets.support.length,
            canBuildStaticMockup,
            canBuildPlayablePrototype
        },
        buckets,
        missingEssentials,
        recommendations
    };
}

function assetMap(manifest) {
    return new Map((manifest.assets || []).map(a => [a.id, a]));
}

export function renderWorldHtml(world, manifest) {
    const assets = assetMap(manifest);
    const tileSize = world.size?.tileSize || 16;
    const width = world.size?.width || 32;
    const height = world.size?.height || 24;
    const terrain = world.layers?.terrain || [];
    const cells = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const id = terrain[y]?.[x];
            const asset = id ? assets.get(id) : null;
            // Skip reference/background assets — they are not tile sprites
            const usable = asset && !NON_SPRITE_TYPES.has(asset.type);
            const src = usable ? `${manifest.assetDir}/${asset.path}` : '';
            cells.push(`<div class="tile">${src ? `<img src="../../${src}" alt="${id}">` : ''}</div>`);
        }
    }
    const objects = (world.objects || []).map(obj => {
        const asset = assets.get(obj.asset);
        // Skip reference/background assets in object layer too
        const usable = asset && !NON_SPRITE_TYPES.has(asset.type);
        const src = usable ? `${manifest.assetDir}/${asset.path}` : '';
        const light = obj.light ? '<span class="light"></span>' : '';
        return `<div class="obj" title="${obj.asset}" style="left:${obj.x * tileSize}px;top:${obj.y * tileSize}px">${light}${src ? `<img src="../../${src}" alt="${obj.asset}">` : ''}</div>`;
    }).join('\n');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escHtml(world.title)}</title>
<style>
body{margin:0;background:#101015;color:#ddd;font-family:system-ui,sans-serif;padding:20px}
.meta{margin-bottom:12px}.meta h1{font-size:18px;margin:0 0 4px}.meta p{margin:0;color:#888}
.map{position:relative;display:grid;grid-template-columns:repeat(${width},${tileSize}px);grid-auto-rows:${tileSize}px;width:${width * tileSize}px;height:${height * tileSize}px;background:#17171d;image-rendering:pixelated;border:1px solid #333;overflow:hidden}
.tile{width:${tileSize}px;height:${tileSize}px;overflow:hidden}.tile img,.obj img{width:100%;height:100%;object-fit:cover;image-rendering:pixelated}
.obj{position:absolute;width:${tileSize}px;height:${tileSize}px;z-index:2}
.light{position:absolute;left:-18px;top:-18px;width:52px;height:52px;border-radius:50%;background:radial-gradient(circle,rgba(255,177,80,.55),rgba(255,177,80,0));animation:flicker .18s infinite alternate;z-index:-1}
@keyframes flicker{from{opacity:.65;transform:scale(.94)}to{opacity:1;transform:scale(1.08)}}
</style>
</head>
<body>
<div class="meta"><h1>${escHtml(world.title)}</h1><p>${escHtml(world.theme)} - ${escHtml(world.style)}</p></div>
<div class="map">${cells.join('')}${objects}</div>
</body>
</html>`;
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export const GameWorldTool = {
    name: 'game_world',
    description: `Design 2D game worlds from a real sprite/tile asset library.
Actions:
  scan_assets     -> inspect image assets in a folder
  audit_assets    -> classify assets as production-ready, reference-only, needs metadata, or missing essentials
  create_manifest -> write game_assets/manifest.json
  generate_world  -> create a structured 2D world JSON from available assets
  validate_world  -> check missing assets and structure
  render_preview  -> write an HTML map preview with sprites and flickering lights`,

    actions: {
        async scan_assets({ assetDir = 'game_assets' } = {}) {
            try {
                const result = await scanGameAssets(assetDir);
                if (result.missing) return { success: false, error: result.hint };
                return { success: true, ...result };
            } catch (err) {
                return { success: false, error: `scan_assets failed: ${err.message}` };
            }
        },

        async audit_assets({ manifestPath = DEFAULT_MANIFEST, assetDir = 'game_assets' } = {}) {
            try {
                let manifest;
                try {
                    manifest = await readJson(manifestPath);
                } catch {
                    const scan = await scanGameAssets(assetDir);
                    if (scan.missing) return { success: false, error: scan.hint };
                    manifest = {
                        schema: 'max-game-assets-v1',
                        assetDir: toPosix(assetDir),
                        assets: scan.assets,
                        audio: scan.audio
                    };
                }
                return auditAssetManifest(manifest);
            } catch (err) {
                return { success: false, error: `audit_assets failed: ${err.message}` };
            }
        },

        async create_manifest({ assetDir = 'game_assets', outPath = DEFAULT_MANIFEST } = {}) {
            try {
                const scan = await scanGameAssets(assetDir);
                if (scan.missing) return { success: false, error: scan.hint };
                const manifest = {
                    schema: 'max-game-assets-v1',
                    assetDir: toPosix(assetDir),
                    createdAt: new Date().toISOString(),
                    assets: scan.assets,
                    audio: scan.audio
                };
                await writeJson(outPath, manifest);
                return { success: true, outPath, count: manifest.assets.length, audioCount: manifest.audio.length, manifest };
            } catch (err) {
                return { success: false, error: `create_manifest failed: ${err.message}` };
            }
        },

        async generate_world({ manifestPath = DEFAULT_MANIFEST, title = 'Untitled World', style = 'top-down 2D', size = [32, 24], theme = 'cozy mystery', outPath = null, outDir = DEFAULT_OUT_DIR, skipAudit = false } = {}) {
            try {
                const manifest = await readJson(manifestPath);

                // Audit before generating — block if assets are not production-ready enough
                if (!skipAudit) {
                    const audit = auditAssetManifest(manifest);
                    if (!audit.summary.canBuildPlayablePrototype) {
                        return {
                            success: false,
                            error: 'Asset audit failed: not enough production-ready sprites to generate a world.',
                            audit: {
                                missingEssentials: audit.missingEssentials,
                                referenceOnly: audit.summary.referenceOnly,
                                recommendations: audit.recommendations
                            }
                        };
                    }
                }

                const result = generateWorldFromManifest({ manifest, title, style, size, theme });
                if (!result.success) return result;
                const finalOut = outPath || path.join(outDir, `${slugify(title)}.world.json`);
                await writeJson(finalOut, result.world);
                return { success: true, outPath: toPosix(finalOut), world: result.world };
            } catch (err) {
                return { success: false, error: `generate_world failed: ${err.message}` };
            }
        },

        async validate_world({ worldPath, manifestPath = DEFAULT_MANIFEST, world = null } = {}) {
            try {
                const manifest = await readJson(manifestPath);
                const data = world || await readJson(worldPath);
                return validateWorld(data, manifest);
            } catch (err) {
                return { success: false, error: `validate_world failed: ${err.message}` };
            }
        },

        async render_preview({ worldPath, manifestPath = DEFAULT_MANIFEST, outPath = null } = {}) {
            try {
                const manifest = await readJson(manifestPath);
                const world = await readJson(worldPath);
                const html = renderWorldHtml(world, manifest);
                const finalOut = outPath || worldPath.replace(/\.json$/i, '.html');
                await fs.mkdir(path.dirname(finalOut), { recursive: true });
                await fs.writeFile(finalOut, html, 'utf8');
                return { success: true, outPath: toPosix(finalOut) };
            } catch (err) {
                return { success: false, error: `render_preview failed: ${err.message}` };
            }
        }
    }
};
