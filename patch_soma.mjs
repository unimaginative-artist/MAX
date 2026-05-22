
import fs from 'fs';
import path from 'path';

const filePath = 'C:/Users/barry/Desktop/SOMA/arbiters/FragmentRegistry.js';

try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    if (content.includes('listFragments()')) {
        console.log('listFragments() already exists.');
        process.exit(0);
    }

    const searchStr = '_serializeFragment(f) {';
    const insertStr = '  listFragments() {\n    return Array.from(this.fragments.values());\n  }\n\n';
    
    if (content.includes(searchStr)) {
        const parts = content.split(searchStr);
        const newContent = parts[0] + insertStr + searchStr + parts[1];
        fs.writeFileSync(filePath, newContent);
        console.log('Successfully patched FragmentRegistry.js');
    } else {
        console.error('Could not find insertion point.');
        process.exit(1);
    }
} catch (err) {
    console.error('Error patching file:', err.message);
    process.exit(1);
}
