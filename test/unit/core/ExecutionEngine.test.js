import { jest } from '@jest/globals';
import { assertSafeWorkspacePath, FileTools } from '../../../tools/FileTools.js';
import { ToolRegistry, ObservationTool } from '../../../tools/ToolRegistry.js';
import { MAX } from '../../../core/MAX.js';

describe('ExecutionEngine & Security Contracts', () => {
    describe('FileTools path containment', () => {
        it('rejects path traversal attempts outside workspace root', async () => {
            expect(() => assertSafeWorkspacePath('../secret.txt')).toThrow(/path traversal denied/i);
            expect(() => assertSafeWorkspacePath('../../windows/system32')).toThrow(/path traversal denied/i);
        });

        it('allows valid paths within workspace root', () => {
            const resolved = assertSafeWorkspacePath('src/index.js');
            expect(resolved).toBeTruthy();
        });

        it('returns success: false when tool action receives traversal path', async () => {
            const res = await FileTools.actions.read({ filePath: '../outside.txt' });
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/path traversal denied/i);
        });
    });

    describe('ToolRegistry structured enforcement', () => {
        it('registers and executes ObservationTool', async () => {
            const registry = new ToolRegistry();
            registry.register(ObservationTool);
            const res = await registry.execute('observation', 'record', {
                summary: 'Found 5 references',
                evidence: ['core/MAX.js:10', 'core/AgentLoop.js:20']
            });
            expect(res.success).toBe(true);
            expect(res.type).toBe('inspection');
            expect(res.summary).toBe('Found 5 references');
            expect(res.evidence).toHaveLength(2);
        });

        it('rejects malformed json parameter payload', async () => {
            const registry = new ToolRegistry();
            registry.register(ObservationTool);
            const res = await registry.executeLLMToolCall('TOOL:observation:record:{unquoted_json');
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/malformed/i);
        });
    });

    describe('MAX.execute() execution contract', () => {
        it('returns canonical contract for inspection execution', async () => {
            const max = new MAX({ mode: 'chat' });
            let turn = 0;
            max.brain = {
                _ready: true,
                getStatus: () => ({ backend: 'mock', smart: { ready: true } }),
                think: jest.fn(async () => {
                    turn++;
                    if (turn === 1) {
                        return { text: 'TOOL:file:grep:{"pattern":"execute","dir":"tools"}' };
                    }
                    if (turn === 2) {
                        return { text: 'TOOL:observation:record:{"summary":"found execute method","evidence":["tools/ToolRegistry.js:102"]}' };
                    }
                    return { text: 'Task completed. Found execute method in ToolRegistry.' };
                })
            };
            max.agentBrain = max.brain;
            max.tools.register(FileTools);
            max.tools.register(ObservationTool);
            max._ready = true;

            const result = await max.execute('Search tools for execute', { mode: 'inspect' });
            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('state');
            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('evidence');
            expect(result).toHaveProperty('toolsUsed');
            expect(result).toHaveProperty('toolResults');
            expect(result).toHaveProperty('verification');
            expect(result).toHaveProperty('errors');
            expect(result).toHaveProperty('nextStep');

            expect(result.success).toBe(true);
            expect(result.state).toBe('completed');
            expect(result.toolsUsed).toContain('file.grep');
            expect(result.toolsUsed).toContain('observation.record');
            expect(result.evidence.length).toBeGreaterThan(0);
        });

        it('rejects pure narrative prose in execution mode without tools', async () => {
            const max = new MAX({ mode: 'chat' });
            max.brain = {
                _ready: true,
                getStatus: () => ({ backend: 'mock', smart: { ready: true } }),
                think: jest.fn(async () => {
                    return { text: 'I checked all the files and everything is working properly!' };
                })
            };
            max.agentBrain = max.brain;
            max._ready = true;

            const result = await max.execute('Check file integrity', { mode: 'inspect' });
            expect(result.success).toBe(false);
            expect(['incomplete', 'blocked', 'failed']).toContain(result.state);
            expect(result.toolsUsed).toHaveLength(0);
        });
    });
});
