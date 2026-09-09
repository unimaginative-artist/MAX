// ═══════════════════════════════════════════════════════════════════════════
// DiscordTool.js — MAX's Discord integration
//
// Setup flow: user tells MAX their bot token in chat → MAX calls discord.setup
// → saves credentials → connects → sends hello in Discord automatically.
//
// Auto-respond: discord.monitor enables a channel → incoming messages trigger
// MAX's brain → reply sent back to Discord automatically.
// ═══════════════════════════════════════════════════════════════════════════

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import fs   from 'fs';
import path from 'path';
import { DiscordUIFactory }        from '../core/DiscordUIFactory.js';
import { DiscordCodeEvaluator }    from '../core/DiscordCodeEvaluator.js';
import { DiscordDPOHarvester }     from '../core/DiscordDPOHarvester.js';
import { DiscordStandupScheduler } from '../core/DiscordStandupScheduler.js';

const _dpoHarvester = new DiscordDPOHarvester();
const CREDS_FILE = path.join(process.cwd(), '.max', 'integrations.json');

function loadCreds() {
    try {
        const creds = fs.existsSync(CREDS_FILE)
            ? JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
            : {};
        const envToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
        if (envToken && !creds.discord?.token) {
            creds.discord = { ...(creds.discord || {}), token: envToken.trim().replace(/^Bot\s+/i, '') };
        }
        return creds;
    } catch { return {}; }
}

function saveCreds(update) {
    const dir = path.dirname(CREDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = loadCreds();
    fs.writeFileSync(CREDS_FILE, JSON.stringify({ ...existing, ...update }, null, 2));
}

// ── Singleton client ──────────────────────────────────────────────────────
let _client    = null;
let _connected = false;
let _connecting = null;
let _reconnectTimer = null;
let _lastError = null;
let _lastConnectedAt = null;
let _reconnectAttempts = 0;

// Channels where MAX auto-reads and replies { channelId -> { guildName, channelName } }
const _monitored = new Map();

function allowedDmUserIds() {
    return new Set(
        (loadCreds().discord?.allowedDmUserIds || [])
            .map(id => String(id).trim())
            .filter(id => /^\d{17,20}$/.test(id))
    );
}

export function isAuthorizedDiscordOperator(userId) {
    const allowed = allowedDmUserIds();
    if (allowed.size === 0) return true;
    return allowed.has(String(userId || ''));
}

export function shouldIgnoreForeignMention({ guildId, mentionedUserIds = [], selfId }) {
    if (!guildId || !mentionedUserIds.length || !selfId) return false;
    return !mentionedUserIds.map(String).includes(String(selfId));
}

export function canProcessDiscordMessage({ authorId, guildId, channelId, mentioned = false }, creds = loadCreds()) {
    if (mentioned) return true;
    if (guildId) return _monitored.has(channelId);
    const allowed = new Set(
        (creds.discord?.allowedDmUserIds || [])
            .map(id => String(id).trim())
            .filter(id => /^\d{17,20}$/.test(id))
    );
    return allowed.size === 0 || allowed.has(String(authorId || ''));
}

// Discord's MessageContent is a PRIVILEGED intent — it must be toggled ON per-bot
// in the Developer Portal. MAX#4417 is a different bot from SOMA, so it may not be
// enabled; when it isn't, Discord rejects the gateway identify (close code 4014).
// We self-heal: drop to non-privileged intents and reconnect so MAX still comes
// online (DMs + @mentions carry content without the privileged intent).
const _FULL_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
];
const _BASIC_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages
];
let _intentSet = _FULL_INTENTS;
function _isDisallowedIntents(err) {
    const m = (err?.message || String(err || '')).toLowerCase();
    return m.includes('disallowed intent') || m.includes('privileged') || err?.code === 4014;
}

