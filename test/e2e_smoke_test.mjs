process.env.MAX_API_BACKGROUND = 'false';
process.env.MAX_AUTONOMOUS_GOALS = 'false';
process.env.MAX_AUTONOMOUS_CI = 'false';
process.env.MAX_DISCORD_ENABLED = 'false';
process.env.MAX_AUTONOMOUS_SELF_IMPROVE = 'false';

import { MAX } from '../core/MAX.js';
import { createServer } from '../server/server.js';
import fetch from 'node-fetch';

async function runE2ETest() {
    console.log('--- STARTING E2E SMOKE TEST FOR MAX EXECUTION ENGINE ---');
    const max = new MAX({ mode: 'test' });
    await max.initialize();

    // Verify tools are registered
    if (!max.tools.has('file') || !max.tools.has('observation')) {
        throw new Error('Required tools (file, observation) are not registered on MAX.tools');
    }
    console.log('✓ FileTools and ObservationTool are registered.');

    // We wire up a mock brain that simulates an LLM following the autonomous execution protocol
    // using the exact task specified by the user directive.
    const task = 'Search the MAX codebase for every reference to tool calling. Record the five most relevant file-and-line findings and return a verified report. Do not modify any files.';
    
    let turn = 0;
    max.brain.think = async (prompt, opts = {}) => {
        turn++;
        if (turn === 1) {
            console.log('  [MockBrain Turn 1] Emitting TOOL:file:grep call...');
            return { text: 'TOOL:file:grep:{"pattern":"parseToolCalls","dir":"."}' };
        }
        if (turn === 2) {
            console.log('  [MockBrain Turn 2] Inspecting grep results and emitting TOOL:observation:record...');
            // Check that prompt contains real TOOL_RESULT receipts from disk
            if (!prompt.includes('TOOL_RESULT:')) {
                throw new Error('Expected prompt to contain factual TOOL_RESULT execution evidence');
            }
            return {
                text: 'TOOL:observation:record:{"summary":"Top five tool calling references recorded","evidence":["tools/ToolRegistry.js:126","tools/ToolRegistry.js:254","core/MAX.js:1393","core/AgentLoop.js:925","test/unit/core/ToolRegistry.test.js:105"]}'
            };
        }
        console.log('  [MockBrain Turn 3] Completing execution...');
        return { text: 'DONE: Search completed. Verified 5 references to tool calling in MAX codebase.' };
    };
    max.agentBrain = max.brain;

    console.log(`\n1. Testing max.execute() directly with task:\n   "${task}"`);
    const directResult = await max.execute(task, { mode: 'inspect' });
    console.log('\nDirect Execution Result:', JSON.stringify(directResult, null, 2));

    // Verify Direct Execution Contract
    if (!directResult.success) throw new Error('Expected directResult.success === true');
    if (directResult.state !== 'completed') throw new Error(`Expected state === 'completed', got ${directResult.state}`);
    if (!directResult.toolsUsed.includes('file.grep') || !directResult.toolsUsed.includes('observation.record')) {
        throw new Error('Expected toolsUsed to include file.grep and observation.record');
    }
    if (!directResult.verification?.passed) throw new Error('Expected verification.passed === true');
    if (directResult.evidence.length !== 5) throw new Error(`Expected 5 evidence items, got ${directResult.evidence.length}`);
    console.log('✓ Direct execution contract fully verified.\n');

    // 2. Testing HTTP server POST /api/execute
    console.log('2. Testing HTTP server POST /api/execute...');
    const testPort = 3199;
    const server = await createServer(max, { port: testPort });

    // Read the generated API key
    const fs = await import('fs');
    const path = await import('path');
    const keyFile = path.join(process.cwd(), '.max', 'api-key.txt');
    const apiKey = fs.readFileSync(keyFile, 'utf8').trim();

    turn = 0; // reset brain turn for HTTP test
    const httpRes = await fetch(`http://127.0.0.1:${testPort}/api/execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            task,
            mode: 'inspect'
        })
    });

    const httpBody = await httpRes.json();
    console.log('\nHTTP Execution Response Status:', httpRes.status);
    console.log('HTTP Execution Response Body:', JSON.stringify(httpBody, null, 2));

    if (httpRes.status !== 200) throw new Error(`HTTP status ${httpRes.status} !== 200`);
    if (httpBody.status !== 'queued' || !httpBody.jobId) {
        throw new Error(`Expected immediate { jobId, status: 'queued' }, got ${JSON.stringify(httpBody)}`);
    }
    console.log(`✓ Immediate async queued return verified (Job ID: ${httpBody.jobId})`);

    // Poll GET /api/execute/:jobId
    console.log(`Polling GET /api/execute/${httpBody.jobId} for completion...`);
    let finalJob = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        const pollRes = await fetch(`http://127.0.0.1:${testPort}/api/execute/${httpBody.jobId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'completed') {
            finalJob = pollData;
            break;
        }
    }

    if (!finalJob) throw new Error('Polling timed out waiting for job completion');
    if (!finalJob.verification?.passed) throw new Error('Expected finalJob.verification.passed === true');
    if (!finalJob.toolsUsed.includes('file.grep') || !finalJob.toolsUsed.includes('observation.record')) {
        throw new Error('Expected toolsUsed to include file.grep and observation.record');
    }
    console.log('✓ HTTP async execution & GET polling contract fully verified.\n');

    // 3. Testing Pure Prose Rejection (Negative Test)
    console.log('3. Testing Pure Prose Rejection (Model claims done without executing tools)...');
    max.brain.think = async () => ({ text: 'I searched the entire codebase and verified all references to tool calling. All 5 findings are accounted for.' });
    const proseResult = await max.execute(task, { mode: 'inspect' });
    console.log('Prose-Only Result State:', proseResult.state, '| Success:', proseResult.success);
    if (proseResult.success === true) {
        throw new Error('Security failure: Model claimed success via prose alone without executing tools!');
    }
    console.log('✓ Pure prose rejection successfully prevented false completion.\n');

    process.exit(0);
}

runE2ETest().catch(err => {
    console.error('❌ E2E Smoke Test Failed:', err);
    process.exit(1);
});
