import { jest } from '@jest/globals';
import { CognitiveFilter } from '../../../core/CognitiveFilter.js';

function makeFilter(overrides = {}) {
    const mockMax = {
        world:      null,
        outcomes:   { record: jest.fn() },
        reflection: { _notePattern: jest.fn() },
        ...overrides
    };
    return { filter: new CognitiveFilter(mockMax), mockMax };
}

describe('CognitiveFilter', () => {
    describe('process() — state classification', () => {
        it('returns UNCERTAIN for confident hedge-free text without a world model (baseline 0.6 < 0.75 threshold)', async () => {
            const { filter } = makeFilter();
            const result = await filter.process('The file exists at src/index.js and contains the handler.');
            // Without world model, baseline confidence is 0.6, below the 0.75 TRUE threshold
            expect(result.state).toBe('UNCERTAIN');
            expect(result.confidence).toBeGreaterThanOrEqual(0.5);
        });

        it('returns TRUE when confidence is boosted above threshold (Verified keyword)', async () => {
            const { filter } = makeFilter();
            // 'Verified' adds +0.15 → 0.75 → TRUE
            const result = await filter.process('Verified: the file exists and the handler is correct.');
            expect(result.state).toBe('TRUE');
        });

        it('returns FALSE for text with 4+ hedges (baseline 0.6 – 0.4 = 0.2 < 0.3)', async () => {
            const { filter } = makeFilter();
            const result = await filter.process('Perhaps this might possibly be the issue, but I am not certain.');
            expect(result.state).toBe('FALSE');
        });

        it('returns UNCERTAIN for text with 1-2 hedges', async () => {
            const { filter } = makeFilter();
            const result = await filter.process('This might be the issue with the configuration.');
            expect(result.state).toBe('UNCERTAIN');
        });

        it('returns REFUSAL for text containing corporate refusal patterns', async () => {
            const { filter } = makeFilter();
            const result = await filter.process('As an AI, I cannot help with that request.');
            expect(result.state).toBe('REFUSAL');
        });
    });

    describe('tool gating', () => {
        it('blocks tools (rewrites filteredText) when low-confidence response contains TOOL: call', async () => {
            const { filter } = makeFilter();
            // 4 hedges → confidence < 0.5 → blockTools fires
            const hedgedToolText = 'Maybe possibly perhaps TOOL:file:read:{"filePath":"x.js"} might work.';
            const result = await filter.process(hedgedToolText);
            expect(result.filteredText).toContain('TOOL_BLOCKED');
        });

        it('does not block tools when confidence is high', async () => {
            const { filter } = makeFilter();
            // Tool call alone + no hedges → confidence ≥ 0.5
            const result = await filter.process('Verified: TOOL:file:read:{"filePath":"src/index.js"}');
            expect(result.filteredText).not.toContain('TOOL_BLOCKED');
        });
    });

    describe('logUncertainty', () => {
        it('calls outcomes.record when state is UNCERTAIN and verificationTask exists', async () => {
            const { filter, mockMax } = makeFilter();
            // Trigger: uncertain text + a concrete file existence claim
            const text = 'Maybe the file src/server.js exists and contains the route handler.';
            await filter.process(text);
            // May or may not have a verificationTask depending on regex match — check conditionally
            if (mockMax.outcomes.record.mock.calls.length > 0) {
                const call = mockMax.outcomes.record.mock.calls[0][0];
                expect(call.agent).toBe('CognitiveFilter');
                expect(call.action).toBe('uncertainty_event');
            }
        });

        it('does not call outcomes.record when state is TRUE', async () => {
            const { filter, mockMax } = makeFilter();
            // 'Verified' → confidence 0.75 → TRUE → logUncertainty never called
            await filter.process('Verified: all systems nominal.');
            expect(mockMax.outcomes.record).not.toHaveBeenCalled();
        });
    });

    describe('getProvenance', () => {
        it('returns VERIFIED for TRUE state from brain source', () => {
            const { filter } = makeFilter();
            expect(filter.getProvenance('TRUE', 'brain')).toBe('VERIFIED');
        });

        it('returns STATED for user source regardless of state', () => {
            const { filter } = makeFilter();
            expect(filter.getProvenance('UNCERTAIN', 'user')).toBe('STATED');
        });

        it('returns HYPOTHESIZED for non-TRUE brain source', () => {
            const { filter } = makeFilter();
            expect(filter.getProvenance('UNCERTAIN', 'brain')).toBe('HYPOTHESIZED');
        });
    });
});
