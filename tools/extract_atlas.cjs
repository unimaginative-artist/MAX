const sharp = require('sharp');
const path = require('path');

async function extractAtlas() {
    const src = "../../iCloudPhotos/Photos/IMG_2904.JPG";
    const dest = "server/assets";
    
    // Coordinates based on 2048x2732 resolution
    // 1. THE TRAVELER (from panel 1)
    await sharp(src)
        .extract({ left: 300, top: 400, width: 100, height: 140 })
        .toFile(path.join(dest, 'hero_atlas.png'));

    // 2. TILE: Reading Rug (from TILES section)
    await sharp(src)
        .extract({ left: 30, top: 1380, width: 150, height: 150 })
        .toFile(path.join(dest, 'tile_rug.png'));

    // 3. PROP: Tall Shelf (from SHELF VARIANTS)
    await sharp(src)
        .extract({ left: 630, top: 1420, width: 180, height: 250 })
        .toFile(path.join(dest, 'shelf_tall.png'));

    // 4. PROP: Rolling Ladder
    await sharp(src)
        .extract({ left: 450, top: 1750, width: 100, height: 280 })
        .toFile(path.join(dest, 'ladder.png'));

    console.log('Atlas extraction complete.');
}

extractAtlas().catch(console.error);
