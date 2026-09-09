#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// pull_agentic_datasets.mjs — Maxwell Multi-Source Agentic Dataset Harvester
//
// Pulls, curates, and normalizes high-signal external datasets:
// 1. Tool-use & Function Calling (glaive-function-calling-v2)
// 2. Software Engineering & Code Instruction (CodeAlpaca-20k)
// 3. Deep Reasoning & Chain-of-Thought (Bespoke-Stratos-17k <think> traces)
// 4. Local SOMA & MAX Multi-Agent Architecture (SomaMemoryMiner)
//
// Merges with existing local memory into:
// - .max/dataset/master_sharegpt.json
// - .max/dataset/master_alpaca.json
// - .max/dataset/master_dpo.json
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { SomaMemoryMiner } from './SomaMemoryMiner.js';

const DATASET_DIR = path.join(process.cwd(), '.max', 'dataset');
if (!fs.existsSync(DATASET_DIR)) fs.mkdirSync(DATASET_DIR, { recursive: true });

const OUT_MASTER_ALPACA   = path.join(DATASET_DIR, 'master_alpaca.json');
const OUT_MASTER_SHAREGPT = path.join(DATASET_DIR, 'master_sharegpt.json');
const OUT_MASTER_DPO      = path.join(DATASET_DIR, 'master_dpo.json');

