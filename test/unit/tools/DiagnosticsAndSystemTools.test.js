import { jest } from '@jest/globals';
import { createDiagnosticsTool } from '../../../tools/DiagnosticsTool.js';
import { createSystemTool } from '../../../tools/SystemTool.js';
import { ToolRegistry } from '../../../tools/ToolRegistry.js';
import { CognitiveFilter } from '../../../core/CognitiveFilter.js';

describe('Diagnostics & System Tools and Dispatcher Resolution', () => {
    let mockMax;

    beforeEach(() => {
        mockMax = {
            diagnostics: {
                scanners: [jest.fn(), jest.fn()],
                runAll: jest.fn().mockResolvedValue()
            },
            getQuickStatus: jest.fn().mockReturnValue({ ready: true, mode: 'test' }),
            getStatus: jest.fn().mockReturnValue({ ready: true }),
            world: {
                stats: { predictionsTested: 0 },
                getCurrentAccuracy: jest.fn().mockReturnValue(0)
            }
        };
    });

    describe('DiagnosticsTool', () => {
        test('provides run, status, and memory actions', async () => {
            const tool = createDiagnosticsTool(mockMax);
            expect(tool.name).toBe('diagnostics');

            // status action
            const statusRes = await tool.actions.status();
            expect(statusRes.success).toBe(true);
            expect(statusRes.status.ready).toBe(true);

            // run action
            const runRes = await tool.actions.run();
            expect(runRes.success).toBe(true);
            expect(mockMax.diagnostics.runAll).toHaveBeenCalled();
            expect(runRes.scannersRun).toBe(2);

            // memory action
            const memRes = await tool.actions.memory();
            expect(memRes.success).toBe(true);
            expect(memRes.process).toHaveProperty('heapUsedMB');
            expect(memRes.system).toHaveProperty('freeMB');
        });
    });

    describe('SystemTool enhancements', () => {
        test('provides diagnostics and status actions', async () => {
            const tool = createSystemTool(mockMax);
            expect(tool.name).toBe('system');

            const statusRes = await tool.actions.status();
            expect(statusRes.success).toBe(true);
            expect(statusRes.status.ready).toBe(true);

            const diagRes = await tool.actions.diagnostics();
            expect(diagRes.success).toBe(true);
            expect(mockMax.diagnostics.runAll).toHaveBeenCalled();
        });
    });

    describe('ToolRegistry aliasing and resolution', () => {
        let registry;

        beforeEach(() => {
            registry = new ToolRegistry();
            registry.register(createDiagnosticsTool(mockMax));
            registry.register(createSystemTool(mockMax));
        });

        test('resolves canonical calls directly', () => {
            const res1 = registry.resolveCall('diagnostics', 'status');
            expect(res1.success).toBe(true);
            expect(res1.toolName).toBe('diagnostics');
            expect(res1.action).toBe('status');

            const res2 = registry.resolveCall('system', 'status');
            expect(res2.success).toBe(true);
            expect(res2.action).toBe('status');
        });

        test('resolves action aliases for diagnostics and system', () => {
            const checkRes = registry.resolveCall('diagnostics', 'check');
            expect(checkRes.success).toBe(true);
            expect(checkRes.action).toBe('status');

            const auditRes = registry.resolveCall('diagnostics', 'audit');
            expect(auditRes.success).toBe(true);
            expect(auditRes.action).toBe('run');

            const healthRes = registry.resolveCall('system', 'health');
            expect(healthRes.success).toBe(true);
            expect(healthRes.action).toBe('diagnostics');
        });

        test('resolves tool name aliases like health and sys', () => {
            const healthTool = registry.resolveCall('health', 'check');
            expect(healthTool.success).toBe(true);
            expect(healthTool.toolName).toBe('diagnostics');
            expect(healthTool.action).toBe('status');

            const sysTool = registry.resolveCall('sys', 'status');
            expect(sysTool.success).toBe(true);
            expect(sysTool.toolName).toBe('system');
        });

        test('executes tool call via execute() with resolved aliases', async () => {
            const execRes = await registry.execute('diagnostics', 'check');
            expect(execRes.success).toBe(true);
            expect(execRes.status.ready).toBe(true);
        });
    });

    describe('CognitiveFilter Cold-Start & Non-greedy Regex', () => {
        test('does not block tool call on cold start when predictions are untested', async () => {
            const filter = new CognitiveFilter(mockMax);
            const text = 'Let me check that for you. TOOL:diagnostics:status:{}';
            const res = await filter.process(text);
            expect(res.confidence).toBeGreaterThanOrEqual(0.5);
            expect(res.filteredText).not.toContain('TOOL_BLOCKED');
        });

        test('regex does not mangles multi-tool call parameters on one line', async () => {
            // Force low confidence with multiple hedges
            const filter = new CognitiveFilter(mockMax);
            const text = 'Maybe possibly perhaps I think TOOL:git:clone:{"url":"https://github.com/foo.git","dest":"./bar"} TOOL:file:read:{"path":"bar/pkg.json"}';
            const res = await filter.process(text);
            expect(res.confidence).toBeLessThan(0.5);
            expect(res.filteredText).toContain('TOOL_BLOCKED');
            // The JSON destinations and paths must NOT have been swallowed
            expect(res.filteredText).toContain('"dest":"./bar"');
            expect(res.filteredText).toContain('"path":"bar/pkg.json"');
            // Must NOT have mangled into TOOL_BLOCKED :"./bar"}
            expect(res.filteredText).not.toContain('TOOL_BLOCKED :"./bar"}');
        });
    });
});