async function connectClient(token) {
    if (_connected && _client) return _client;
    if (_connecting) return _connecting;

    _connecting = new Promise((resolve, reject) => {
        try { _client?.destroy(); } catch {}
        _client = new Client({
            intents: _intentSet,
            partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
        });

        let settled = false;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            _connected = false;
            _lastError = error?.message || String(error);
            try { _client?.destroy(); } catch {}
            if (_isDisallowedIntents(error) && _intentSet === _FULL_INTENTS) {
                console.warn('[Discord] MessageContent intent not enabled for MAX#4417 — reconnecting without it (DMs + @mentions still work). Enable "Message Content Intent" in the Developer Portal for full channel reading.');
                _intentSet = _BASIC_INTENTS;
                scheduleReconnect(1000);
            }
            reject(error);
        };
        const timeout = setTimeout(() => fail(new Error('Discord login timed out after 15s')), 15_000);

        _client.once('ready', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            _connected = true;
            _lastError = null;
            _lastConnectedAt = Date.now();
            _reconnectAttempts = 0;
            console.log(`[Discord] ✅ Connected as ${_client.user.tag}`);

            // ── Button Interactions Router ──────────────────────────────
            _client.on('interactionCreate', async (interaction) => {
                if (!interaction.isButton()) return;
                const [action, targetId] = interaction.customId.split(':');
                try {
                    if (action === 'btn_refresh_status') {
                        const embed = DiscordUIFactory.createStatusEmbed(null);
                        const row = DiscordUIFactory.createProposalActionRow(targetId);
                        await interaction.update({ embeds: [embed], components: [row] });
                    } else if (action === 'btn_deploy_soma') {
                        await interaction.reply({ content: '🚀 SOMA deployment signal emitted over LAN bridge!', ephemeral: true });
                    } else if (action === 'btn_run_tests') {
                        await interaction.reply({ content: '🧪 Executing local regression test suite...', ephemeral: true });
                    }
                } catch (err) {
                    console.warn('[Discord] Button interaction error:', err.message);
                }
            });

            // ── Active DPO Reaction Harvester ───────────────────────────
            _client.on('messageReactionAdd', async (reaction, user) => {
                try {
                    await _dpoHarvester.handleReaction(reaction, user);
                } catch (err) {
                    console.warn('[Discord] DPO harvest error:', err.message);
                }
            });

            // ── Message Create Handler ──────────────────────────────────
            _client.on('messageCreate', async (msg) => {
                if (msg.author.bot && !msg.mentions.has(_client.user.id)) return;
                if (msg.author.id === _client.user.id) return;
                if (shouldIgnoreForeignMention({
                    guildId: msg.guildId,
                    mentionedUserIds: [...(msg.mentions?.users?.keys?.() || [])],
                    selfId: _client.user.id
                })) return;

                const isDirectMessage = !msg.guildId;
                const isMentioned = _client?.user?.id ? msg.mentions?.users?.has?.(_client.user.id) : false;
                const authorized = canProcessDiscordMessage({
                    authorId: msg.author.id,
                    guildId: msg.guildId,
                    channelId: msg.channelId,
                    mentioned: isMentioned
                });
                if (isDirectMessage && !authorized) return;

                // 1. Status Command Handler (/status or @Max status)
                if (/\b(\/status|status|cluster status)\b/i.test(msg.content.trim())) {
                    try {
                        const embed = DiscordUIFactory.createStatusEmbed(null);
                        const row = DiscordUIFactory.createProposalActionRow('live');
                        await msg.reply({ embeds: [embed], components: [row] });
                        return;
                    } catch (err) {
                        console.warn('[Discord] Status embed error:', err.message);
                    }
                }

                // 2. Standup Command Handler (/standup or @Max standup)
                if (/\b(\/standup|standup|morning standup)\b/i.test(msg.content.trim())) {
                    try {
                        const standupScheduler = new DiscordStandupScheduler(null);
                        const embed = standupScheduler.buildStandupEmbed();
                        await msg.reply({ embeds: [embed] });
                        return;
                    } catch (err) {
                        console.warn('[Discord] Standup embed error:', err.message);
                    }
                }

                // 2. Sandboxed Code Evaluation Handler (@Max run <code> or @Max eval <code>)
                if (/\b(run|eval|execute)\b/i.test(msg.content) && /```/i.test(msg.content)) {
                    const code = DiscordCodeEvaluator.extractCode(msg.content);
                    if (code) {
                        msg.channel?.sendTyping?.().catch(() => {});
                        const evalRes = await DiscordCodeEvaluator.evaluate(code);
                        const statusEmoji = evalRes.success ? '✅' : '❌';
                        const reply = [
                            `${statusEmoji} **Sandboxed Code Execution (${evalRes.executionTimeMs}ms)**`,
                            evalRes.stdout ? `\n**Console Output:**\n\`\`\`\n${evalRes.stdout}\n\`\`\`` : '',
                            evalRes.success ? `**Result:** \`${evalRes.result}\`` : `**Error:** \`${evalRes.error}\``
                        ].filter(Boolean).join('\n');
                        await msg.reply(reply);
                        return;
                    }
                }

                const payload = {
                    author:    msg.author.username,
                    authorId:  msg.author.id,
                    channel:   msg.channel?.name || 'DM',
                    channelId: msg.channelId,
                    content:   msg.content,
                    messageId: msg.id,
                    guildId:   msg.guildId,
                    isDirectMessage,
                    ts:        msg.createdTimestamp
                };

                try {
                    DiscordTool.onMessage?.(payload);
                } catch (err) {
                    console.warn('[Discord] Message observer failed:', err.message);
                }

                // Auto-respond if authorized
                if (authorized && DiscordTool.onRespond) {
                    try {
                        msg.channel?.sendTyping?.().catch(() => {});
                        const reply = await DiscordTool.onRespond(payload);
                        if (reply) {
                            await msg.reply(reply);
                        }
                    } catch (err) {
                        console.warn('[Discord] Auto-respond failed:', err.message);
                    }
                }
            });

            resolve(_client);
        });

        _client.on('shardReady', () => {
            _connected = true;
            _lastError = null;
            _lastConnectedAt = Date.now();
        });

        _client.on('shardDisconnect', (_event, shardId) => {
            _connected = false;
            _lastError = `Discord shard ${shardId} disconnected`;
            scheduleReconnect();
        });

        _client.on('invalidated', () => {
            _connected = false;
            _lastError = 'Discord session invalidated';
            scheduleReconnect(5_000);
        });

        _client.once('error', (err) => {
            _connected = false;
            _lastError = err.message;
            if (!settled) fail(err);
        });

        _client.login(token).catch(fail);
    }).finally(() => {
        _connecting = null;
    });
    return _connecting;
}

