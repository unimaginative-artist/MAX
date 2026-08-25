import { parentPort, workerData } from 'worker_threads';
import { MAX } from '../core/MAX.js';
import path from 'path';

/**
 * SwarmNode.js — The individual worker process for a Swarm Agent.
 * Runs in a separate thread to ensure true parallel execution of brain/tool calls.
 */
async function boot() {
    const { id, persona, config, projectRoot } = workerData;
    
    // Change current directory to project root so tools work correctly
    process.chdir(projectRoot);

    // A swarm thread is a bounded local worker.  Worker role prevents it from
    // starting MAX's autonomous schedulers and disables cloud fallback.
    const max = new MAX({
        clusterRole: 'worker',
        nodeId: `swarm-${id}`,
        workerCloudAllowed: false,
        memory: { dbPath: path.join(projectRoot, '.max', `swarm_mem_${id}.db`) }
    });

    try {
        await max.initialize();
        
        parentPort.on('message', async (task) => {
            const { type, payload, taskId } = task;

            if (type === 'run') {
                try {
                    console.log(`[SwarmNode:${id}] 🐝 Executing: ${payload.prompt.slice(0, 50)}...`);
                    
                    // Run the subtask
                    const result = await max.brain.think(payload.prompt, {
                        systemPrompt: payload.systemPrompt,
                        tier: payload.tier || 'fast'
                    });

                    parentPort.postMessage({
                        type: 'success',
                        taskId,
                        result: result.text,
                        discoveries: result.discoveries || null
                    });
                } catch (err) {
                    parentPort.postMessage({ type: 'error', taskId, error: err.message });
                }
            }
        });

        parentPort.postMessage({ type: 'ready' });

    } catch (err) {
        parentPort.postMessage({ type: 'error', error: `Boot failed: ${err.message}` });
    }
}

boot();
