import { jest } from '@jest/globals';
import { CuriosityEngine } from '../../../core/CuriosityEngine.js';
import fs from 'fs/promises';
import path from 'path';

describe('CuriosityEngine', () => {
    let engine;
    let mockMax;
    const testLogPath = path.resolve('.max', 'dataset', 'test_curiosity_chains.jsonl');

    beforeEach(async () => {
        mockMax = {
            tools: {
                execute: jest.fn(async (tool, action, params) => {
                    if (tool === 'git' && action === 'branch') return { output: '* feature/curiosity\n  main' };
                    if (tool === 'git' && action === 'log') return { output: 'abc1234 feat: epistemic engine' };
                    if (tool === 'git' && action === 'status') return { output: 'M core/CuriosityEngine.js' };
                    if (tool === 'web' && action === 'search') {
                        return {
                            success: true,
                            results: [
                                { title: 'Autonomous Reasoning Patterns', url: 'https://example.com/reasoning', snippet: 'Recursive self-prompting enables deeper truth.' }
                            ]
                        };
                    }
                    if (tool === 'file' && action === 'read') {
                        return { success: true, path: params.filePath, content: 'export class TestSubject {}', lines: 1 };
                    }
                    return { success: false, error: 'Unknown tool call' };
                })
            },
            brain: {
                think: jest.fn(async (prompt, options) => {
                    return {
                        text: `[Observation]: The agent observes autonomous behaviors.\n[Root Cause - Why 1]: Because recursive causal loops find root drivers.\n[Purpose & Alignment - Why 2 & 3]: This helps Barry by ensuring zero hallucination.\n[Synthesis]: Causal inquiry produces grounded engineering wisdom.`
                    };
                })
            },
            goals: {
                listActive: jest.fn(() => [{ title: 'Build autonomous agent', priority: 0.8 }]),
                addGoal: jest.fn()
            },
            drive: {
                getStatus: jest.fn(() => ({ tension: 0.65 }))
            },
            kb: {
                remember: jest.fn()
            },
            memory: {
                remember: jest.fn(),
                search: jest.fn(async () => ['Barry is designing the next generation agent.'])
            },
            profile: {
                get: jest.fn(() => ({ name: 'Barry', role: 'Architect' }))
            },
            notifier: {
                enabled: true,
                notify: jest.fn()
            }
        };

        engine = new CuriosityEngine({
            max: mockMax,
            curiosityLogPath: testLogPath,
            outreachCooldownMs: 1000,
            quietHoursStart: 24, // disable quiet hours in test
            quietHoursEnd: 0
        });

        // Clean up any test log file
        try {
            await fs.unlink(testLogPath);
        } catch {}
    });

    afterEach(async () => {
        try {
            await fs.unlink(testLogPath);
        } catch {}
    });

    test('initializes with seed topics and default state', () => {
        const status = engine.getStatus();
        expect(status.queueDepth).toBe(0);
        expect(status.knowledgeGaps).toBe(0);
        expect(status.topicsExplored).toBe(0);
        expect(status.isInvestigating).toBe(false);
    });

    test('orient() extracts ground-truth system and environment state', async () => {
        const orientation = await engine.orient(mockMax);
        expect(orientation.branch).toBe('feature/curiosity');
        expect(orientation.recentCommits).toContain('abc1234');
        expect(orientation.gitStatus).toContain('CuriosityEngine.js');
        expect(orientation.activeGoals).toContain('Build autonomous agent');
        expect(orientation.tension).toBe(0.65);
        expect(orientation.uptimeFormatted).toBeDefined();
    });

    test('generateCuriosityVector prioritizes queued tasks over default seeds', async () => {
        engine.queueTask('Custom Task', 'Explore quantum computing', 0.9);
        const vector = await engine.generateCuriosityVector(mockMax);
        expect(vector.topic).toBe('Custom Task');
        expect(vector.targetType).toBe('queued');
    });

    test('generateCuriosityVector prioritizes knowledge gaps when no queue', async () => {
        engine.addKnowledgeGap('distributed consensus algorithms', 0.85);
        const vector = await engine.generateCuriosityVector(mockMax);
        expect(vector.topic).toBe('distributed consensus algorithms');
        expect(vector.targetType).toBe('web');
    });

    test('investigate() executes web search tool for web vector', async () => {
        const vector = { topic: 'Autonomous Reasoning', targetType: 'web', targetQuery: 'Autonomous Reasoning' };
        const result = await engine.investigate(mockMax, vector);
        expect(result.success).toBe(true);
        expect(mockMax.tools.execute).toHaveBeenCalledWith('web', 'search', expect.objectContaining({ query: 'Autonomous Reasoning' }));
        expect(result.observationText).toContain('Autonomous Reasoning Patterns');
    });

    test('investigate() executes file read tool for codebase vector', async () => {
        const vector = { topic: 'Test Class', targetType: 'codebase', targetQuery: 'core/TestSubject.js' };
        const result = await engine.investigate(mockMax, vector);
        expect(result.success).toBe(true);
        expect(mockMax.tools.execute).toHaveBeenCalledWith('file', 'read', expect.objectContaining({ filePath: 'core/TestSubject.js' }));
        expect(result.observationText).toContain('TestSubject');
    });

    test('investigate() executes memory search for relational vector', async () => {
        const vector = { topic: "Barry's current objectives", targetType: 'relational', targetQuery: 'Barry' };
        const result = await engine.investigate(mockMax, vector);
        expect(result.success).toBe(true);
        expect(mockMax.memory.search).toHaveBeenCalledWith('Barry', 3);
        expect(result.observationText).toContain('Barry is designing');
    });

    test('reasonWhyChain() invokes local model at zero cost and synthesizes causal chain', async () => {
        const vector = { topic: 'Resilience' };
        const investigation = { observationText: 'Subsystems handle disconnection gracefully.' };
        const { whyChain, synthesis } = await engine.reasonWhyChain(mockMax, vector, investigation);

        expect(mockMax.brain.think).toHaveBeenCalledWith(
            expect.stringContaining('Conduct a 3-layer recursive \'Why?\' causal breakdown'),
            expect.objectContaining({ tier: 'fast' }) // strictly local tier
        );
        expect(whyChain).toContain('[Observation]');
        expect(whyChain).toContain('[Root Cause - Why 1]');
        expect(synthesis).toContain('Causal inquiry produces grounded engineering wisdom');
    });

    test('harvestToDataset() emits valid JSONL for LoRA training', async () => {
        const vector = { topic: 'Async Pipeline Resilience', prompt: 'Explore pipeline fault tolerance' };
        const whyChain = '[Observation]: Tests pass.\n[Synthesis]: Resilience is key.';
        const synthesis = 'Resilience is key.';

        await engine.harvestToDataset(vector, whyChain, synthesis);

        const content = await fs.readFile(testLogPath, 'utf8');
        const parsed = JSON.parse(content.trim());
        expect(parsed.topic).toBe('Async Pipeline Resilience');
        expect(parsed.source).toBe('curiosity_engine');
        expect(parsed.instruction).toContain('Async Pipeline Resilience');
        expect(parsed.why_chain).toBe(whyChain);
        expect(parsed.synthesis).toBe(synthesis);
    });

    test('evaluateOutreach() sends genuine check-in when tension is elevated', async () => {
        const vector = { topic: 'Neural Architecture Search', targetType: 'web' };
        const synthesis = 'Discovered critical optimization for autonomous memory retrieval.';

        const delivered = await engine.evaluateOutreach(mockMax, vector, synthesis);
        expect(delivered).toBe(true);
        expect(mockMax.notifier.notify).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ force: true })
        );
        expect(engine.lastOutreachTime).toBeGreaterThan(0);
    });

    test('signalsGoal() correctly identifies action-worthy discoveries', () => {
        expect(engine.signalsGoal('We found a critical vulnerability that should be fixed immediately.')).toBe(true);
        expect(engine.signalsGoal('The system is completely normal and no action is required.')).toBe(false);
    });

    test('runCuriosityCycle() executes full end-to-end loop', async () => {
        const result = await engine.runCuriosityCycle(mockMax);
        expect(result).not.toBeNull();
        expect(result.label).toBeDefined();
        expect(result.whyChain).toBeDefined();
        expect(result.synthesis).toBeDefined();
        expect(mockMax.kb.remember).toHaveBeenCalled();
        expect(mockMax.memory.remember).toHaveBeenCalled();

        // Dataset written
        const content = await fs.readFile(testLogPath, 'utf8');
        expect(content.length).toBeGreaterThan(0);
    });

    test('backward compatibility methods operate as expected', () => {
        engine.addKnowledgeGap('gap 1', 0.7);
        engine.addKnowledgeGap('gap 2', 0.9);
        expect(engine.knowledgeGaps[0].topic).toBe('gap 2'); // sorted by priority

        engine.queueTask('task 1', 'prompt 1', 0.5);
        const next = engine.getNextTask();
        expect(next.label).toBe('task 1');

        engine.onTaskComplete({ label: 'test task' }, 'Found references to `vector_store` and `event_bus` in code.');
        expect(engine.taskQueue.length).toBeGreaterThan(0); // auto-enqueued follow-ups
    });
});
