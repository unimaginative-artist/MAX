
import { parentPort, workerData } from 'worker_threads';
import { Embedder } from '../memory/Embedder.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * HeavyWorker.js — Dedicated background thread for CPU-intensive tasks.
 * Prevents the main Node.js event loop from freezing during:
 * 1. AI Model Loading
 * 2. Vector Embedding (Matrix math)
 * 3. Large-scale Codebase Crawling
 */

const embedder = new Embedder();
let isInitialized = false;

parentPort.on('message', async (task) => {
    const { type, payload, id } = task;

    try {
        if (!isInitialized) {
            await embedder.initialize();
            isInitialized = true;
        }

        switch (type) {
            case 'embed':
                const vector = await embedder.embed(payload.text);
                parentPort.postMessage({ id, type: 'success', result: vector });
                break;

            case 'crawl':
                const files = await crawlWorkspace(payload.rootDir, payload.extensions, payload.ignoreDirs);
                parentPort.postMessage({ id, type: 'success', result: files });
                break;

            case 'ping':
                parentPort.postMessage({ id, type: 'pong' });
                break;

            default:
                parentPort.postMessage({ id, type: 'error', error: `Unknown task type: ${type}` });
        }
    } catch (err) {
        parentPort.postMessage({ id, type: 'error', error: err.message });
    }
});

async function crawlWorkspace(dir, extensions, ignoreDirs) {
    const exts = new Set(extensions);
    const ignore = new Set(ignoreDirs);
    let results = [];

    const list = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of list) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!ignore.has(entry.name) && !entry.name.startsWith('.')) {
                results = results.concat(await crawlWorkspace(fullPath, extensions, ignoreDirs));
            }
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (exts.has(ext)) {
                results.push(fullPath);
            }
        }
    }
    return results;
}
