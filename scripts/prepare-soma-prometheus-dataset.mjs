// ═══════════════════════════════════════════════════════════════════════════
// prepare-soma-prometheus-dataset.mjs — Copy DPO Trajectories to SOMA Training Directory
// Maps 50 verified DPO pairs into SOMA/training-data/lobe-prometheus-20260810.jsonl
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

async function main() {
    console.log('📦 PREPARING 50 DPO TRAJECTORIES FOR SOMA PROMETHEUS QLORA TRAINING...\n');

    const maxDatasetPath = path.resolve('.max/soma_rlaif_dataset.jsonl');
    if (!fs.existsSync(maxDatasetPath)) {
        console.error('❌ MAX DPO dataset not found at .max/soma_rlaif_dataset.jsonl');
        process.exit(1);
    }

    const lines = fs.readFileSync(maxDatasetPath, 'utf8').trim().split('\n').filter(Boolean);
    console.log(`📁 Read ${lines.length} verified DPO trajectory pairs from .max/soma_rlaif_dataset.jsonl`);

    // DATA HYGIENE (2026-08-12): these are DPO PAIRS ({prompt,chosen,rejected}),
    // not SFT examples. They must land in the dpo/ dir as revision-pairs-*.jsonl —
    // the ONLY pattern SOMA's DPO loader (finetune_gemma3.py load_dpo_dataset,
    // build-lobe-datasets loadDpoPairs) globs. Writing them as
    // training-data/lobe-prometheus-<date>.jsonl put DPO-schema rows in the SFT
    // glob path, which the SFT loader chokes on (KeyError: no output/messages).
    const somaDpoDir = path.resolve('../SOMA/SOMA/training-data/dpo');
    if (!fs.existsSync(somaDpoDir)) {
        fs.mkdirSync(somaDpoDir, { recursive: true });
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const somaTargetFile = path.join(somaDpoDir, `revision-pairs-prometheus-${dateStr}.jsonl`);

    // Emit SOMA's DPO pair schema: {prompt, chosen, rejected, margin}.
    const somaEntries = lines.map((line, idx) => {
        try {
            const item = JSON.parse(line);
            if (!item.prompt || !item.chosen || !item.rejected) return null;
            return JSON.stringify({
                prompt: item.prompt,
                chosen: item.chosen,
                rejected: item.rejected,
                margin: item.margin || 0.55,
                lobe: 'prometheus',
                source: 'max_rlaif',
                id: item.id || `prom_${idx + 1}`
            });
        } catch {
            return null;
        }
    }).filter(Boolean);

    fs.writeFileSync(somaTargetFile, somaEntries.join('\n') + '\n', 'utf8');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ SOMA PROMETHEUS DPO PAIRS PREPARED!`);
    console.log(`   • Target File: ${somaTargetFile}`);
    console.log(`   • Total DPO Pairs: ${somaEntries.length}`);
    console.log(`   • Format: {prompt, chosen, rejected, margin} (revision-pairs schema)`);
    console.log(`   • Consumed by: finetune_gemma3.py --dpo  (via trigger-soma-training.mjs)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
    console.error('❌ Preparation Error:', err.stack || err);
    process.exit(1);
});
