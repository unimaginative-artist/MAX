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

const CREDS_FILE = path.join(process.cwd(), '.max', 'integrations.json');

function loadCreds() {
    try {
        return fs.existsSync(CREDS_FILE)
            ? JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
            : {};
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

// Channels where MAX auto-reads and replies { channelId -> { guildName, channelName } }
const _monitored = new Map();

async function connectClient(token) {
    if (_connected && _client) return _client;

    _client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [Partials.Channel, Partials.Message]
    });

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Discord login timed out after 15s')), 15_000);

        _client.once('ready', () => {
            clearTimeout(timeout);
            _connected = true;
            console.log(`[Discord] ✅ Connected as ${_client.user.tag}`);

            _client.on('messageCreate', async (msg) => {
                if (msg.author.bot) return;

                const payload = {
                    author:    msg.author.username,
                    channel:   msg.channel?.name || 'DM',
                    channelId: msg.channelId,
                    content:   msg.content,
                    messageId: msg.id,
                    guildId:   msg.guildId,
                    ts:        msg.createdTimestamp
                };

                // Always surface to terminal via onMessage
                DiscordTool.onMessage?.(payload);

                // Auto-respond if this channel is monitored
                if (_monitored.has(msg.channelId) && DiscordTool.onRespond) {
                    try {
                        const reply = await DiscordTool.onRespond(payload);
                        if (reply) {
                            await msg.reply(reply); // threaded reply to the exact message
                        }
                    } catch (err) {
                        console.warn('[Discord] Auto-respond failed:', err.message);
                    }
                }
            });

            resolve(_client);
        });

        _client.once('error', (err) => {
            clearTimeout(timeout);
            _connected = false;
            reject(err);
        });

        _client.login(token).catch(reject);
    });
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
  react        → add emoji reaction: TOOL:discord:react:{"messageId":"123","channelId":"456","emoji":"👍"}
  listChannels → list all text channels: TOOL:discord:listChannels:{}
  status       → connection status: TOOL:discord:status:{}`,

    // Set by MAX.js — routes incoming Discord messages to the heartbeat for awareness
    onMessage: null,

    // Set by MAX.js — called when a monitored channel gets a message, returns reply string
    onRespond: null,

    actions: {
        // ── Main setup: token → connect → save → say hello ────────────────
        async setup({ token, channelId = null }) {
            if (!token) return { success: false, error: 'Bot token required' };

            const cleanToken = token.trim().replace(/^Bot\s+/i, '');

            try {
                const client = await connectClient(cleanToken);
                saveCreds({ discord: { token: cleanToken, channelId } });

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
            return {
                success:   true,
                connected: _connected,
                bot:       _client?.user?.tag || null,
                guilds:    _client?.guilds?.cache?.size || 0,
                monitored: [..._monitored.entries()].map(([id, info]) => ({ id, ...info }))
            };
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
export async function autoConnectDiscord() {
    const creds = loadCreds();
    if (!creds.discord?.token) return false;
    try {
        await connectClient(creds.discord.token);
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
        console.warn('[Discord] Auto-connect failed:', err.message);
        return false;
    }
}
