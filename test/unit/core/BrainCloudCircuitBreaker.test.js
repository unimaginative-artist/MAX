import { jest } from '@jest/globals';
import { Brain } from '../../../core/Brain.js';

describe('Brain cloud account circuit breaker', () => {
    test('a DeepSeek 402 switches later smart calls directly to local Ollama', async () => {
        const brain = new Brain({}, { deepseekKey: 'valid-test-key-12345', ollamaModelFast: 'local-test' });
        brain._smart.ready = true;
        brain._smart.backend = 'deepseek';
        brain._fast.ready = true;
        brain._fast.backend = 'ollama';
        brain._deepseek = jest.fn(async () => { throw new Error('DeepSeek 402: Insufficient Balance'); });
        brain._ollama = jest.fn(async () => ({ text: 'local answer', metadata: { backend: 'ollama' } }));

        const first = await brain._runSmart('one', 'system', 0.2, 100);
        const second = await brain._runSmart('two', 'system', 0.2, 100);

        expect(first.text).toBe('local answer');
        expect(second.text).toBe('local answer');
        expect(brain._deepseek).toHaveBeenCalledTimes(1);
        expect(brain._ollama).toHaveBeenCalledTimes(2);
        expect(brain.getStatus().smart.backend).toBe('ollama');
    });
});
