
import chokidar from 'chokidar';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * Sentinel — The proactive workspace watcher.
 * Monitors the file system and alerts MAX to changes in real-time.
 */
export class Sentinel extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max    = max;
        this.root   = process.cwd();
        this.config = {
            ignore: [
                '**/node_modules/**',
                '**/.git/**',
                '**/.max/**',
                '**/dist/**',
                '**/build/**',
                '**/*.log',
                '**/vectors.json',
                '**/knowledge.db'
            ],
            debounceMs: config.debounceMs || 2000,
            ...config
        };

        this._watcher = null;
        this._queue   = new Set();
        this._timer   = null;
    }

    start() {
        if (this._watcher) return;

        console.log(`[Sentinel] 🛡️  Daemon activated. Watching: ${this.root}`);

        this._watcher = chokidar.watch(this.root, {
            ignored:       this.config.ignore,
            persistent:    true,
            ignoreInitial: true,
            depth:         5
        });

        this._watcher
            .on('add',    path => this._enqueue(path, 'created'))
            .on('change', path => this._enqueue(path, 'modified'))
            .on('unlink', path => this._enqueue(path, 'deleted'));
    }

    stop() {
        if (this._watcher) {
            this._watcher.close();
            this._watcher = null;
        }
    }

    _enqueue(filePath, type) {
        const relPath = path.relative(this.root, filePath);
        
        // Strictly ignore anything in ignored paths (especially .max)
        if (this.config.ignore.some(p => {
            const pattern = p.replace(/\*\*/g, '.*').replace(/\//g, '[\\\\/]');
            return new RegExp(pattern).test(relPath);
        })) {
            return;
        }

        // Skip non-source files
        const ext = path.extname(filePath).toLowerCase();
        const validExts = ['.js', '.mjs', '.cjs', '.ts', '.py', '.go', '.md']; // Removed .json to be safe
        if (!validExts.includes(ext)) return;

        this._queue.add(relPath);

        // Debounce: wait for user to stop saving before reacting
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this._processQueue(type), this.config.debounceMs);
    }

    async _processQueue(type) {
        const files = Array.from(this._queue);
        this._queue.clear();

        for (const file of files) {
            console.log(`[Sentinel] 👁️  Detected change in: ${file} (${type})`);

            // 1. Re-index the file in "God's Eye" memory
            if (this.max.indexer) {
                const fullPath = path.join(this.root, file);
                await this.max.indexer._indexFile(fullPath).catch(() => {});
            }

            // 2. Alert the Heartbeat so the user sees an insight
            this.emit('change', { file, type });

            // ── 4. Significant Change Detection ───────────────────────────
            const isSignificant = (
                file === 'plan.md' || 
                file === 'package.json' || 
                (type === 'created' && (file.startsWith('core/') || file.startsWith('tools/')))
            );

            if (isSignificant) {
                console.log(`[Sentinel] ⚠️  Significant change detected: ${file}`);
                this.emit('significantChange', { file, type });
            }

            // 3. Proactive Mini-Audit
            // If it's a core file, we might want to run a quick brain check
            if (file.startsWith('core/') || file.startsWith('tools/')) {
                this._proactiveAudit(file, type);
            }
        }
    }

    async _proactiveAudit(file, type) {
        if (!this.max.brain?._ready || type === 'deleted') return;

        try {
            // We don't wait for this — fire and forget background audit
            const result = await this.max.brain.think(
                `I noticed you just ${type} the file: ${file}. 
Briefly audit this change. Are there any immediate logic errors or security risks introduced? 
If everything looks good, just return "PASS". 
Otherwise, give a 1-sentence warning.`,
                { tier: 'fast', temperature: 0.2, maxTokens: 150 }
            );

            const report = result.text;
            if (report !== 'PASS' && !report.includes('PASS')) {
                // If it looks like a security warning, speak up proactively!
                if (report.toLowerCase().includes('security') || report.toLowerCase().includes('risk')) {
                    this.max.say(`🛡️ Sentinel Warning for ${file}: ${report}`, "High Risk Detection");
                }

                this.emit('insight', {
                    source: 'sentinel',
                    label:  `🛡️  Sentinel Audit: ${file}`,
                    result: report
                });
            }
        } catch { /* skip audit errors */ }
    }
}
