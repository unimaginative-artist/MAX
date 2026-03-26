import fs from 'fs';
import path from 'path';

const srcDir = 'C:/Users/barry/Desktop/MAX/personas/experts';
const dstDir = 'C:/Users/barry/Desktop/SOMA/agents_repo/plugins';

console.log('🔄 Manual Sync: MAX -> SOMA Experts...');

if (!fs.existsSync(srcDir)) {
    console.error('❌ Source not found:', srcDir);
    process.exit(1);
}
if (!fs.existsSync(dstDir)) {
    console.error('❌ Destination not found:', dstDir);
    process.exit(1);
}

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
let synced = 0;

for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const dstPath = path.join(dstDir, `expert_${file}`);
    
    let finalContent = content;
    if (!content.startsWith('---')) {
        const name = file.replace('.md', '');
        finalContent = `---\nname: ${name}\ndomain: SYSTEM\n---\n${content}`;
    }

    fs.writeFileSync(dstPath, finalContent);
    console.log(`✅ Synced: ${file}`);
    synced++;
}

console.log(`✨ Total expert personas synced: ${synced}`);
