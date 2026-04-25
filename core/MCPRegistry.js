// ═══════════════════════════════════════════════════════════════════════════
// MCPRegistry.js — manages MAX's MCP server connections
//
// Reads config/mcp-servers.json, connects to each server,
// and auto-registers their tools into MAX's ToolRegistry so the brain
// can call them the same way it calls any built-in tool:
//
//   TOOL:mcp_playwright:browser_navigate:{"url":"https://example.com"}
//   TOOL:mcp_github:create_issue:{"title":"Bug","body":"..."}
//
// Each MCP server becomes a tool namespace prefixed with "mcp_".
// The full tool manifest is automatically included in MAX's system prompt.
// ═══════════════════════════════════════════════════════════════════════════

import { MCPClient } from './MCPClient.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config', 'mcp-servers.json');

export class MCPRegistry {
    constructor(max) {
        this.max      = max;
        this._clients = new Map();  // serverName → MCPClient
    }

    // ─── Boot — load config, connect to all servers ───────────────────────
    async initialize() {
        const servers = this._loadConfig();
        if (servers.length === 0) {
            console.log('[MCPRegistry] No MCP servers configured (config/mcp-servers.json)');
            return;
        }

        console.log(`[MCPRegistry] 🔌 Connecting to ${servers.length} MCP server(s)...`);

        // Connect in parallel — a failed server shouldn't block the others
        await Promise.allSettled(servers.map(cfg => this._connectServer(cfg)));

        const connected = [...this._clients.values()].filter(c => c._ready).length;
        console.log(`[MCPRegistry] ✅ ${connected}/${servers.length} MCP server(s) online`);
    }

    // ─── Connect one server and register its tools ────────────────────────
    async _connectServer(cfg) {
        const client = new MCPClient(cfg);
        this._clients.set(cfg.name, client);

        try {
            const tools = await client.connect();
            this._registerTools(client, tools);

            // Auto-reconnect on unexpected disconnect (once, after 5s)
            client.on('disconnected', () => {
                setTimeout(async () => {
                    if (!client._destroyed) {
                        console.log(`[MCPRegistry] 🔄 Reconnecting "${cfg.name}"...`);
                        try {
                            await client.connect();
                            this._registerTools(client, client._tools);
                        } catch (err) {
                            console.warn(`[MCPRegistry] Reconnect failed for "${cfg.name}": ${err.message}`);
                        }
                    }
                }, 5000);
            });

        } catch (err) {
            console.warn(`[MCPRegistry] ⚠️  Could not connect "${cfg.name}": ${err.message}`);
            this._clients.delete(cfg.name);
        }
    }

    // ─── Register a server's tools into MAX's ToolRegistry ───────────────
    _registerTools(client, tools) {
        if (!tools.length) return;

        const toolName = `mcp_${client.name}`;

        // Build actions map: { toolMcpName: async (params) => client.callTool(...) }
        const actions = {};
        for (const tool of tools) {
            actions[tool.name] = async (params) => {
                return client.callTool(tool.name, params);
            };
        }

        // Build a rich description so the brain understands what's available
        const toolDocs = tools.map(t => {
            const props = t.inputSchema?.properties || {};
            const propList = Object.entries(props)
                .map(([k, v]) => `${k}${t.inputSchema?.required?.includes(k) ? '*' : ''}: ${v.description || v.type}`)
                .join(', ');
            return `  ${t.name}(${propList}) — ${t.description || ''}`;
        }).join('\n');

        const description = `${client.description}\nActions:\n${toolDocs}`;

        this.max.tools.register({ name: toolName, description, actions });

        console.log(`[MCPRegistry] 🛠️  Registered ${tools.length} tool(s) as "${toolName}"`);
    }

    // ─── Load config/mcp-servers.json ────────────────────────────────────
    _loadConfig() {
        if (!existsSync(CONFIG_PATH)) return [];
        try {
            const raw  = readFileSync(CONFIG_PATH, 'utf8');
            const data = JSON.parse(raw);
            return (data.servers || []).filter(s => s.name && s.command && s.enabled !== false);
        } catch (err) {
            console.warn(`[MCPRegistry] Config parse error: ${err.message}`);
            return [];
        }
    }

    // ─── Dynamically connect a server at runtime ──────────────────────────
    async connect(cfg) {
        if (this._clients.has(cfg.name)) {
            console.log(`[MCPRegistry] "${cfg.name}" already connected`);
            return this._clients.get(cfg.name).getStatus();
        }
        await this._connectServer(cfg);
        return this._clients.get(cfg.name)?.getStatus() || { error: 'Connection failed' };
    }

    // ─── Disconnect a server ──────────────────────────────────────────────
    disconnect(name) {
        const client = this._clients.get(name);
        if (!client) return false;
        client.disconnect();
        this._clients.delete(name);
        // Remove from ToolRegistry
        this.max.tools._tools?.delete(`mcp_${name}`);
        console.log(`[MCPRegistry] Disconnected "${name}"`);
        return true;
    }

    getStatus() {
        return {
            servers: [...this._clients.values()].map(c => c.getStatus()),
            count:   this._clients.size
        };
    }

    shutdown() {
        for (const client of this._clients.values()) client.disconnect();
        this._clients.clear();
    }
}