async function fetchHfRows(dataset, limit = 1000, split = 'train') {
    const rows = [];
    const pageSize = 100;
    const pages = Math.ceil(limit / pageSize);

    for (let p = 0; p < pages; p++) {
        const offset = p * pageSize;
        const currentLimit = Math.min(pageSize, limit - rows.length);
        const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=${split}&offset=${offset}&limit=${currentLimit}`;
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) {
                console.warn(`  [HF] Failed to fetch page ${p} for ${dataset}: HTTP ${res.status}`);
                break;
            }
            const data = await res.json();
            if (!data.rows || !Array.isArray(data.rows)) break;
            for (const r of data.rows) {
                if (r?.row) rows.push(r.row);
            }
            process.stdout.write(`.`);
            if (rows.length >= limit) break;
        } catch (err) {
            console.warn(`  [HF] Error fetching ${dataset} at offset ${offset}:`, err.message);
            break;
        }
    }
    console.log(`\n  [HF] Ingested ${rows.length} rows from ${dataset}`);
    return rows;
}

function cleanText(txt) {
    if (!txt) return '';
    return String(txt)
        .replace(/\r/g, '')
        .replace(/\*.*?\*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function main() {
    console.log("============================================================");
    console.log("   MAXWELL AGENTIC & ARCHITECTURE DATASET HARVESTER         ");
    console.log("============================================================");

    const masterAlpaca = [];
    const masterShareGpt = [];
    const masterDpo = [];
    const seenInteractions = new Set();

    function addAlpaca(instruction, output, source, input = '') {
        const cInst = cleanText(instruction);
        const cOut  = cleanText(output);
        if (!cInst || !cOut || cInst.length < 5 || cOut.length < 5) return;
        const key = `${cInst.slice(0, 100)}|||${cOut.slice(0, 100)}`;
        if (seenInteractions.has(key)) return;
        seenInteractions.add(key);

        masterAlpaca.push({
            instruction: cInst,
            input: cleanText(input),
            output: cOut,
            metadata: { source }
        });
    }

    function addShareGpt(conversations, source) {
        if (!Array.isArray(conversations) || conversations.length < 2) return;
        masterShareGpt.push({
            conversations,
            metadata: { source }
        });
    }

    function addDpo(prompt, chosen, rejected, source) {
        const cPrompt   = cleanText(prompt);
        const cChosen   = cleanText(chosen);
        const cRejected = cleanText(rejected);
        if (!cPrompt || !cChosen || !cRejected) return;
        masterDpo.push({
            prompt: cPrompt,
            chosen: cChosen,
            rejected: cRejected,
            source
        });
    }

    // ── 1. Ingest Existing Local MAX & DPO Memory ─────────────────────────
    console.log("\n[1/5] Ingesting Existing Maxwell Local Memories & DPO...");
    const localAlpacaPath = path.join(DATASET_DIR, 'compiled_alpaca.json');
    if (fs.existsSync(localAlpacaPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(localAlpacaPath, 'utf8'));
            console.log(`  Ingesting ${data.length} records from compiled_alpaca.json`);
            for (const item of data) {
                addAlpaca(item.instruction, item.output, item.metadata?.source || 'max_local', item.input);
            }
        } catch {}
    }

    const localDpoPath = path.join(DATASET_DIR, 'compiled_dpo.json');
    if (fs.existsSync(localDpoPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(localDpoPath, 'utf8'));
            console.log(`  Ingesting ${data.length} preference pairs from compiled_dpo.json`);
            for (const item of data) {
                addDpo(item.prompt, item.chosen, item.rejected, item.source || 'max_dpo_local');
            }
        } catch {}
    }

    // ── 2. Mine Local SOMA & MAX Architectural Stack ──────────────────────
    console.log("\n[2/5] Mining SOMA & MAX Codebase Architectural Knowledge...");
    try {
        const miner = new SomaMemoryMiner(null, { somaPath: path.resolve(process.cwd(), '..', 'SOMA') });
        const somaAssets = miner.discoverSomaAssets();
        console.log(`  Discovered SOMA assets: ${somaAssets.assets?.arbiters?.length || 0} arbiters, ${somaAssets.assets?.tests?.length || 0} test suites`);
        
        // Mine local core architecture files in MAX
        const coreDir = path.join(process.cwd(), 'core');
        const coreFiles = fs.readdirSync(coreDir).filter(f => f.endsWith('.js'));
        for (const file of coreFiles) {
            const filePath = path.join(coreDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const className = file.replace('.js', '');
            
            // Synthesize architecture instruction
            const inst = `Explain the architecture and responsibilities of the ${className} component in the MAX autonomous system.`;
            const docMatch = content.match(/\/\*\*[\s\S]*?\*\//) || content.match(/\/\/ [^\n]+/g);
            const summary = docMatch ? docMatch.slice(0, 3).join('\n') : `Defines ${className} with specialized agency methods.`;
            
            addAlpaca(inst, summary + `\n\nKey Class definition:\n\`\`\`javascript\nexport class ${className} ...\n\`\`\``, 'max_core_architecture');
            
            // Add DPO pair: structured neuro-symbolic reasoning vs hallucinated unstructured rewrite
            addDpo(
                `Implement modifications to ${className} safely.`,
                `Surgical modification using precise AST block edits with verification via node --check ${file}.`,
                `Full file rewrite using write_file without syntax checking.`,
                'max_code_safety'
            );
        }
    } catch (err) {
        console.warn("  [SOMA Miner] Non-fatal notice:", err.message);
    }

    // ── 3. Pull Function Calling & Tool-Use (Glaive Function Calling) ──────
    console.log("\n[3/5] Pulling Function Calling Trajectories (Glaive v2)...");
    try {
        const glaiveRows = await fetchHfRows('glaiveai/glaive-function-calling-v2', 800);
        for (const row of glaiveRows) {
            const chat = row.chat || '';
            const system = row.system || '';
            if (chat.includes('USER:') && chat.includes('ASSISTANT:')) {
                const turns = [];
                if (system) turns.push({ from: 'system', value: system });
                const parts = chat.split(/(USER:|ASSISTANT:)/g);
                let currentRole = null;
                for (const part of parts) {
                    if (part === 'USER:') currentRole = 'human';
                    else if (part === 'ASSISTANT:') currentRole = 'gpt';
                    else if (currentRole && part.trim()) {
                        turns.push({ from: currentRole, value: part.trim().replace(/<\|endoftext\|>/g, '') });
                    }
                }
                if (turns.length >= 2) {
                    addShareGpt(turns, 'glaive_function_calling');
                    // Add first turn to Alpaca
                    const userTurn = turns.find(t => t.from === 'human')?.value;
                    const gptTurn  = turns.find(t => t.from === 'gpt')?.value;
                    if (userTurn && gptTurn) {
                        addAlpaca(userTurn, gptTurn, 'glaive_function_calling');
                    }
                }
            }
        }
    } catch (err) {
        console.warn("  [Glaive] Non-fatal error:", err.message);
    }

    // ── 4. Pull Software Engineering & Code Instruction (CodeAlpaca) ───────
    console.log("\n[4/5] Pulling Code Engineering Instruction (CodeAlpaca-20k)...");
    try {
        const codeAlpacaRows = await fetchHfRows('sahil2801/CodeAlpaca-20k', 1200);
        for (const row of codeAlpacaRows) {
            if (row.instruction && row.output) {
                addAlpaca(row.instruction, row.output, 'code_alpaca_20k', row.input || '');
                addShareGpt([
                    { from: 'human', value: row.input ? `${row.instruction}\n\nContext:\n${row.input}` : row.instruction },
                    { from: 'gpt', value: row.output }
                ], 'code_alpaca_20k');
            }
        }
    } catch (err) {
        console.warn("  [CodeAlpaca] Non-fatal error:", err.message);
    }

    // ── 5. Pull Deep Reasoning & Chain-of-Thought (Bespoke Stratos) ────────
    console.log("\n[5/5] Pulling Deep Reasoning & Chain-of-Thought Traces (Bespoke Stratos)...");
    try {
        const stratosRows = await fetchHfRows('bespokelabs/Bespoke-Stratos-17k', 600);
        for (const row of stratosRows) {
            const convs = row.conversations;
            if (Array.isArray(convs) && convs.length >= 2) {
                const userMsg = convs.find(c => c.from === 'user')?.value;
                const asstMsg = convs.find(c => c.from === 'assistant')?.value;
                if (userMsg && asstMsg) {
                    // Convert <|begin_of_thought|> to <think>
                    const standardizedOutput = asstMsg
                        .replace(/<\|begin_of_thought\|>/g, '<think>')
                        .replace(/<\|end_of_thought\|>/g, '</think>')
                        .replace(/<\|begin_of_solution\|>/g, '')
                        .replace(/<\|end_of_solution\|>/g, '');

                    addAlpaca(userMsg, standardizedOutput, 'bespoke_stratos_cot');
                    addShareGpt([
                        { from: 'human', value: userMsg },
                        { from: 'gpt', value: standardizedOutput }
                    ], 'bespoke_stratos_cot');

                    // Extract pure solution without thoughts as naive alternative for DPO
                    const thoughtMatch = standardizedOutput.match(/<think>([\s\S]*?)<\/think>/);
                    if (thoughtMatch) {
                        const directAnswer = standardizedOutput.replace(/<think>[\s\S]*?<\/think>/, '').trim();
                        if (directAnswer.length > 20) {
                            addDpo(userMsg, standardizedOutput, directAnswer, 'reasoning_reflection_dpo');
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn("  [Stratos] Non-fatal error:", err.message);
    }

    // ── 6. Export Master Curated Datasets ──────────────────────────────────
    console.log("\n============================================================");
    console.log("   DATASET CURATION SUMMARY & EXPORT                        ");
    console.log("============================================================");
    console.log(`  Master Alpaca Samples:   ${masterAlpaca.length}`);
    console.log(`  Master ShareGPT Turns:   ${masterShareGpt.length}`);
    console.log(`  Master DPO Pairs:        ${masterDpo.length}`);

    fs.writeFileSync(OUT_MASTER_ALPACA, JSON.stringify(masterAlpaca, null, 2), 'utf8');
    fs.writeFileSync(OUT_MASTER_SHAREGPT, JSON.stringify(masterShareGpt, null, 2), 'utf8');
    fs.writeFileSync(OUT_MASTER_DPO, JSON.stringify(masterDpo, null, 2), 'utf8');

    console.log(`\n✅ Saved master datasets into:`);
    console.log(`  - ${OUT_MASTER_ALPACA} (${(fs.statSync(OUT_MASTER_ALPACA).size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  - ${OUT_MASTER_SHAREGPT} (${(fs.statSync(OUT_MASTER_SHAREGPT).size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  - ${OUT_MASTER_DPO} (${(fs.statSync(OUT_MASTER_DPO).size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(err => {
    console.error("FATAL:", err);
    process.exit(1);
});
