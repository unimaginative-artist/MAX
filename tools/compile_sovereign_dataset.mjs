// ═══════════════════════════════════════════════════════════════════════════
// compile_sovereign_dataset.mjs — MAX Sovereign 3-Tier Dataset Engine
// Compiles SFT (Alpaca/ShareGPT) and Contrastive DPO datasets.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATASET_DIR = path.resolve(path.join(process.cwd(), '.max', 'dataset'));
const OUT_ALPACA = path.join(DATASET_DIR, 'sovereign_v2_alpaca.json');
const OUT_SHAREGPT = path.join(DATASET_DIR, 'sovereign_v2_sharegpt.json');
const OUT_DPO = path.join(DATASET_DIR, 'sovereign_v2_dpo.json');

// ── High-IQ Conversational Seed Knowledge (Systems, Finance, Architecture) ───
const HIGH_IQ_CONVERSATIONS = [
    {
        prompt: "How should we monetize an autonomous AI system like SOMA without getting trapped in low-margin SaaS?",
        chosen: "To monetize a sovereign AI architecture like SOMA with high margins, focus on three high-leverage vectors:\n\n1. **Automated Smart Contract & Codebase Auditing (Bug Bounties):** Use SOMA's Security Council (KEVIN) and adversarial swarms to continuously scan newly deployed EVM contracts and open-source repos on Immunefi/HackenProof for high-severity vulnerabilities.\n2. **Algorithmic Crypto Micro-Arbitrage & Market Making:** Deploy SOMA's Finance Module arbiters on high-volatility DEX/CEX pairs (Binance, Solana DEXs) using low-latency statistical arbitrage and smart compounding rather than manual scalping.\n3. **Domain-Specific Autonomous Tool Synthesis:** Package specialized autonomous arbiters into paid Node.js/Python MCP servers for quantitative hedge funds and engineering teams.",
        rejected: "You can try data entry jobs, creating email newsletters on Mailchimp, doing paid surveys online, or writing articles in IEEE journals."
    },
    {
        prompt: "What is the architectural difference between a naive LLM wrapper and a sovereign multi-agent cognitive architecture?",
        chosen: "A naive LLM wrapper is stateless and single-pass: it pipes a user prompt into a completion API and returns text. A sovereign cognitive architecture like SOMA/MAX operates as an autonomous closed-loop operating system with:\n\n1. **Tiered Memory:** Ephemeral context, rolling working memory, persistent vector embeddings (HNSW/MiniLM), and structured episodic SQLite storage.\n2. **Neuro-Symbolic Supervisor:** Pre-flight AST grammar validation and VM sandboxing before code reaches disk.\n3. **Autonomous Heartbeat Loop:** Self-directed curiosity, goal prioritization, and background task execution without requiring user prompts.\n4. **Adversarial Multi-Agent Swarms:** Competing agents (e.g. Architect vs Maintainer vs Security) debating solutions to prevent hallucinations.",
        rejected: "A naive wrapper just calls an API. A multi-agent system uses multiple agents. As an AI language model, both approaches have pros and cons."
    },
    {
        prompt: "How do you prevent a small 2B or 7B local language model from degrading or repeating during multi-turn chats?",
        chosen: "To maintain peak coherence in 2B/7B models across long sessions:\n\n1. **Allocate Large Context (`num_ctx: 8192`):** Prevent silent context clipping where system directives get amputated.\n2. **Enforce Structured Roles (`messages` array):** Pass native `[{ role: 'system' }, { role: 'user' }, { role: 'assistant' }]` rather than raw concatenated text.\n3. **Inference Hyperparameters:** Set `repeat_penalty: 1.15`, `repeat_last_n: 64`, and `top_p: 0.9` to break greedy token repetition cycles.\n4. **Dynamic Context Pruning:** Maintain a rolling FIFO window of recent turns and inject compressed vector summaries of earlier turns rather than raw text bloat.",
        rejected: "You can make it better by clearing the chat or asking it to stop repeating itself. Sometimes restarting the computer helps."
    },
    {
        prompt: "Write a high-performance JavaScript function to compute exponential moving average (EMA) over a streaming price series.",
        chosen: "```javascript\nexport class StreamingEMA {\n    constructor(period) {\n        this.period = period;\n        this.multiplier = 2 / (period + 1);\n        this.ema = null;\n    }\n\n    update(price) {\n        if (this.ema === null) {\n            this.ema = price;\n            return this.ema;\n        }\n        this.ema = (price - this.ema) * this.multiplier + this.ema;\n        return this.ema;\n    }\n\n    getValue() {\n        return this.ema;\n    }\n}\n```\n*Constant time O(1) memory and latency per streaming tick with zero array reallocation.*",
        rejected: "You can calculate EMA using an array and loop through all previous prices on every single tick."
    },
    {
        prompt: "How do you coordinate tasks across a 2-node physical machine cluster safely?",
        chosen: "Safe multi-node cluster coordination requires:\n\n1. **HMAC-SHA256 Payload Signing:** Every inter-node HTTP request must carry a timestamped signature verified with a shared cluster secret (`X-Max-Cluster-Secret`).\n2. **Strict Single-Leader Role Separation:** Designate one machine as Prime Coordinator and the other as Worker. Only the Coordinator handles external gateways (Discord, webhooks) to prevent split-brain duplicates.\n3. **Heartbeat & Failover Heartbeats:** Workers periodically ping `/api/swarm/status`. If a worker fails to acknowledge within a deadline, tasks are reassigned.",
        rejected: "Just send network packets between the computers. As an AI language model, you should be careful with network security."
    }
];

