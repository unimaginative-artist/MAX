import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * ContextPagerArbiter.js — Virtual Memory Manager for the System Prompt.
 * 
 * Functions like a CPU's page table. It dynamically swaps "Context Blocks" 
 * (code hunks, docs, facts) in and out of the prompt based on semantic relevance.
 */
export class ContextPagerArbiter extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;
        this.config = {
            maxContextChars: config.maxContextChars || 4000,
            hunkLimit:       config.hunkLimit || 10,
            ...config
        };
        this.pinnedHunks = new Map(); // id -> content
    }

    /**
     * Retrieves a dynamic context block based on the current user query.
     */
    async getPagedContext(query, charBudget = null) {
        const budget = charBudget || this.config.maxContextChars;
        if (!this.max.kb?._ready) return '';

        console.log(`[ContextPager] 📑 Paging context for query: "${query.slice(0, 30)}..." (budget: ${budget} chars)`);

        let used = 0;
        const parts = ['\n\n## Paged Project Context (Dynamic)'];
        const telemetry = { buffers: [], pinned: [], semantic: [] };

        // 1. Inject Ghost Buffers (Unsaved IDE Edits) first
        if (this.max._ghostBuffers?.size > 0) {
            for (const [filePath, bufVal] of this.max._ghostBuffers) {
                // server.js stores { content, updatedAt } objects — extract the string
                const rawContent = typeof bufVal === 'object' ? (bufVal.content ?? '') : (bufVal ?? '');
                const remaining = budget - used;
                if (remaining <= 200) break; // Not enough remaining budget
                const sliceLen = Math.min(4000, remaining - 100);
                if (sliceLen <= 0) break;
                const block = `\n### [ACTIVE BUFFER] Source: ${filePath} (Unsaved)\n${rawContent.slice(0, sliceLen)}`;
                parts.push(block);
                used += block.length;
                telemetry.buffers.push(filePath);
            }
        }

        // 2. Inject Pinned Hunks
        for (const [id, content] of this.pinnedHunks) {
            const block = `\n### Pinned: ${id}\n${content}`;
            if (used + block.length > budget) break;
            parts.push(block);
            used += block.length;
            telemetry.pinned.push(id);
        }

        // 3. Inject Semantic Hunks from KnowledgeBase
        const chunks = await this.max.kb.query(query, { topK: this.config.hunkLimit });
        for (const chunk of chunks) {
            if (this.max._ghostBuffers?.has(chunk.source_path)) continue;
            const source = chunk.source_name || chunk.source_path || 'unknown';
            const snippet = chunk.content.trim();
            const block = `\n### Source: ${source} (Hunk ${chunk.chunk_index})\n${snippet}`;
            if (used + block.length > budget) continue; 
            parts.push(block);
            used += block.length;
            telemetry.semantic.push({ source, hunk: chunk.chunk_index });
        }

        this.emit('paging_update', { query, budget, used, ...telemetry });

        if (parts.length === 1) return ''; 
        return parts.join('\n');
    }

    /**
     * Pin a specific code hunk to always be in context.
     */
    pinHunk(id, content) {
        this.pinnedHunks.set(id, content);
        console.log(`[ContextPager] 📌 Hunk pinned: ${id}`);
        this.emit('pin_update', { id, action: 'pin', count: this.pinnedHunks.size });
    }

    unpinHunk(id) {
        this.pinnedHunks.delete(id);
        this.emit('pin_update', { id, action: 'unpin', count: this.pinnedHunks.size });
    }

    clearPins() {
        this.pinnedHunks.clear();
        this.emit('pin_update', { action: 'clear', count: 0 });
    }

    getStatus() {
        return {
            pinnedCount: this.pinnedHunks.size,
            maxBudget: this.config.maxContextChars,
            kbStatus: this.max.kb?.getStatus()
        };
    }
}
