// ═══════════════════════════════════════════════════════════════════════════
// benchmark_local_max.mjs — Local Model Benchmark & Capability Assessment
// Tests Ollama local models on Machine B (soma-logos, qwen2.5-coder, gemma3, deepseek-r1)
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';

const testPrompts = [
    {
        name: "Coding - Debounce Function",
        prompt: "Write a complete, production-grade debounce function in JavaScript (ESM). Include JSDoc and support immediate execution option. Output only code and a 1-sentence explanation."
    },
    {
        name: "Tool Call Formatting",
        prompt: "You are MAX. To inspect the file 'core/Brain.js', output the exact tool call line in the format: TOOL:file:read:{\"path\":\"core/Brain.js\"}. Output ONLY the tool line."
    },
    {
        name: "System Reasoning & Architecture",
        prompt: "In 2 concise bullet points, explain the trade-off between In-Memory Vector Storage vs SQLite-backed persistent vectors for an autonomous agent with 10,000 memories."
    }
];

const modelsToTest = ['max-coder:latest', 'qwen2.5-coder:1.5b'];

async function runBenchmark() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        LOCAL MODEL CAPABILITY BENCHMARK (OLLAMA / GPU)       ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    for (const model of modelsToTest) {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🤖 TESTING MODEL: [${model}]`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        for (const test of testPrompts) {
            console.log(`\n▶ TEST: ${test.name}`);
            const start = Date.now();

            try {
                const res = await fetch(OLLAMA_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model,
                        prompt: test.prompt,
                        stream: false,
                        options: { temperature: 0.2, num_predict: 250 }
                    })
                }).then(r => r.json());

                const durationSec = ((Date.now() - start) / 1000).toFixed(2);
                const evalCount = res.eval_count || 0;
                const evalDuration = res.eval_duration ? (res.eval_duration / 1e9).toFixed(2) : durationSec;
                const tokPerSec = evalDuration > 0 ? (evalCount / evalDuration).toFixed(1) : 'N/A';

                console.log(`⚡ Latency: ${durationSec}s | Output Tokens: ${evalCount} | Speed: ${tokPerSec} tok/s`);
                console.log(`📝 Output:\n${res.response?.trim() || '(empty)'}`);
            } catch (err) {
                console.log(`❌ Error testing ${model}: ${err.message}`);
            }
        }
    }
    console.log('\n✅ Local Benchmark Complete!');
}

runBenchmark();
