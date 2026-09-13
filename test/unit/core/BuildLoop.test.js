import { jest } from '@jest/globals';
import { BuildLoop } from '../../../core/loops/BuildLoop.js';

function makeMockMax(overrides = {}) {
    const thinkMock = jest.fn(async (prompt) => {
        if (typeof prompt === 'string' && prompt.includes('Reply with only YES or NO')) {
            return { text: 'YES' };
        }
        return { text: 'Approved draft plan' };
    });

    return {
        agentBrain: {
            think: thinkMock
        },
        brain: {
            think: thinkMock
        },
        tools: {
            execute: jest.fn(async (tool, action, params) => {
                if (tool === 'file' && action === 'grep') {
                    return { matches: [{ file: 'core/Brain.js' }] };
                }
                if (tool === 'file' && action === 'read') {
                    return { content: 'export class Brain {}' };
                }
                if (tool === 'shell' && action === 'run') {
                    return { success: true, code: 0, stdout: '1 file changed', stderr: '' };
                }
                return { success: true };
            })
        },
        executeAgenticThink: jest.fn(async () => ({
            text: 'DONE: created test',
            summary: 'DONE: created test',
            toolCallsMade: [
                'TOOL:file:write:{"filePath":"test/unit/core/BuildLoop.test.js","content":"// test"}'
            ]
        })),
        outcomes: {
            record: jest.fn()
        },
        soma: {
            available: true,
            remember: jest.fn(async () => {}),
            promoteToMainSoma: jest.fn(async () => ({ success: true })),
            notifyFileChanged: jest.fn(async () => {})
        },
        ...overrides
    };
}

describe('BuildLoop', () => {
    let loop;

    beforeEach(() => {
        loop = new BuildLoop();
    });

    describe('_extractFilePaths', () => {
        it('extracts valid file paths and ignores http URLs', () => {
            const text = 'Check out ./core/MAX.js and C:\\Users\\barry\\Desktop\\MAX\\core\\Brain.js and http://example.com/file.js';
            const paths = loop._extractFilePaths(text);
            expect(paths.some(p => p.includes('MAX.js'))).toBe(true);
            expect(paths.some(p => p.includes('Brain.js'))).toBe(true);
            expect(paths.some(p => p.startsWith('http'))).toBe(false);
        });
    });

    describe('_research', () => {
        it('greps keywords and reads discovered files', async () => {
            const max = makeMockMax();
            const goal = { title: 'Implement Brain test', description: 'Add tests for Brain.js' };
            const research = await loop._research(goal, max);

            expect(max.tools.execute).toHaveBeenCalledWith('file', 'grep', expect.any(Object));
            expect(research['core/Brain.js']).toBe('export class Brain {}');
        });
    });

    describe('_draft', () => {
        it('calls brain to generate implementation plan', async () => {
            const max = makeMockMax();
            const goal = { title: 'Add test suite', description: 'Testing BuildLoop' };
            const research = { 'core/loops/BuildLoop.js': 'class BuildLoop {}' };

            const draft = await loop._draft(goal, research, max);
            expect(draft).toBe('Approved draft plan');
            expect(max.agentBrain.think).toHaveBeenCalledWith(
                expect.stringContaining('Add test suite'),
                expect.objectContaining({ tier: 'smart' })
            );
        });
    });

    describe('_execute', () => {
        it('delegates to max.executeAgenticThink and extracts modified files', async () => {
            const max = makeMockMax();
            const goal = { title: 'Create BuildLoop.test.js' };
            const plan = 'Step 1: write test file';

            const result = await loop._execute(goal, plan, {}, max);
            expect(max.executeAgenticThink).toHaveBeenCalled();
            expect(result.modifiedFiles).toContain('test/unit/core/BuildLoop.test.js');
        });
    });

    describe('_verify', () => {
        it('runs verifyCommand if present', async () => {
            const max = makeMockMax();
            const goal = { title: 'Fix bug', verifyCommand: 'node --check core/MAX.js' };
            const execResult = { summary: 'Fixed syntax', modifiedFiles: ['core/MAX.js'] };

            const verified = await loop._verify(goal, execResult, max);
            expect(max.tools.execute).toHaveBeenCalledWith('shell', 'run', {
                command: 'node --check core/MAX.js',
                cwd: expect.any(String)
            });
            expect(verified).toBe(true);
        });

        it('uses git evidence and brain verification if no verifyCommand', async () => {
            const max = makeMockMax();
            const goal = { title: 'Add feature' };
            const execResult = { summary: 'Implemented feature', modifiedFiles: ['core/Brain.js'] };

            const verified = await loop._verify(goal, execResult, max);
            expect(verified).toBe(true);
            expect(max.agentBrain.think).toHaveBeenCalledWith(
                expect.stringContaining('Did this action successfully complete the goal?'),
                expect.objectContaining({ tier: 'fast' })
            );
        });
    });

    describe('run (full lifecycle)', () => {
        it('completes the build loop successfully', async () => {
            const max = makeMockMax();
            const goal = {
                title: 'Missing Test: BuildLoop.js',
                type: 'task',
                description: 'Create unit tests'
            };

            const outcome = await loop.run(goal, max);
            expect(outcome.success).toBe(true);
            expect(max.outcomes.record).toHaveBeenCalledWith(expect.objectContaining({
                agent: 'BuildLoop',
                success: true
            }));
        });
    });
});
