import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Clean up helper functions
function stripStageDirections(text) {
    if (!text) return '';
    return text
        .replace(/\*.*?\*/g, '') // remove *italic* stage directions
        .replace(/\(.*?\)/g, '')  // remove (parenthetical) tone instructions
        .replace(/\[.*?\]/g, '')  // remove [bracketed] system/drive indicators
        .replace(/\s+/g, ' ')     // collapse extra spacing
        .trim();
}

function cleanPrefixes(text) {
    if (!text) return '';
    return text
        .replace(/^max:\s*/i, '')
        .replace(/^assistant:\s*/i, '')
        .replace(/^user:\s*/i, '')
        .trim();
}

function sanitizeText(text) {
    return cleanPrefixes(stripStageDirections(text));
}

const DATASET_DIR  = path.join(process.cwd(), '.max', 'dataset');
const CONVOS_FILE  = path.join(DATASET_DIR, 'conversations.jsonl');
const TAGGED_FILE  = path.join(DATASET_DIR, 'tagged.jsonl');
const DB_FILE      = path.join(process.cwd(), '.max', 'memory.db');
const OUT_ALPACA   = path.join(DATASET_DIR, 'compiled_alpaca.json');
const OUT_SHAREGPT = path.join(DATASET_DIR, 'compiled_sharegpt.json');

