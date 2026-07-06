import { readFile } from 'fs/promises';

describe('MAX event contract', () => {
    test('inherits EventEmitter and initializes its base class', async () => {
        const source = await readFile(new URL('../../../core/MAX.js', import.meta.url), 'utf8');
        expect(source).toMatch(/export class MAX extends EventEmitter/);
        expect(source).toMatch(/constructor\(config = \{\}\) \{\s*super\(\);/);
    });

    test('owner Discord engineering requests are queued as real AgentLoop goals', async () => {
        const source = await readFile(new URL('../../../core/MAX.js', import.meta.url), 'utf8');
        expect(source).toMatch(/const engineeringIntent =/);
        expect(source).toMatch(/this\.goals\.addGoal\(\{/);
        expect(source).toMatch(/source: 'discord_owner'/);
        expect(source).toMatch(/this\.agentLoop\?\.runCycle\?\.\(\)/);
        expect(source).toMatch(/skipInlineTools: true/);
    });
});
