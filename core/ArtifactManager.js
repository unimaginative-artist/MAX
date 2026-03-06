
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * ArtifactManager — Manages large code blocks outside the LLM context window.
 * This prevents "Context Bloat" and helps the agent stay focused.
 */
export class ArtifactManager extends EventEmitter {
    constructor(max) {
        super();
        this.max = max;
        this.artifacts = new Map(); // id -> { name, content, type, timestamp }
        this._counter = 0;
    }

    /**
     * Store a large block of text as an artifact and return a pointer.
     */
    store(name, content, type = 'code') {
        const id = `art_${++this._counter}_${Date.now().toString(36)}`;
        const artifact = {
            id,
            name,
            content,
            type,
            lineCount: content.split('\n').length,
            timestamp: Date.now()
        };

        this.artifacts.set(id, artifact);
        this.emit('artifact:created', artifact);

        // Return the "Pointer" that will live in the chat history
        return `[ARTIFACT REF: ${id} | NAME: ${name} | TYPE: ${type} | LINES: ${artifact.lineCount}]`;
    }

    /**
     * Retrieve the full content of an artifact.
     */
    get(id) {
        return this.artifacts.get(id);
    }

    /**
     * List recent artifacts for the Dashboard.
     */
    list() {
        return Array.from(this.artifacts.values()).sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * "De-hydrate" context: Replaces full code blocks in history with pointers.
     */
    dehydrate(history) {
        return history.map(turn => {
            if (turn.content.length > 1000) {
                // If it looks like a tool result containing code, extract it
                if (turn.content.includes('"content":') || turn.content.includes('import ')) {
                    const pointer = this.store('Extracted Code', turn.content);
                    return { ...turn, content: `Content too large for history. Reference: ${pointer}` };
                }
            }
            return turn;
        });
    }
}