function sanitize(text) {
    if (!text) return '';
    return String(text)
        .replace(/\*.*?\*/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/^max:\s*/i, '')
        .replace(/^assistant:\s*/i, '')
        .replace(/^user:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function compile() {
    console.log("=================================================");
    console.log("   MAX Sovereign 3-Tier Dataset Compiler v2.0    ");
    console.log("=================================================");

    const alpaca = [];
    const shareGpt = [];
    const dpo = [];
    const seen = new Set();

    function addRecord(prompt, chosen, rejected = null, source = 'general') {
        const cleanPrompt = sanitize(prompt);
        const cleanChosen = typeof chosen === 'string' && chosen.includes('```') ? chosen.trim() : sanitize(chosen);
        if (!cleanPrompt || !cleanChosen) return;

        const key = `${cleanPrompt.slice(0, 100)}|||${cleanChosen.slice(0, 100)}`;
        if (seen.has(key)) return;
        seen.add(key);

        alpaca.push({
            instruction: cleanPrompt,
            input: '',
            output: cleanChosen,
            metadata: { source }
        });

        shareGpt.push({
            conversations: [
                { from: 'system', value: 'You are MAX, an autonomous sovereign AI engineering intelligence.' },
                { from: 'human', value: cleanPrompt },
                { from: 'gpt', value: cleanChosen }
            ]
        });

        const fallbackRejected = "I am sorry, but as an AI language model I cannot provide technical code or assistance for this request.";
        dpo.push({
            prompt: cleanPrompt,
            chosen: cleanChosen,
            rejected: rejected ? sanitize(rejected) : fallbackRejected,
            metadata: { source }
        });
    }

    // ── 1. Ingest High-IQ Conversational Reasoning ───────────────────────────
    console.log(`[Tier 1] Ingesting ${HIGH_IQ_CONVERSATIONS.length} High-IQ reasoning seeds...`);
    for (const item of HIGH_IQ_CONVERSATIONS) {
        addRecord(item.prompt, item.chosen, item.rejected, 'high_iq_seeds');
    }

    // ── 2. Ingest Live Discord DPO Harvested Feedback ────────────────────────
    const discordDpoPath = path.join(DATASET_DIR, 'compiled_dpo.json');
    if (fs.existsSync(discordDpoPath)) {
        try {
            const discordItems = JSON.parse(fs.readFileSync(discordDpoPath, 'utf8'));
            console.log(`[Tier 2] Ingesting ${discordItems.length} live Discord preference pairs...`);
            for (const item of discordItems) {
                addRecord(item.prompt, item.chosen, item.rejected, 'discord_reaction_harvest');
            }
        } catch (e) {
            console.warn('[Tier 2] Notice reading Discord DPO file:', e.message);
        }
    }

    // ── 3. Mine SOMA Codebase (310 Arbiters + Test Suites) ───────────────────
    const SOMA_PATH = path.resolve('C:\\Users\\barry\\Desktop\\SOMA');
    if (fs.existsSync(SOMA_PATH)) {
        console.log(`[Tier 3] Mining SOMA codebase at ${SOMA_PATH}...`);
        try {
            const files = fs.readdirSync(SOMA_PATH).filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs'));
            for (const file of files) {
                if (/arbiter|tribrain|quadbrain|finance|security|memory|agent|healing/i.test(file)) {
                    const content = fs.readFileSync(path.join(SOMA_PATH, file), 'utf8');
                    const cleanCode = content.slice(0, 3500);
                    addRecord(
                        `How do you implement the ${file} cognitive arbiter in SOMA?`,
                        `Here is the production implementation of ${file}:\n\`\`\`javascript\n${cleanCode}\n\`\`\``,
                        `You can write ${file} using basic functions. As an AI model, I recommend searching GitHub for examples.`,
                        'soma_codebase'
                    );
                }
            }
        } catch (err) {
            console.warn('[Tier 3] SOMA mining error:', err.message);
        }
    }

    // ── 4. Ingest Local SQLite Memories & Behavioral Reflections ─────────────
    const DB_PATH = path.join(process.cwd(), '.max', 'memory.db');
    if (fs.existsSync(DB_PATH)) {
        try {
            const db = new Database(DB_PATH, { readonly: true });
            const memories = db.prepare('SELECT content FROM memories LIMIT 500').all();
            console.log(`[Tier 3] Ingesting ${memories.length} SQLite episodic memories...`);
            for (const mem of memories) {
                if (mem.content && mem.content.length > 20) {
                    addRecord(
                        "Recall an architectural reflection or learned insight from your memory ledger.",
                        mem.content,
                        "I have no memory of previous system executions.",
                        'sqlite_memory'
                    );
                }
            }
            db.close();
        } catch (e) {
            console.warn('[Tier 3] SQLite notice:', e.message);
        }
    }

    // ── 5. Write Final Compiled Datasets ──────────────────────────────────────
    fs.mkdirSync(DATASET_DIR, { recursive: true });
    fs.writeFileSync(OUT_ALPACA, JSON.stringify(alpaca, null, 2), 'utf8');
    fs.writeFileSync(OUT_SHAREGPT, JSON.stringify(shareGpt, null, 2), 'utf8');
    fs.writeFileSync(OUT_DPO, JSON.stringify(dpo, null, 2), 'utf8');

    console.log("\n🎉 DATASET COMPILATION COMPLETE!");
    console.log(` ➔ Alpaca Format:   ${OUT_ALPACA} (${alpaca.length} records)`);
    console.log(` ➔ ShareGPT Format: ${OUT_SHAREGPT} (${shareGpt.length} records)`);
    console.log(` ➔ DPO Format:      ${OUT_DPO} (${dpo.length} preference pairs)`);
}

compile().catch(console.error);
