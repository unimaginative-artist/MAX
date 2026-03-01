// ═══════════════════════════════════════════════════════════════════════════
// DiscordTool.js — MAX's Discord integration
//
// Setup flow: user tells MAX their bot token in chat → MAX calls discord.setup
// → saves credentials → connects → sends hello in Discord automatically.
//
// Incoming messages from monitored channels are routed to MAX's heartbeat
// as insights so MAX can respond autonomously or surface them to the user.
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

            // Route all incoming non-bot messages to MAX's onMessage handler
            _client.on('messageCreate', (msg) => {
                if (msg.author.bot) return;
                DiscordTool.onMessage?.({
                    author:    msg.author.username,
                    channel:   msg.channel?.name || 'DM',
                    channelId: msg.channelId,
                    content:   msg.content,
                    guildId:   msg.guildId,
                    ts:        msg.createdTimestamp
                });
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
    description: 'Connect to Discord, send and read messages, monitor channels',

    // Set by MAX.js — routes incoming Discord messages to the heartbeat
    onMessage: null,

    actions: {
        // ── Main setup: token → connect → save → say hello ────────────────
        async setup({ token, channelId = null }) {
            if (!token) return { success: false, error: 'Bot token required' };

            // Strip "Bot " prefix if user pasted the full header
            const cleanToken = token.trim().replace(/^Bot\s+/i, '');

            try {
                const client = await connectClient(cleanToken);

                // Persist credentials
                saveCreds({ discord: { token: cleanToken, channelId } });

                // Say hello in the specified channel (if given)
                let helloSent = false;
                if (channelId) {
                    try {
                        const ch = await client.channels.fetch(channelId);
                        await ch.send("Hey — MAX is online. Connected and ready. 👾");
                        helloSent = true;
                    } catch { /* channel not found or missing perms — non-fatal */ }
                }

                // List available text channels so user can pick one if needed
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
                    message: `Connected as ${client.user.tag} — ${client.guilds.cache.size} server(s)`
                };
            } catch (err) {
                return { success: false, error: `Failed to connect: ${err.message}` };
            }
        },

        // ── Send a message to a channel ───────────────────────────────────
        async send({ channelId, message }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected — run setup first' };
            try {
                const ch = await _client.channels.fetch(channelId);
                const sent = await ch.send(message);
                return { success: true, messageId: sent.id };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Read recent messages from a channel ───────────────────────────
        async read({ channelId, limit = 10 }) {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            try {
                const ch = await _client.channels.fetch(channelId);
                const fetched = await ch.messages.fetch({ limit: Math.min(limit, 50) });
                return {
                    success: true,
                    messages: [...fetched.values()].map(m => ({
                        author:  m.author.username,
                        content: m.content,
                        ts:      new Date(m.createdTimestamp).toISOString()
                    }))
                };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── List all text channels across all servers ─────────────────────
        async listChannels() {
            if (!_connected || !_client) return { success: false, error: 'Not connected' };
            const channels = [];
            for (const guild of _client.guilds.cache.values()) {
                for (const ch of guild.channels.cache.values()) {
                    if (ch.isTextBased()) {
                        channels.push({ id: ch.id, name: ch.name, guild: guild.name });
                    }
                }
            }
            return { success: true, channels };
        },

        // ── Status check ──────────────────────────────────────────────────
        async status() {
            return {
                success:   true,
                connected: _connected,
                bot:       _client?.user?.tag || null,
                guilds:    _client?.guilds?.cache?.size || 0
            };
        }
    }
};

// ── Auto-reconnect on boot if credentials saved ───────────────────────────
export async function autoConnectDiscord() {
    const creds = loadCreds();
    if (!creds.discord?.token) return false;
    try {
        await connectClient(creds.discord.token);
        console.log(`[Discord] ♻️  Auto-connected as ${_client?.user?.tag}`);
        return true;
    } catch (err) {
        console.warn('[Discord] Auto-connect failed:', err.message);
        return false;
    }
}
