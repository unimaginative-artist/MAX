import { jest } from '@jest/globals';
import { ReflectionEngine } from '../../../core/ReflectionEngine.js';
import fs from 'fs';

const originalExistsSync = fs.existsSync;
const originalWriteFileSync = fs.writeFileSync;
const originalReadFileSync = fs.readFileSync;

describe('ReflectionEngine Unit Tests', () => {
    let mockBrain;
    let mockGoals;
    let mockOutcomes;
    let engine;
    let fsExistsSpy;
    let fsWriteSpy;
    let fsReadSpy;

    beforeEach(() => {
        mockBrain = {
            think: jest.fn(),
            _ready: true
        };
        mockGoals = {
            addGoal: jest.fn()
        };
        mockOutcomes = {
            record: jest.fn()
        };

        // Spy on fs to avoid actual disk read/writes during tests for self_model.json
        fsExistsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((path) => {
            if (typeof path === 'string' && path.includes('self_model.json')) {
                return false;
            }
            return originalExistsSync(path);
        });

        fsWriteSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
            if (typeof path === 'string' && path.includes('self_model.json')) {
                return;
            }
            return originalWriteFileSync(path, data, options);
        });

        fsReadSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((path, options) => {
            if (typeof path === 'string' && path.includes('self_model.json')) {
                return '{}';
            }
            return originalReadFileSync(path, options);
        });

        engine = new ReflectionEngine(mockBrain, mockGoals, mockOutcomes);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Initialization', () => {
        it('should initialize with empty behaviorDirectives array', () => {
            expect(engine._selfModel.behaviorDirectives).toEqual([]);
        });
    });

    describe('Feedback Extraction', () => {
        it('should extract a directive if the user gives a behavioral correction', async () => {
            mockBrain.think.mockResolvedValue({
                text: JSON.stringify({
                    isCorrection: true,
                    directive: 'Do not use markdown tables'
                })
            });

            await engine._detectAndExtractFeedback('Stop using tables, they break my parser', 'Understood.');

            expect(engine._selfModel.behaviorDirectives).toContain('Do not use markdown tables');
            expect(fsWriteSpy).toHaveBeenCalled();
        });

        it('should ignore duplicate behavioral directives', async () => {
            mockBrain.think.mockResolvedValue({
                text: JSON.stringify({
                    isCorrection: true,
                    directive: 'Be concise'
                })
            });

            await engine._detectAndExtractFeedback('Please be concise', 'Okay.');
            await engine._detectAndExtractFeedback('Please be concise', 'Okay.');

            expect(engine._selfModel.behaviorDirectives).toEqual(['Be concise']);
            expect(engine._selfModel.behaviorDirectives.length).toBe(1);
        });

        it('should discard oldest directive if the length exceeds 10', async () => {
            engine._selfModel.behaviorDirectives = [
                'Rule 1', 'Rule 2', 'Rule 3', 'Rule 4', 'Rule 5',
                'Rule 6', 'Rule 7', 'Rule 8', 'Rule 9', 'Rule 10'
            ];

            mockBrain.think.mockResolvedValue({
                text: JSON.stringify({
                    isCorrection: true,
                    directive: 'Rule 11'
                })
            });

            await engine._detectAndExtractFeedback('New rule please', 'Okay.');

            expect(engine._selfModel.behaviorDirectives).toHaveLength(10);
            expect(engine._selfModel.behaviorDirectives).not.toContain('Rule 1');
            expect(engine._selfModel.behaviorDirectives[9]).toBe('Rule 11');
        });

        it('should not extract a directive if the user is just chatting', async () => {
            mockBrain.think.mockResolvedValue({
                text: JSON.stringify({
                    isCorrection: false,
                    directive: null
                })
            });

            await engine._detectAndExtractFeedback('Hello MAX!', 'Hello Barry!');

            expect(engine._selfModel.behaviorDirectives).toEqual([]);
            expect(fsWriteSpy).not.toHaveBeenCalled();
        });
    });

    describe('Prompt Context Injection', () => {
        it('should return empty string if there are no directives or reflection data', () => {
            expect(engine.getSelfModelContext()).toBe('');
        });

        it('should append active behavior directives to prompt context if present', () => {
            engine._selfModel.behaviorDirectives = ['Follow instructions strictly', 'Avoid explanations'];

            const ctx = engine.getSelfModelContext();
            expect(ctx).toContain('Active Style/Behavior Rules (Follow strictly):');
            expect(ctx).toContain('- Follow instructions strictly');
            expect(ctx).toContain('- Avoid explanations');
        });
    });

    describe('Clearing Directives', () => {
        it('should clear behaviorDirectives and persist to disk', () => {
            engine._selfModel.behaviorDirectives = ['Rule A', 'Rule B'];
            engine.clearDirectives();

            expect(engine._selfModel.behaviorDirectives).toEqual([]);
            expect(fsWriteSpy).toHaveBeenCalled();
        });
    });
});
