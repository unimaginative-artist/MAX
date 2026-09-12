import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDiscordReply } from '../core/DiscordReplySanitizer.js';
import { isAuthorizedDiscordOperator, canProcessDiscordMessage } from '../tools/DiscordTool.js';

test('Discord Response & Activity Intent Suite', async (t) => {
    await t.test('1. Activity Check Intent Detection', () => {
        const checkRegex = /\b(what(?:'s| are you) (?:up to|doing|working on|happening)|what do you have going on|you working on anything|what'?s (?:the )?latest|just checking|check in|checking in|how r u|how are you|how are things)\b/i;

        assert.strictEqual(checkRegex.test('What do you have going on today!?'), true);
        assert.strictEqual(checkRegex.test('Nice you working on anything in the background!?'), true);
        assert.strictEqual(checkRegex.test('Nothing really was just interested in what you have happening! I am at work atm so I was really just checking'), true);
        assert.strictEqual(checkRegex.test('what are you up to'), true);
        assert.strictEqual(checkRegex.test('how r u'), true);
    });

    await t.test('2. isAuthorizedDiscordOperator defaults to true when no whitelist set and always authorizes owner', () => {
        const auth = isAuthorizedDiscordOperator('123456789012345678', { discord: { allowedDmUserIds: [] } });
        assert.strictEqual(auth, true);
        const ownerAuth = isAuthorizedDiscordOperator('274247282096865282');
        assert.strictEqual(ownerAuth, true);
    });

    await t.test('3. Sanitize Discord Reply strips leaked prompt headers and echoes', () => {
        const userPrompt = "Nothing really was just interested in what you have happening! I am at work atm so I was really just checking";
        const rawModelOutput = "[Discord message from undeca_ in #DM] Nothing really was just interested in what you have happening! I am at work atm so I was really just checking";

        const sanitized = sanitizeDiscordReply(rawModelOutput, userPrompt);
        assert.ok(!sanitized.includes('[Discord message from'), 'Must not contain leaked header');
        assert.strictEqual(sanitized, "I heard you loud and clear. All systems and background loops are active. What's the directive?");
    });

    await t.test('4. Corporate Assistant Fluff is stripped', () => {
        const fluff = "Hey undeca_, what are you up to today? I'm here and ready to help! I am monitoring the SOMA Queen.";
        const sanitized = sanitizeDiscordReply(fluff);
        assert.ok(!sanitized.includes("what are you up to today"), 'Must strip fluff opening');
        assert.ok(!sanitized.includes("ready to help"), 'Must strip customer service phrase');
        assert.ok(sanitized.includes("I am monitoring the SOMA Queen"), 'Must preserve actual content');
    });

    await t.test('5. Base model refusal disclaimer is intercepted', () => {
        const disclaimer = "Sorry, as an AI language model, I don't have access to real system tools.";
        const intercepted = sanitizeDiscordReply(disclaimer);
        assert.ok(intercepted.includes("I'm wired directly into your local machine"), 'Must intercept refusal');
    });

    await t.test('6. Casual Greeting Intent matches slang greetings like Sup big dawg', () => {
        const greetingRegex = /^(test|hello|hi|hey|yo|ping|pong|awake|u awake|are you awake|sup|what'?s up|wassup|howdy|good morning|morning|evening)\b/i;
        assert.strictEqual(greetingRegex.test('Sup big dawg'), true);
        assert.strictEqual(greetingRegex.test('yo max'), true);
        assert.strictEqual(greetingRegex.test('wassup'), true);
        assert.strictEqual(greetingRegex.test("what's up"), true);
        assert.strictEqual(greetingRegex.test('ping'), true);
        assert.strictEqual(greetingRegex.test('howdy'), true);
    });

    await t.test('7. canProcessDiscordMessage always authorizes Barry (owner) in DM and guild', () => {
        const barryId = '274247282096865282';
        const dmAuth = canProcessDiscordMessage({ authorId: barryId, guildId: null, channelId: 'dm-123' });
        assert.strictEqual(dmAuth, true, 'Barry DM must be authorized');

        const guildAuth = canProcessDiscordMessage({ authorId: barryId, guildId: 'guild-123', channelId: 'chan-random' });
        assert.strictEqual(guildAuth, true, 'Barry in guild must be authorized');
    });
});
