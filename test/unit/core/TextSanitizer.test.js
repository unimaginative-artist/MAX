import { stripLeakedPromptContext } from '../../../core/TextSanitizer.js';

describe('stripLeakedPromptContext', () => {
    it('returns input unchanged when no markers present', () => {
        const text = 'Here is my answer about Node.js streams.';
        expect(stripLeakedPromptContext(text)).toBe(text);
    });

    it('strips from \\n## Relevant Memories onward', () => {
        const text = 'Great question.\n## Relevant Memories\nsome memory data';
        expect(stripLeakedPromptContext(text)).toBe('Great question.');
    });

    it('strips from \\n## System State onward', () => {
        const text = 'Here is my analysis.\n## System State\nTension: 40%';
        expect(stripLeakedPromptContext(text)).toBe('Here is my analysis.');
    });

    it('strips [DRIVE: lines', () => {
        const text = 'Sure thing.\n[DRIVE: High tension — be concise]';
        expect(stripLeakedPromptContext(text)).toBe('Sure thing.');
    });

    it('strips [ACTIVE BUFFER] sections', () => {
        const text = 'Working on it.\n[ACTIVE BUFFER] Source: foo.js\ncode here';
        expect(stripLeakedPromptContext(text)).toBe('Working on it.');
    });

    it('strips ## Active Goals section', () => {
        const text = 'Done.\n## Active Goals\n- Fix the bug';
        expect(stripLeakedPromptContext(text)).toBe('Done.');
    });

    it('cuts at the earliest marker when multiple are present', () => {
        const text = 'Reply.\n## Active Goals\ngoal\n## System State\nstate';
        expect(stripLeakedPromptContext(text)).toBe('Reply.');
    });

    it('returns empty string when text starts with a marker', () => {
        expect(stripLeakedPromptContext('## Relevant Memories\ndata')).toBe('');
        expect(stripLeakedPromptContext('[DRIVE: observe]')).toBe('');
    });

    it('handles empty string without throwing', () => {
        expect(stripLeakedPromptContext('')).toBe('');
    });

    it('handles null and non-string inputs without throwing', () => {
        expect(stripLeakedPromptContext(null)).toBe(null);
        expect(stripLeakedPromptContext(undefined)).toBe(''); // default param '' kicks in
        expect(stripLeakedPromptContext(42)).toBe(42);
    });

    it('preserves legitimate content that contains partial marker words', () => {
        const text = 'The system state is healthy. Active goals are being tracked.';
        expect(stripLeakedPromptContext(text)).toBe(text);
    });
});
