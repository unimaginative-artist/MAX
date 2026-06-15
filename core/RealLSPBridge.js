import { spawn } from 'child_process';
import { exec }  from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

// ── Language server registry ──────────────────────────────────────────────
// Maps Monaco/VSCode language IDs to the CLI command + args that serve them.
// All servers communicate over stdin/stdout using LSP's JSON-RPC framing.
const LSP_SERVERS = {
    javascript:       { cmd: 'typescript-language-server', args: ['--stdio'] },
    javascriptreact:  { cmd: 'typescript-language-server', args: ['--stdio'] },
    typescript:       { cmd: 'typescript-language-server', args: ['--stdio'] },
    typescriptreact:  { cmd: 'typescript-language-server', args: ['--stdio'] },
    python:           { cmd: 'pylsp',                      args: [] },
    go:               { cmd: 'gopls',                      args: [] },
    rust:             { cmd: 'rust-analyzer',              args: [] },
};

// ── Minimal stdio JSON-RPC LSP client ─────────────────────────────────────
class LSPClient extends EventEmitter {
    constructor(langId, cmd, args) {
        super();
        this.langId  = langId;
        this._cmd    = cmd;
        this._args   = args;
        this._proc   = null;
        this._nextId = 1;
        this._pending = new Map();   // id -> { resolve, reject }
        this._buf    = '';
        this._ready  = false;
        this._stopping = false;
        this.capabilities = {};
    }

    async start(rootPath) {
        const rootUri = 'file:///' + rootPath.replace(/\\/g, '/');

        this._proc = spawn(this._cmd, this._args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
        });

        this._proc.stdout.on('data', chunk => this._recv(chunk.toString('utf8')));
        this._proc.stderr.on('data', d => {
            const t = d.toString();
            if (!/\b(INFO|DEBUG|TRACE|info|debug|trace)\b/.test(t)) {
                console.warn(`[LSP:${this.langId}] ${t.slice(0, 300)}`);
            }
        });
        this._proc.on('error', err => {
            console.warn(`[LSP:${this.langId}] spawn error: ${err.message}`);
            this._ready = false;
            this._rejectPending(err);
        });
        this._proc.on('exit', code => {
            this._ready = false;
            this._rejectPending(new Error(`LSP server exited (code ${code})`));
        });

        try {
            const result = await this._req('initialize', {
                processId:    process.pid,
                clientInfo:   { name: 'maxwell', version: '1.0' },
                rootUri,
                capabilities: {
                    textDocument: {
                        synchronization: {
                            dynamicRegistration: false,
                            willSave: false,
                            willSaveWaitUntil: false,
                            didSave: false
                        },
                        completion: {
                            dynamicRegistration: false,
                            completionItem: {
                                snippetSupport: true,
                                documentationFormat: ['plaintext', 'markdown']
                            },
                            contextSupport: true
                        },
                        hover: {
                            dynamicRegistration: false,
                            contentFormat: ['markdown', 'plaintext']
                        },
                        definition:  { dynamicRegistration: false },
                        publishDiagnostics: { dynamicRegistration: false }
                    }
                }
            });
            this.capabilities = result?.capabilities ?? {};
            this._notify('initialized', {});
            this._ready = true;
            console.log(`[LSP:${this.langId}] ✅ Ready (${this._cmd})`);
            return true;
        } catch (err) {
            console.warn(`[LSP:${this.langId}] Initialize failed: ${err.message}`);
            this._proc?.kill();
            return false;
        }
    }

    _recv(data) {
        this._buf += data;
        // LSP framing: Content-Length: N\r\n\r\n{body}
        while (true) {
            const sep = this._buf.indexOf('\r\n\r\n');
            if (sep === -1) break;
            const header = this._buf.slice(0, sep);
            const m = header.match(/Content-Length:\s*(\d+)/i);
            if (!m) { this._buf = ''; break; }
            const len   = parseInt(m[1], 10);
            const start = sep + 4;
            if (this._buf.length < start + len) break;
            const body = this._buf.slice(start, start + len);
            this._buf  = this._buf.slice(start + len);
            try {
                const msg = JSON.parse(body);
                if (msg.id != null && this._pending.has(msg.id)) {
                    const { resolve, reject } = this._pending.get(msg.id);
                    this._pending.delete(msg.id);
                    msg.error ? reject(new Error(msg.error.message || JSON.stringify(msg.error)))
                              : resolve(msg.result);
                } else if (msg.method === 'textDocument/publishDiagnostics') {
                    this.emit('diagnostics', msg.params);
                }
                // Other server-to-client notifications are ignored for now
            } catch { /* skip malformed JSON */ }
        }
    }

    _send(msg) {
        if (!this._proc?.stdin?.writable) return;
        const body = JSON.stringify(msg);
        const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
        this._proc.stdin.write(frame);
    }

    _req(method, params) {
        if (!this._proc?.stdin?.writable) {
            return Promise.reject(new Error(`LSP unavailable: ${method}`));
        }
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            const timer = setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`LSP timeout: ${method}`));
                }
            }, 10000);
            timer.unref?.();
            this._pending.set(id, {
                timer,
                resolve: v => { clearTimeout(timer); resolve(v); },
                reject:  e => { clearTimeout(timer); reject(e);  }
            });
            this._send({ jsonrpc: '2.0', id, method, params });
        });
    }

    _notify(method, params) {
        this._send({ jsonrpc: '2.0', method, params });
    }

    // ── Public LSP operations ─────────────────────────────────────────────

    didOpen(uri, languageId, content) {
        this._notify('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content }
        });
    }

    didChange(uri, content, version) {
        this._notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text: content }]
        });
    }

    async complete(uri, position) {
        if (!this._ready) return null;
        return this._req('textDocument/completion', {
            textDocument: { uri },
            position
        }).catch(() => null);
    }

    async hover(uri, position) {
        if (!this._ready) return null;
        return this._req('textDocument/hover', {
            textDocument: { uri },
            position
        }).catch(() => null);
    }

    async definition(uri, position) {
        if (!this._ready) return null;
        return this._req('textDocument/definition', {
            textDocument: { uri },
            position
        }).catch(() => null);
    }

    stop() {
        if (this._stopping) return;
        this._stopping = true;
        this._ready = false;
        this._rejectPending(new Error('LSP client stopped'));
        if (this._proc && !this._proc.killed) {
            this._notify('exit', {});
            this._proc.kill('SIGTERM');
        }
        this._proc = null;
    }

    _rejectPending(err) {
        for (const pending of this._pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this._pending.clear();
    }
}

