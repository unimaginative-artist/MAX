import { readFile } from 'fs/promises';

describe('MAX identity isolation', () => {
    test('smart inference does not delegate conversation to SOMA', async () => {
        const source = await readFile(new URL('../../../core/Brain.js', import.meta.url), 'utf8');
        const smartTier = source.slice(source.indexOf('async _runSmart'), source.indexOf('async _deepseek'));
        expect(smartTier).not.toContain('this.max.soma.think');
        expect(smartTier).toContain('this._deepseek');
    });

    test('base persona explicitly separates MAX from SOMA', async () => {
        const source = await readFile(new URL('../../../personas/PersonaEngine.js', import.meta.url), 'utf8');
        expect(source).toContain('your name is MAX');
        expect(source).toContain('You are not SOMA');
    });
});
