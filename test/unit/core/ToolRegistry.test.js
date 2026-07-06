import { jest } from '@jest/globals';
import { ToolRegistry } from '../../../tools/ToolRegistry.js';

function makeRegistry() {
    return new ToolRegistry();
}

describe('ToolRegistry', () => {
    describe('register / get / has', () => {
        it('registers a tool and retrieves it by name', () => {
            const r = makeRegistry();
            const tool = { name: 'file', description: 'File operations', actions: { read: jest.fn() } };
            r.register(tool);
            expect(r.get('file')).toBe(tool);
        });

        it('has() returns true for registered tool', () => {
            const r = makeRegistry();
            r.register({ name: 'shell', actions: {} });
            expect(r.has('shell')).toBe(true);
        });

        it('has() returns false for unknown tool', () => {
            const r = makeRegistry();
            expect(r.has('nonexistent')).toBe(false);
        });

        it('throws when registering a tool without a name', () => {
            const r = makeRegistry();
            expect(() => r.register({ actions: {} })).toThrow();
        });

        it('overwrites an existing registration with the same name', () => {
            const r = makeRegistry();
            const v1 = { name: 'file', description: 'v1', actions: {} };
            const v2 = { name: 'file', description: 'v2', actions: {} };
            r.register(v1);
            r.register(v2);
            expect(r.get('file').description).toBe('v2');
        });
    });

    describe('list()', () => {
        it('returns name, description, and actions for each tool', () => {
            const r = makeRegistry();
            r.register({ name: 'file', description: 'File ops', actions: { read: jest.fn(), write: jest.fn() } });
            r.register({ name: 'shell', description: 'Shell ops', actions: { run: jest.fn() } });
            const list = r.list();
            expect(list).toHaveLength(2);
            const fileTool = list.find(t => t.name === 'file');
            expect(fileTool.actions).toEqual(expect.arrayContaining(['read', 'write']));
        });

        it('returns empty array when no tools registered', () => {
            expect(makeRegistry().list()).toHaveLength(0);
        });
    });

    describe('execute()', () => {
        it('calls the correct action function with params', async () => {
            const r = makeRegistry();
            const readFn = jest.fn(async () => ({ success: true, content: 'hello' }));
            r.register({ name: 'file', actions: { read: readFn } });
            const result = await r.execute('file', 'read', { filePath: 'x.js' });
            expect(readFn).toHaveBeenCalledWith({ filePath: 'x.js' });
            expect(result.content).toBe('hello');
        });

        it('returns { success: false } for unknown tool', async () => {
            const r = makeRegistry();
            const result = await r.execute('unknown', 'read', {});
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/unknown tool/i);
        });

        it('returns { success: false } for unknown action', async () => {
            const r = makeRegistry();
            r.register({ name: 'file', actions: { read: jest.fn() } });
            const result = await r.execute('file', 'nonexistent_action', {});
            expect(result.success).toBe(false);
            expect(result.error).toContain('Valid actions: read');
        });

        it('normalizes the shell.runStateful model alias before execution', async () => {
            const r = makeRegistry();
            const runFn = jest.fn(async () => ({ success: true }));
            r.register({ name: 'shell', actions: { run: runFn } });
            await r.execute('shell', 'runStateful', { command: 'node --version' });
            expect(runFn).toHaveBeenCalledWith({ command: 'node --version' });
        });

        it('resolves tool and action names case-insensitively', async () => {
            const r = makeRegistry();
            const statusFn = jest.fn(async () => ({ success: true }));
            r.register({ name: 'soma', actions: { status: statusFn } });
            await r.execute('SOMA', 'STATUS', {});
            expect(statusFn).toHaveBeenCalledWith({});
        });

        it('catches errors thrown by action and returns { success: false }', async () => {
            const r = makeRegistry();
            r.register({ name: 'boom', actions: { explode: async () => { throw new Error('kaboom'); } } });
            const result = await r.execute('boom', 'explode', {});
            expect(result.success).toBe(false);
            expect(result.error).toBe('kaboom');
        });

        it('supports class-based tools with a run() method', async () => {
            const r = makeRegistry();
            const runFn = jest.fn(async () => ({ success: true }));
            r.register({ name: 'git', run: runFn });
            await r.execute('git', 'status', { cwd: '.' });
            expect(runFn).toHaveBeenCalledWith({ action: 'status', cwd: '.' });
        });
    });

    describe('executeLLMToolCall()', () => {
        it('parses and executes TOOL:name:action:{json}', async () => {
            const r = makeRegistry();
            const readFn = jest.fn(async () => ({ success: true, content: 'data' }));
            r.register({ name: 'file', actions: { read: readFn } });
            const result = await r.executeLLMToolCall('TOOL:file:read:{"filePath":"src/index.js"}');
            expect(readFn).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'src/index.js' }));
            expect(result.success).toBe(true);
        });

        it('returns null for non-TOOL prefixed input', async () => {
            const r = makeRegistry();
            const result = await r.executeLLMToolCall('Just a normal response.');
            expect(result).toBeNull();
        });

        it('returns error for malformed tool call (too few parts)', async () => {
            const r = makeRegistry();
            const result = await r.executeLLMToolCall('TOOL:only_one_part');
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/malformed/i);
        });

        it('handles TOOL call with no JSON params', async () => {
            const r = makeRegistry();
            const statusFn = jest.fn(async () => ({ success: true }));
            r.register({ name: 'git', actions: { status: statusFn } });
            await r.executeLLMToolCall('TOOL:git:status');
            expect(statusFn).toHaveBeenCalledWith({});
        });

        it('handles TOOL call with a simple string fallback param', async () => {
            const r = makeRegistry();
            const fn = jest.fn(async () => ({ success: true }));
            r.register({ name: 'shell', actions: { run: fn } });
            await r.executeLLMToolCall('TOOL:shell:run:npm test');
            expect(fn).toHaveBeenCalledWith(expect.objectContaining({ value: 'npm test' }));
        });
    });

    describe('parseToolCalls()', () => {
        it('parses basic JSON parameters correctly', () => {
            const r = makeRegistry();
            const res = r.parseToolCalls('Here is a call:\nTOOL:file:read:{"filePath": "foo.js"}');
            expect(res).toHaveLength(1);
            expect(res[0].toolName).toBe('file');
            expect(res[0].actionName).toBe('read');
            expect(res[0].params.filePath).toBe('foo.js');
        });

        it('parses nested braces inside JSON strings correctly', () => {
            const r = makeRegistry();
            const res = r.parseToolCalls('TOOL:file:replace:{"filePath": "foo.js", "content": "class A { constructor() { this.x = 1; } }"}\nand text after.');
            expect(res).toHaveLength(1);
            expect(res[0].params.filePath).toBe('foo.js');
            expect(res[0].params.content).toBe('class A { constructor() { this.x = 1; } }');
            expect(res[0].raw).toBe('TOOL:file:replace:{"filePath": "foo.js", "content": "class A { constructor() { this.x = 1; } }"}');
        });

        it('handles simple string parameters (fallbacks)', () => {
            const r = makeRegistry();
            const res = r.parseToolCalls('TOOL:shell:run:npm run test');
            expect(res).toHaveLength(1);
            expect(res[0].toolName).toBe('shell');
            expect(res[0].actionName).toBe('run');
            expect(res[0].params.value).toBe('npm run test');
        });

        it('parses multiple tool calls from a single text block', () => {
            const r = makeRegistry();
            const text = 'First:\nTOOL:file:read:{"path":"a"}\nSecond:\nTOOL:file:write:{"path":"b","content":"c"}';
            const res = r.parseToolCalls(text);
            expect(res).toHaveLength(2);
            expect(res[0].toolName).toBe('file');
            expect(res[0].params.path).toBe('a');
            expect(res[1].toolName).toBe('file');
            expect(res[1].params.path).toBe('b');
        });
    });

    describe('buildManifest()', () => {
        it('includes tool name in manifest string', () => {
            const r = makeRegistry();
            r.register({ name: 'file', description: 'Read and write files', actions: { read: jest.fn(), write: jest.fn() } });
            const manifest = r.buildManifest();
            expect(manifest).toContain('file');
            expect(manifest).toContain('read');
        });

        it('returns empty manifest header when no tools registered', () => {
            const manifest = makeRegistry().buildManifest();
            expect(manifest).toContain('## Available Tools');
        });
    });
});
