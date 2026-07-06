import { sanitizeDiscordReply } from '../../../core/DiscordReplySanitizer.js';

describe('DiscordReplySanitizer', () => {
    test('drops raw tool-only replies', () => {
        expect(sanitizeDiscordReply('/ TRUE\nTOOL:discord:send:{"message":"hello"}')).toBeNull();
    });

    test('removes internal tool preamble while preserving normal text', () => {
        expect(sanitizeDiscordReply('/ TRUE\nTOOL:discord:send:{"message":"hello"}\nI am MAX.')).toBe('I am MAX.');
    });
});