// ── RealLSPBridge — manages one LSPClient per language ───────────────────
export class RealLSPBridge extends EventEmitter {
    constructor() {
        super();
        this._clients   = new Map(); // normalizedLang -> LSPClient | null
        this._versions  = new Map(); // uri -> version
        this._probed    = null;      // cached availability map
        this._probing   = null;      // in-flight probe promise (avoid double-probe)
    }

    // ── Availability probe — runs once, cached ────────────────────────────
    async _probe() {
        if (this._probed) return this._probed;
        if (this._probing) return this._probing;

        this._probing = (async () => {
            const result = {};
            for (const [lang, { cmd }] of Object.entries(LSP_SERVERS)) {
                try {
                    await execAsync(`${cmd} --version`, { timeout: 3000 });
                    result[lang] = true;
                } catch {
                    result[lang] = false;
                }
            }
            // Pyright as Python fallback
            if (!result.python) {
                try {
                    await execAsync('pyright-langserver --version', { timeout: 3000 });
                    LSP_SERVERS.python = { cmd: 'pyright-langserver', args: ['--stdio'] };
                    result.python = true;
                } catch { /* not available */ }
            }
            const found = Object.keys(result).filter(k => result[k]);
            console.log(found.length
                ? `[RealLSP] Servers available: ${found.join(', ')}`
                : '[RealLSP] No LSP servers found in PATH. Install typescript-language-server for JS/TS.'
            );
            this._probed  = result;
            this._probing = null;
            return result;
        })();

        return this._probing;
    }

    // Alias resolution: react variants map to their base language server
    _normalize(langId) {
        return { javascriptreact: 'javascript', typescriptreact: 'typescript' }[langId] ?? langId;
    }

    // ── Get (or start) the client for a language ─────────────────────────
    async getClient(langId) {
        const lang = this._normalize(langId);
        if (this._clients.has(lang)) return this._clients.get(lang); // null means unavailable

        const avail = await this._probe();
        const server = LSP_SERVERS[lang] ?? LSP_SERVERS[langId];
        if (!server || !avail[lang]) {
            this._clients.set(lang, null);
            return null;
        }

        // Optimistically set to null to prevent double-start during await
        this._clients.set(lang, null);
        const client = new LSPClient(lang, server.cmd, server.args);
        const ok = await client.start(process.cwd());
        if (!ok) return null;

        client.on('diagnostics', params => this.emit('diagnostics', params));
        this._clients.set(lang, client);
        return client;
    }

    // ── Document lifecycle ────────────────────────────────────────────────
    async notifyOpen(uri, langId, content) {
        const client = await this.getClient(langId);
        if (!client) return;
        this._versions.set(uri, 1);
        client.didOpen(uri, this._normalize(langId), content);
    }

    async notifyChange(uri, langId, content) {
        const client = await this.getClient(langId);
        if (!client) return;
        const v = (this._versions.get(uri) ?? 1) + 1;
        this._versions.set(uri, v);
        client.didChange(uri, content, v);
    }

    // ── LSP operations — all return null on failure ───────────────────────
    async complete(uri, position, langId, content) {
        const client = await this.getClient(langId);
        if (!client) return null;
        if (content != null) await this.notifyChange(uri, langId, content);
        const raw = await client.complete(uri, position);
        if (!raw) return null;
        // Normalise: servers return either { items: [...] } or [...]
        return Array.isArray(raw) ? { items: raw } : raw;
    }

    async hover(uri, position, langId) {
        const client = await this.getClient(langId);
        return client ? client.hover(uri, position) : null;
    }

    async definition(uri, position, langId) {
        const client = await this.getClient(langId);
        return client ? client.definition(uri, position) : null;
    }

    // ── Status / teardown ─────────────────────────────────────────────────
    stop() {
        for (const c of this._clients.values()) c?.stop();
        this._clients.clear();
        this._versions.clear();
    }

    getStatus() {
        const active = [];
        for (const [lang, c] of this._clients) {
            if (c?._ready) active.push(lang);
        }
        return { activeLangs: active, trackedDocs: this._versions.size };
    }
}
