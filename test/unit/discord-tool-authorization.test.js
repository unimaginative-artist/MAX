import { canProcessDiscordMessage, DiscordTool, isAuthorizedDiscordOperator, shouldIgnoreForeignMention } from '../../tools/DiscordTool.js';

describe('DiscordTool message authorization', () => {
    const ownerId = '274247282096865282';

    test('allows an approved owner DM', () => {
        expect(canProcessDiscordMessage(
            { authorId: ownerId, guildId: null, channelId: 'dm-channel' },
            { discord: { allowedDmUserIds: [ownerId] } }
        )).toBe(true);
    });

    test('rejects an unapproved DM', () => {
        expect(canProcessDiscordMessage(
            { authorId: '999999999999999999', guildId: null, channelId: 'dm-channel' },
            { discord: { allowedDmUserIds: [ownerId] } }
        )).toBe(false);
    });

    test('restricts operational Discord requests to the configured owner', async () => {
        await DiscordTool.actions.configureDm({ userId: ownerId, enable: true });
        expect(isAuthorizedDiscordOperator(ownerId)).toBe(true);
        expect(isAuthorizedDiscordOperator('999999999999999999')).toBe(false);
    });

    test('does not expose allowlisted user IDs in status', async () => {
        const status = await DiscordTool.actions.status();
        expect(status).not.toHaveProperty('allowedDmUserIds');
        expect(status).toHaveProperty('allowedDmUsers');
    });

    test('ignores guild messages that mention another bot but not local MAX', () => {
        expect(shouldIgnoreForeignMention({ guildId: 'guild', mentionedUserIds: ['remote-bot'], selfId: 'local-bot' })).toBe(true);
        expect(shouldIgnoreForeignMention({ guildId: 'guild', mentionedUserIds: ['local-bot'], selfId: 'local-bot' })).toBe(false);
        expect(shouldIgnoreForeignMention({ guildId: null, mentionedUserIds: ['remote-bot'], selfId: 'local-bot' })).toBe(false);
    });
});