function scheduleReconnect(delayMs = 30_000) {
    if (_reconnectTimer || _connected || !loadCreds().discord?.token) return;
    _reconnectTimer = setTimeout(async () => {
        _reconnectTimer = null;
        _reconnectAttempts += 1;
        await autoConnectDiscord();
    }, delayMs);
    _reconnectTimer.unref?.();
}

// ── Tool definition ───────────────────────────────────────────────────────
export const DiscordTool = {
    name: 'discord',
    description: `Connect to Discord, send/read messages, and autonomously respond in monitored channels.

Actions:
  setup        → connect bot: TOOL:discord:setup:{"token":"BOT_TOKEN","channelId":"optional-default-channel"}
  send         → send a message: TOOL:discord:send:{"channelName":"general","message":"Hello!"}
                 or by ID:       TOOL:discord:send:{"channelId":"123456789","message":"Hello!"}
  reply        → reply to a specific message (threaded): TOOL:discord:reply:{"messageId":"123","channelId":"456","message":"Got it!"}
  read         → read recent messages: TOOL:discord:read:{"channelName":"general","limit":10}
  monitor      → enable auto-respond in a channel (MAX will read and reply autonomously):
                 TOOL:discord:monitor:{"channelName":"general","enable":true}
                 TOOL:discord:monitor:{"channelName":"general","enable":false}
  configureDm  → allow or revoke private replies for one Discord user ID:
                 TOOL:discord:configureDm:{"userId":"123456789012345678","enable":true}
  react        → add emoji reaction: TOOL:discord:react:{"messageId":"123","channelId":"456","emoji":"👍"}
  reconnect    → reconnect using saved credentials: TOOL:discord:reconnect:{}
  askApproval  → POST an interactive PR embed and wait for user ✅/❌: TOOL:discord:askApproval:{"channelName":"general","title":"My Patch","description":"Here is the fix","diff":"-old\n+new"}
  status       → connection status: TOOL:discord:status:{}`,

    get connected() {
        return _connected && !!_client;
    },

    onMessage: null,
    onRespond: null,

    actions: {
        async setup({ token, channelId = null }) {

            const cleanToken = token.trim().replace(/^Bot\s+/i, '');

            try {
                const client = await connectClient(cleanToken);
                const existing = loadCreds().discord || {};
                saveCreds({ discord: { ...existing, token: cleanToken, channelId } });

                let helloSent = false;
                if (channelId) {
                    try {
                        const ch = await client.channels.fetch(channelId);
                        await ch.send("Hey — MAX is online. Connected and ready. 👾");
                        helloSent = true;
                    } catch { /* non-fatal */ }
                }

                const channels = [];
                for (const guild of client.guilds.cache.values()) {
                    for (const ch of guild.channels.cache.values()) {
                        if (ch.isTextBased()) channels.push({ id: ch.id, name: ch.name, guild: guild.name });
                    }
                }

                return {
                    success:  true,
                    bot:      client.user.tag,
                    guilds:   client.guilds.cache.size,
                    channels: channels.slice(0, 20),
                    helloSent,
                    message: `Connected as ${client.user.tag}. Use discord:monitor to enable auto-respond in a channel.`
                };
            } catch (err) {
                return { success: false, error: `Failed to connect: ${err.message}` };
            }
        },

        // ── Send a message ────────────────────────────────────────────────
        async send({ channelId, channelName, message }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected — run setup first' };
            if (!message) return { success: false, error: 'message required' };
            try {
                const ch = await resolveChannel(channelId, channelName);
                const sent = await ch.send(message);
                return { success: true, messageId: sent.id, channel: ch.name };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Reply to a specific message (threaded) ────────────────────────
        async reply({ messageId, channelId, channelName, message }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            if (!message) return { success: false, error: 'message required' };
            try {
                const ch  = await resolveChannel(channelId, channelName);
                const msg = await ch.messages.fetch(messageId);
                const sent = await msg.reply(message);
                return { success: true, messageId: sent.id, channel: ch.name };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Read recent messages ──────────────────────────────────────────
        async read({ channelId, channelName, limit = 10 }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            try {
                const ch = await resolveChannel(channelId, channelName);
                const fetched = await ch.messages.fetch({ limit: Math.min(limit, 50) });
                return {
                    success: true,
                    messages: [...fetched.values()].map(m => ({
                        id:      m.id,
                        author:  m.author.username,
                        content: m.content,
                        ts:      new Date(m.createdTimestamp).toISOString()
                    }))
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Enable/disable auto-respond for a channel ─────────────────────
        async monitor({ channelId, channelName, enable = true }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            try {
                const ch = await resolveChannel(channelId, channelName);
                if (enable) {
                    _monitored.set(ch.id, { channelName: ch.name, guildName: ch.guild?.name || 'DM' });
                    // Persist monitored channels
                    const creds = loadCreds();
                    const monitored = creds.discord?.monitored || [];
                    if (!monitored.includes(ch.id)) monitored.push(ch.id);
                    saveCreds({ discord: { ...creds.discord, monitored } });
                    return { success: true, message: `Now auto-responding in #${ch.name}. MAX will read and reply to every message.` };
                } else {
                    _monitored.delete(ch.id);
                    const creds = loadCreds();
                    const monitored = (creds.discord?.monitored || []).filter(id => id !== ch.id);
                    saveCreds({ discord: { ...creds.discord, monitored } });
                    return { success: true, message: `Stopped auto-responding in #${ch.name}.` };
                }
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Interactive Approval PR ───────────────────────────────────────
        async askApproval({ channelId, channelName, title, description, diff }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            try {
                const ch = await resolveChannel(channelId, channelName);

                const { EmbedBuilder } = await import('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle(title || 'Code Change Approval Request')
                    .setDescription(description || 'Please review the following changes.')
                    .setColor(0x00FF00);

                if (diff) {
                    const safeDiff = diff.length > 3900 ? diff.slice(0, 3900) + '\n... (truncated)' : diff;
                    embed.addFields({ name: 'Changes', value: '```diff\n' + safeDiff + '\n```' });
                }

                const msg = await ch.send({ embeds: [embed] });
                await msg.react('✅');
                await msg.react('❌');

                // Wait for reaction for up to 15 minutes
                const filter = (reaction, user) => {
                    return ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
                };

                const collected = await msg.awaitReactions({ filter, max: 1, time: 15 * 60 * 1000, errors: ['time'] })
                    .catch(() => null); // If time expires, returns null

                if (!collected || collected.size === 0) {
                    await msg.reply('Approval request timed out after 15 minutes. Aborting.');
                    return { success: true, approved: false, reason: 'timeout' };
                }

                const reaction = collected.first();
                const approved = reaction.emoji.name === '✅';

                await msg.reply(approved ? '✅ Approved! Applying changes...' : '❌ Rejected! Aborting changes.');

                return { success: true, approved };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Add emoji reaction ────────────────────────────────────────────
        async react({ messageId, channelId, channelName, emoji }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            if (!emoji) return { success: false, error: 'emoji required' };
            try {
                const ch  = await resolveChannel(channelId, channelName);
                const msg = await ch.messages.fetch(messageId);
                await msg.react(emoji);
                return { success: true, emoji, messageId };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── List all text channels ────────────────────────────────────────
        async listChannels() {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            const channels = [];
            for (const guild of _client.guilds.cache.values()) {
                for (const ch of guild.channels.cache.values()) {
                    if (ch.isTextBased()) {
                        channels.push({
                            id:        ch.id,
                            name:      ch.name,
                            guild:     guild.name,
                            monitored: _monitored.has(ch.id)
                        });
                    }
                }
            }
            return { success: true, channels };
        },

        // ── Status ────────────────────────────────────────────────────────
        async status() {
            const allowedDmUsers = allowedDmUserIds().size;
            return {
                success:   true,
                connected: _connected,
                bot:       _client?.user?.tag || null,
                guilds:    _client?.guilds?.cache?.size || 0,
                monitored: [..._monitored.entries()].map(([id, info]) => ({ id, ...info })),
                connecting: Boolean(_connecting),
                reconnectScheduled: Boolean(_reconnectTimer),
                reconnectAttempts: _reconnectAttempts,
                lastConnectedAt: _lastConnectedAt,
                lastError: _lastError,
                responderWired: typeof DiscordTool.onRespond === 'function',
                dmEnabled: allowedDmUsers > 0,
                allowedDmUsers,
            };
        },

        async configureDm({ userId, enable = true }) {
            const normalized = String(userId || '').trim();
            if (!/^\d{17,20}$/.test(normalized)) {
                return { success: false, error: 'A valid Discord user ID is required' };
            }
            const creds = loadCreds();
            const allowed = allowedDmUserIds();
            if (enable) allowed.add(normalized);
            else allowed.delete(normalized);
            saveCreds({
                discord: {
                    ...(creds.discord || {}),
                    allowedDmUserIds: [...allowed]
                }
            });
            return {
                success: true,
                dmEnabled: allowed.size > 0,
                allowedDmUsers: allowed.size,
                message: enable ? 'Private replies enabled for that user.' : 'Private replies revoked for that user.'
            };
        },

        async reconnect() {
            const creds = loadCreds();
            if (!creds.discord?.token) return { success: false, error: 'No saved Discord token' };
            if (_reconnectTimer) {
                clearTimeout(_reconnectTimer);
                _reconnectTimer = null;
            }
            _connected = false;
            try { _client?.destroy(); } catch {}
            _client = null;
            const connected = await autoConnectDiscord();
            return { ...(await this.status()), success: connected };
        }
    }
};

// ── Channel resolver helper ───────────────────────────────────────────────
async function resolveChannel(channelId, channelName) {
    if (channelId) return _client.channels.fetch(channelId);
    if (!channelName) throw new Error('channelId or channelName required');
    const name = channelName.replace(/^#/, '').toLowerCase();
    for (const guild of _client.guilds.cache.values()) {
        const found = guild.channels.cache.find(c => c.isTextBased() && c.name.toLowerCase() === name);
        if (found) return found;
    }
    throw new Error(`Channel #${channelName} not found`);
}

// ── Auto-reconnect on boot if credentials saved ───────────────────────────
export async function autoConnectDiscord(max) {
    const creds = loadCreds();
    if (!creds.discord?.token) return false;
    try {
        await connectClient(creds.discord.token);
        if (max?.notifier) max.notifier.setDiscordTool(DiscordTool);
        // Restore monitored channels
        for (const channelId of (creds.discord.monitored || [])) {
            try {
                const ch = await _client.channels.fetch(channelId);
                if (ch) _monitored.set(channelId, { channelName: ch.name, guildName: ch.guild?.name || 'DM' });
            } catch { /* channel may have been deleted */ }
        }
        console.log(`[Discord] ♻️  Auto-connected as ${_client?.user?.tag} (${_monitored.size} channels monitored)`);
        return true;
    } catch (err) {
        _lastError = err.message;
        console.warn('[Discord] Auto-connect failed:', err.message);
        scheduleReconnect(Math.min(120_000, 15_000 * Math.max(1, _reconnectAttempts + 1)));
        return false;
    }
}