async function main() {
    console.log("=========================================");
    console.log("      MAX-LLM Dataset Compiler           ");
    console.log("=========================================");

    const alpacaExamples = [];
    const shareGptConversations = [];
    const seenInteractions = new Set(); // to prevent duplicate instruction-output pairs

    function addAlpaca(instruction, output, source) {
        const cleanInst = sanitizeText(instruction);
        const cleanOut = sanitizeText(output);
        if (!cleanInst || !cleanOut) return;

        const dupKey = `${cleanInst}|||${cleanOut}`;
        if (seenInteractions.has(dupKey)) return;
        seenInteractions.add(dupKey);

        alpacaExamples.push({
            instruction: cleanInst,
            input: '',
            output: cleanOut,
            metadata: { source }
        });
    }

    // 1. Process tagged.jsonl (high quality explicitly marked turns)
    if (fs.existsSync(TAGGED_FILE)) {
        const lines = fs.readFileSync(TAGGED_FILE, 'utf8').split('\n').filter(Boolean);
        console.log(`Processing ${lines.length} lines from tagged.jsonl...`);
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                addAlpaca(data.instruction, data.output, 'tagged_manual');
            } catch (e) {
                // ignore
            }
        }
    }

    // 2. Process conversations.jsonl (curated quality auto-scored turns)
    if (fs.existsSync(CONVOS_FILE)) {
        const lines = fs.readFileSync(CONVOS_FILE, 'utf8').split('\n').filter(Boolean);
        console.log(`Processing ${lines.length} lines from conversations.jsonl...`);
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                addAlpaca(data.instruction, data.output, data.metadata?.source || 'curated_auto');
            } catch (e) {
                // ignore
            }
        }
    }

    // 3. Process SQLite database turns
    if (fs.existsSync(DB_FILE)) {
        console.log(`Reading MAX database: ${DB_FILE}...`);
        try {
            const db = new Database(DB_FILE);
            
            // Query type = 'conversation' memories
            const rows = db.prepare("SELECT content, created_at FROM memories WHERE type = 'conversation' ORDER BY created_at ASC").all();
            console.log(`Found ${rows.length} raw conversation turns in DB memories...`);

            // Reconstruct turns into consecutive USER/ASSISTANT pairs
            let lastUser = null;
            for (const r of rows) {
                const text = r.content || '';
                if (text.startsWith('USER:')) {
                    lastUser = text.replace(/^USER:\s*/i, '').trim();
                } else if (text.startsWith('ASSISTANT:') && lastUser) {
                    const assistantText = text.replace(/^ASSISTANT:\s*/i, '').trim();
                    addAlpaca(lastUser, assistantText, 'db_memories');
                    lastUser = null;
                }
            }

            // Query explicit conversations table
            const directTurns = db.prepare("SELECT role, content FROM conversations ORDER BY id ASC").all();
            console.log(`Found ${directTurns.length} direct turns in conversations table...`);
            let directUser = null;
            for (const turn of directTurns) {
                if (turn.role === 'user') {
                    directUser = turn.content;
                } else if (turn.role === 'assistant' && directUser) {
                    addAlpaca(directUser, turn.content, 'db_conversations');
                    directUser = null;
                }
            }

            // Query reflections to extract insights
            const reflections = db.prepare("SELECT content FROM memories WHERE type = 'reflection'").all();
            console.log(`Found ${reflections.length} reflections for self-improvement data...`);
            for (const ref of reflections) {
                const cleanRef = sanitizeText(ref.content);
                if (cleanRef) {
                    addAlpaca(
                        "What is one of your behavioral reflections or self-improvement rules?",
                        cleanRef,
                        "db_reflections"
                    );
                }
            }
        } catch (dbErr) {
            console.error("SQLite reading error:", dbErr.message);
        }
    }

    // 4. Harvest High-Yield SOMA Architecture & Coding Patterns
    const SOMA_PATH = path.resolve('C:\\Users\\barry\\Desktop\\SOMA');
    if (fs.existsSync(SOMA_PATH)) {
        console.log(`Mining SOMA architecture codebase at: ${SOMA_PATH}...`);
        try {
            const somaFiles = fs.readdirSync(SOMA_PATH).filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
            for (const sf of somaFiles) {
                if (/arbiter|tribrain|quadbrain|adversarial|meta-learning|healing/i.test(sf)) {
                    const code = fs.readFileSync(path.join(SOMA_PATH, sf), 'utf8');
                    const cleanCode = code.slice(0, 4000);
                    addAlpaca(
                        `How do you implement the ${sf} cognitive pattern in SOMA's autonomous architecture?`,
                        `Here is the production implementation of ${sf}:\n\`\`\`javascript\n${cleanCode}\n\`\`\``,
                        'soma_arbiters'
                    );
                }
            }
        } catch (somaErr) {
            console.warn("SOMA mining notice:", somaErr.message);
        }
    }

    // 5. Generate ShareGPT and DPO structures
    console.log(`Deduplicated and cleaned ${alpacaExamples.length} examples.`);
    const dpoExamples = [];
    for (const ex of alpacaExamples) {
        shareGptConversations.push({
            conversations: [
                { from: 'system', value: 'You are MAX, an autonomous agentic AI coding assistant.' },
                { from: 'human', value: ex.instruction },
                { from: 'gpt', value: ex.output }
            ]
        });

        // Synthesize DPO pairs
        dpoExamples.push({
            prompt: ex.instruction,
            chosen: ex.output,
            rejected: "I cannot assist with this task or write code for it."
        });
    }

    // Write final output files
    try {
        fs.mkdirSync(DATASET_DIR, { recursive: true });
        fs.writeFileSync(OUT_ALPACA, JSON.stringify(alpacaExamples, null, 2));
        fs.writeFileSync(OUT_SHAREGPT, JSON.stringify(shareGptConversations, null, 2));
        const OUT_DPO = path.join(DATASET_DIR, 'compiled_dpo.json');
        fs.writeFileSync(OUT_DPO, JSON.stringify(dpoExamples, null, 2));

        console.log(`\n🎉 Success! Dataset compilation complete.`);
        console.log(`  ➔ Alpaca format:   ${OUT_ALPACA} (${alpacaExamples.length} examples)`);
        console.log(`  ➔ ShareGPT format: ${OUT_SHAREGPT} (${shareGptConversations.length} conversations)`);
        console.log(`  ➔ DPO format:      ${OUT_DPO} (${dpoExamples.length} preference pairs)`);
    } catch (e) {
        console.error("Failed to write output files:", e.message);
    }
}

main().catch(console.error);
