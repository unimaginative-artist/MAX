// ═══════════════════════════════════════════════════════════════════════════
// MCPClient.js — connects MAX to any external MCP server
//
// Spawns an MCP server process, does the JSON-RPC handshake over stdio,
// discovers its tools, and makes them callable via MAX's ToolRegistry.
//
// Protocol: MCP 2024-11-05 (JSON-RPC 2.0 over stdio)
// ═══════════════════════════════════════════════════════════════════════════

import { spawn }        from 'child_process';
import { EventEmitter } from 'events';
import { createInterface } from 'readline';

const REQUEST_TIMEOUT_MS = 45_000;

export class MCPClient extends EventEmitter {
    constructor(config) {
        super();
        this.name        = config.name;
        this.command     = config.command;
        this.args        = config.args        || [];
        this.env         = config.env         || {};
        this.description = config.description || `MCP server: ${config.name}`;

        this._proc      = null;
        this._rl        = null;
        this._pending   = new Map();  // id → { resolve, reject, timer }
        this._nextId    = 1;
        this._ready     = false;
        this._tools     = [];         // discovered tool schemas
        this._attempts  = 0;
        this._destroyed = false;
    }

    // ─── Connect and perform MCP handshake ───────────────────────────────
    async connect() {
        if (this._ready) return this._tools;
        this._attempts++;

        console.log(`[MCP] 🔌 Connecting to "${this.name}": ${this.command} ${this.args.join(' ')}`);

        this._proc = spawn(this.command, this.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env:   { ...process.env, ...this.env },
            shell: process.platform === 'win32'
        });

        // Forward stderr to console (server logs/errors)
        this._proc.stderr.on('data', (d) => {
            const lines = d.toString().split(/\r?\n/).filter(Boolean);
            for (const l of lines) {
                if (!l.includes('[object Object]')) {
                    process.stdout.write(`  \x1b[90m[mcp:${this.name}]\x1b[0m ${l}\n`);
                }
            }
        });

        // Handle process exit — attempt reconnect once
        this._proc.on('exit', (code) => {
            this._ready = false;
            if (!this._destroyed) {
                console.warn(`[MCP] ⚠️  "${this.name}" exited (${code})`);
                this.emit('disconnected', { name: this.name, code });
                // Reject all pending requests
                for (const [, { reject, timer }] of this._pending) {
                    clearTimeout(timer);
                    reject(new Error(`MCP server "${this.name}" disconnected`));
                }
                this._pending.clear();
            }
        });

        this._proc.on('error', (err) => {
            console.error(`[MCP] ❌ "${this.name}" spawn error: ${err.message}`);
            this.emit('error', err);
        });

        // Read JSON-RPC messages line by line from stdout
        this._rl = createInterface({ input: this._proc.stdout, terminal: false });
        this._rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                this._handleMessage(JSON.parse(trimmed));
            } catch { /* non-JSON line — ignore */ }
        });

        // ── MCP handshake ─────────────────────────────────────────────────
        const initResult = await this._send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities:    { roots: { listChanged: false } },
            clientInfo:      { name: 'max-agent', version: '1.0.0' }
        });

        if (!initResult?.protocolVersion) {
            throw new Error(`[MCP] "${this.name}" handshake failed — unexpected response`);
        }

        // Confirm initialization
        this._sendNotification('notifications/initialized');

        // Discover available tools
        const toolsResult = await this._send('tools/list', {});
        this._tools = toolsResult?.tools || [];
        this._ready = true;

        console.log(`[MCP] ✅ "${this.name}" connected — ${this._tools.length} tool(s): ${this._tools.map(t => t.name).join(', ')}`);
        this.emit('ready', { name: this.name, tools: this._tools });

        return this._tools;
    }

    // ─── Call a tool on the remote MCP server ────────────────────────────
    async callTool(toolName, args = {}) {
        if (!this._ready) throw new Error(`MCP server "${this.name}" is not connected`);

        const result = await this._send('tools/call', { name: toolName, arguments: args });

        // MCP result format: { content: [{ type, text }], isError? }
        if (result?.isError) {
            const errText = result.content?.map(c => c.text).join('\n') || 'Tool error';
            throw new Error(errText);
        }

        // Extract text content — collapse to string for ToolRegistry compatibility
        const content = result?.content || [];
        if (content.length === 1 && content[0].type === 'text') {
            return { success: true, text: content[0].text };
        }
        // Multiple content items or images — return structured
        return {
            success: true,
            content: content.map(c => ({
                type: c.type,
                text: c.text,
                // image data if present
                ...(c.data ? { data: c.data, mimeType: c.mimeType } : {})
            }))
        };
    }

    // ─── Graceful shutdown ────────────────────────────────────────────────
    disconnect() {
        this._destroyed = true;
        this._ready     = false;
        try { this._proc?.kill('SIGTERM'); } catch {}
    }

    getStatus() {
        return {
            name:      this.name,
            ready:     this._ready,
            tools:     this._tools.map(t => t.name),
            toolCount: this._tools.length
        };
    }

    // ─── Internal: send a JSON-RPC request, wait for response ────────────
    _send(method, params) {
        return new Promise((resolve, reject) => {
            const id    = this._nextId++;
            const timer = setTimeout(() => {
                this._pending.delete(id);
                reject(new Error(`MCP timeout: ${method} on "${this.name}" (${REQUEST_TIMEOUT_MS}ms)`));
            }, REQUEST_TIMEOUT_MS);

            this._pending.set(id, { resolve, reject, timer });

            const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
            this._proc.stdin.write(msg);
        });
    }

    // ─── Internal: fire-and-forget notification (no id, no response) ─────
    _sendNotification(method, params = {}) {
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        this._proc.stdin.write(msg);
    }

    // ─── Internal: route incoming JSON-RPC messages ───────────────────────
    _handleMessage(msg) {
        // Response to a pending request
        if (msg.id !== undefined && this._pending.has(msg.id)) {
            const { resolve, reject, timer } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            clearTimeout(timer);

            if (msg.error) {
                reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
                resolve(msg.result);
            }
            return;
        }

        // Server-initiated notifications (tools/list changed etc.) — ignore for now
    }
}
