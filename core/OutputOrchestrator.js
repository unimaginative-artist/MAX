// ═══════════════════════════════════════════════════════════════════════════
// OutputOrchestrator.js — Priority-based message coordination
// Inspired by SOMA's AttentionArbiter + MessageBroker flush window pattern
//
// Priority tiers (lower number = higher priority):
// 0: USER_RESPONSE    — direct replies to user input
// 1: AGENT_ACTION     — agent executing a command/change
// 2: AGENT_INSIGHT    — agent discoveries, diagnoses, completions
// 3: HEARTBEAT        — background monitoring, curiosity, reflections
// 4: DEBUG            — verbose logging, internal state dumps
//
// Flush window: higher-priority signals cancel lower-priority ones within this window.
// Configurable via MAX_FLUSH_MS environment variable (default: 50ms).
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

const PRIORITY = {
    USER_RESPONSE: 0,
    AGENT_ACTION: 1,
    AGENT_INSIGHT: 2,
    HEARTBEAT: 3,
    DEBUG: 4
};

const PRIORITY_LABELS = [
    'USER_RESPONSE',
    'AGENT_ACTION',
    'AGENT_INSIGHT',
    'HEARTBEAT',
    'DEBUG'
];

export class OutputOrchestrator {
    constructor(config = {}) {
        // Flush window in milliseconds — critical tuning parameter
        this.flushWindowMs = config.flushWindowMs 
            ?? parseInt(process.env.MAX_FLUSH_MS) 
            ?? 50;
        
        // Deduplication window (messages with same hash within this window are dropped)
        this.dedupWindowMs = config.dedupWindowMs ?? 5000;
        
        // Internal state
        this._pending = null;          // { priority, message, timestamp, hash }
        this._flushTimer = null;
        this._dedupCache = new Map();  // hash → timestamp
        
        // Stats
        this.stats = {
            sent: 0,
            dropped: 0,
            cancelled: 0,
            flushed: 0
        };
        
        console.log(`[OutputOrchestrator] ✅ Initialized with ${this.flushWindowMs}ms flush window`);
    }
    
    /**
     * Queue a message for delivery.
     * Returns true if accepted, false if dropped (duplicate or cancelled by higher priority).
     */
    queue(message, priority = PRIORITY.AGENT_INSIGHT) {
        const now = Date.now();
        const hash = this._hashMessage(message);
        
        // 1. Deduplication check
        const lastSeen = this._dedupCache.get(hash);
        if (lastSeen && (now - lastSeen) < this.dedupWindowMs) {
            this.stats.dropped++;
            return false;
        }
        
        // 2. Priority competition
        if (this._pending) {
            const timeSincePending = now - this._pending.timestamp;
            
            if (timeSincePending < this.flushWindowMs) {
                // Within flush window — higher priority wins
                if (priority < this._pending.priority) {
                    // New message has higher priority — cancel pending
                    this._cancelPending();
                    this.stats.cancelled++;
                } else {
                    // New message has lower or equal priority — drop it
                    this.stats.dropped++;
                    return false;
                }
            } else {
                // Flush window expired — flush pending first
                this._flushPending();
            }
        }
        
        // 3. Accept new message
        this._pending = {
            priority,
            message,
            timestamp: now,
            hash
        };
        
        // Update dedup cache
        this._dedupCache.set(hash, now);
        
        // 4. Schedule flush if not already scheduled
        if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => this._flushPending(), this.flushWindowMs);
        }
        
        return true;
    }
    
    /**
     * Force immediate flush (for user responses that shouldn't wait).
     */
    flush() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._flushPending();
    }
    
    /**
     * Register a callback to receive flushed messages.
     */
    onFlush(callback) {
        this._callback = callback;
    }
    
    // ── Internal methods ─────────────────────────────────────────────────
    
    _hashMessage(message) {
        return crypto.createHash('md5').update(JSON.stringify(message)).digest('hex');
    }
    
    _cancelPending() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        this._pending = null;
    }
    
    _flushPending() {
        if (this._flushTimer) {
            clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
        
        if (!this._pending) return;
        
        // Deliver to callback
        if (this._callback) {
            this._callback(this._pending.message, this._pending.priority);
        }
        
        this.stats.sent++;
        this.stats.flushed++;
        this._pending = null;
        
        // Clean old dedup entries (every 100 messages to avoid memory leak)
        if (this.stats.sent % 100 === 0) {
            this._cleanDedupCache();
        }
    }
    
    _cleanDedupCache() {
        const now = Date.now();
        for (const [hash, timestamp] of this._dedupCache.entries()) {
            if (now - timestamp > this.dedupWindowMs * 10) { // 10x window
                this._dedupCache.delete(hash);
            }
        }
    }
    
    // ── Utility methods ──────────────────────────────────────────────────
    
    getStats() {
        return {
            ...this.stats,
            flushWindowMs: this.flushWindowMs,
            dedupWindowMs: this.dedupWindowMs,
            pending: this._pending ? PRIORITY_LABELS[this._pending.priority] : null
        };
    }
}

export { PRIORITY };