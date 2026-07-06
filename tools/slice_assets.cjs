const sharp = require('sharp');
const path = require('path');

async function sliceAssets() {
    const sourcePath = "../../iCloudPhotos/Photos/IMG_2904.JPG";
    const destDir = "game_assets/characters";
    
    // 1. Slice the Traveler (Approx coordinates from the 1. THE BOOKSTORE panel)
    // Looking at the concept sheet, panel 1 is top left.
    // We'll extract the character from the center of that panel.
    await sharp(sourcePath)
        .extract({ left: 110, top: 180, width: 48, height: 64 })
        .toFile(path.join(destDir, 'traveler_idle.png'));

    // 2. Slice a Shelf variant
    await sharp(sourcePath)
        .extract({ left: 250, top: 520, width: 90, height: 110 })
        .toFile(path.join('game_assets/props', 'normal_shelf.png'));

    console.log('Slicing complete: traveler_idle.png and normal_shelf.png created.');
}

sliceAssets().catch(console.error);
