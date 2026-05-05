#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// MaxMCPServer.mjs — MAX as an MCP (Model Context Protocol) server
//
// Exposes MAX's core tools over stdio so Claude Code, Cursor, and any other
// MCP-compatible client can use MAX's capabilities directly.
//
// Add to claude_desktop_config.json or .mcp.json:
// {
//   "mcpServers": {
//     "max": {
//       "command": "node",
//       "args": ["C:/Users/barry/Desktop/MAX/mcp/MaxMCPServer.mjs"]
//     }
//   }
// }
//
// Tools exposed:
//   max_shell    — run shell commands in MAX's persistent shell
//   max_research — deep web research + KB storage
//   max_think    — ask MAX's brain a question
//   max_file     — read/write/list files
//   max_goal     — queue an autonomous goal into AgentLoop
//   max_status   — get MAX's current status (goals, drive, processes)
// ═══════════════════════════════════════════════════════════════════════════

import { createInterface } from 'readline';

// ── JSON-RPC / MCP wire protocol over stdio ───────────────────────────────
const rl = createInterface({ input: process.stdin, terminal: false });

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendResult(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ── Tool definitions (MCP schema) ─────────────────────────────────────────
const TOOLS = [
    {
        name:        'max_shell',
        description: 'Run a shell command via MAX\'s persistent shell (keeps working directory and environment across calls)',
        inputSchema: {
            type: 'object',
            properties: {
                command:   { type: 'string', description: 'Shell command to run' },
                timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 60000)' }
            },
            required: ['command']
        }
    },
    {
        name:        'max_research',
        description: 'Deep web research: searches multiple sources, extracts facts, stores results in MAX\'s knowledge base',
        inputSchema: {
            type: 'object',
            properties: {
                query:    { type: 'string', description: 'What to research' },
                maxPages: { type: 'number', description: 'Number of pages to read (default: 3)' },
                storeInKB:{ type: 'boolean', description: 'Store findings in MAX\'s KB (default: true)' }
            },
            required: ['query']
        }
    },
    {
        name:        'max_think',
        description: 'Ask MAX\'s brain a question — uses smart tier (DeepSeek) with full persona and memory context',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: 'Message or question for MAX' },
                tier:    { type: 'string', enum: ['fast', 'smart', 'code'], description: 'Brain tier to use' }
            },
            required: ['message']
        }
    },
    {
        name:        'max_file',
        description: 'Read, write, or list files on the filesystem',
        inputSchema: {
            type: 'object',
            properties: {
                action:   { type: 'string', enum: ['read', 'write', 'list', 'search'], description: 'File action' },
                filePath: { type: 'string', description: 'File or directory path' },
                content:  { type: 'string', description: 'Content to write (for write action)' },
                query:    { type: 'string', description: 'Search query (for search action)' }
            },
            required: ['action', 'filePath']
        }
    },
    {
        name:        'max_goal',
        description: 'Queue an autonomous engineering goal into MAX\'s AgentLoop — MAX will work on it in the background',
        inputSchema: {
            type: 'object',
            properties: {
                title:       { type: 'string', description: 'Short goal title' },
                description: { type: 'string', description: 'Detailed description of what to accomplish' },
                type:        { type: 'string', enum: ['fix', 'task', 'research', 'improvement'], description: 'Goal type' },
                priority:    { type: 'number', description: 'Priority 0.0-1.0 (default: 0.7)' }
            },
            required: ['title']
        }
    },
    {
        name:        'max_status',
        description: 'Get MAX\'s current status: active goals, drive state, running processes, brain backends',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    }
];

// ── MAX connection — lazy-loaded when first tool call arrives ─────────────
let max = null;

async function getMax() {
    if (max) return max;

    // Import MAX and spin up a headless instance (no REPL, no server)
    const { MAX: MaxClass } = await import('../core/MAX.js');
    max = new MaxClass({ mode: 'mcp' });
    await max.initialize();
    return max;
}

// ── Tool execution ─────────────────────────────────────────────────────────
async function executeTool(name, args) {
    const m = await getMax();

    switch (name) {
        case 'max_shell': {
            const result = await m.tools.execute('shell', 'run', {
                command:   args.command,
                timeoutMs: args.timeoutMs || 60_000
            });
            return {
                content: [{
                    type: 'text',
                    text: [
                        `Exit: ${result.code}`,
                        result.stdout ? `stdout:\n${result.stdout}` : '',
                        result.stderr ? `stderr:\n${result.stderr}` : ''
                    ].filter(Boolean).join('\n\n')
                }]
            };
        }

        case 'max_research': {
            const result = await m.research.research(args.query, {
                maxPages:  args.maxPages  || 3,
                storeInKB: args.storeInKB ?? true
            });
            return {
                content: [{
                    type: 'text',
                    text: result.success
                        ? `# Research: ${args.query}\n\n${result.synthesis}\n\nSources: ${result.sources?.join(', ')}\nFacts extracted: ${result.facts?.length}`
                        : `Research failed: ${result.error}`
                }]
            };
        }

        case 'max_think': {
            const result = await m.brain.think(args.message, {
                tier:     args.tier || 'smart',
                maxTokens: 2048
            });
            return {
                content: [{ type: 'text', text: result.text }]
            };
        }

        case 'max_file': {
            const result = await m.tools.execute('file', args.action, {
                filePath: args.filePath,
                content:  args.content,
                query:    args.query
            });
            return {
                content: [{
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }]
            };
        }

        case 'max_goal': {
            if (!m.goals) throw new Error('MAX GoalEngine not initialized');
            const goalId = m.goals.addGoal({
                title:       args.title,
                description: args.description || args.title,
                type:        args.type        || 'task',
                priority:    args.priority    || 0.7,
                source:      'mcp'
            });
            return {
                content: [{
                    type: 'text',
                    text: `Goal queued: "${args.title}" (id: ${goalId})\nMAX will work on it autonomously.`
                }]
            };
        }

        case 'max_status': {
            const status = m.getStatus();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(status, null, 2)
                }]
            };
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

// ── MCP message handler ───────────────────────────────────────────────────
rl.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line.trim()); }
    catch { return; }

    const { id, method, params } = msg;

    try {
        switch (method) {
            // Handshake
            case 'initialize':
                sendResult(id, {
                    protocolVersion: '2024-11-05',
                    capabilities:    { tools: {} },
                    serverInfo:      { name: 'max-agent', version: '1.0.0' }
                });
                break;

            case 'notifications/initialized':
                break;  // no response needed

            // Tool listing
            case 'tools/list':
                sendResult(id, { tools: TOOLS });
                break;

            // Tool execution
            case 'tools/call': {
                const { name, arguments: args } = params;
                const result = await executeTool(name, args || {});
                sendResult(id, result);
                break;
            }

            // Ping
            case 'ping':
                sendResult(id, {});
                break;

            default:
                sendError(id, -32601, `Method not found: ${method}`);
        }
    } catch (err) {
        sendError(id, -32603, err.message);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

// Signal ready
process.stderr.write('[MAX MCP] Server started — listening on stdio\n');
