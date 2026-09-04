import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDiscordReply } from '../core/DiscordReplySanitizer.js';
import { isAuthorizedDiscordOperator } from '../tools/DiscordTool.js';

test('Discord Response & Activity Intent Suite', async (t) => {
    await t.test('1. Activity Check Intent Detection', () => {
        const checkRegex = /\b(what(?:'s| are you) (?:up to|doing|working on|happening)|what do you have going on|you working on anything|what'?s (?:the )?latest|just checking|check in|checking in|how r u|how are you|how are things)\b/i;

        assert.strictEqual(checkRegex.test('What do you have going on today!?'), true);
        assert.strictEqual(checkRegex.test('Nice you working on anything in the background!?'), true);
        assert.strictEqual(checkRegex.test('Nothing really was just interested in what you have happening! I am at work atm so I was really just checking'), true);
        assert.strictEqual(checkRegex.test('what are you up to'), true);
        assert.strictEqual(checkRegex.test('how r u'), true);
    });

    await t.test('2. isAuthorizedDiscordOperator defaults to true when no whitelist set', () => {
        const auth = isAuthorizedDiscordOperator('123456789012345678');
        assert.strictEqual(auth, true);
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
});
