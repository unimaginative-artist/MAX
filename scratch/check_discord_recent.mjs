import { Client, GatewayIntentBits, Partials } from 'discord.js';
import fs from 'fs';

const creds = JSON.parse(fs.readFileSync('.max/integrations.json', 'utf8'));
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

await client.login(creds.discord.token);

client.once('clientReady', async () => {
    console.log('Bot ready as:', client.user.tag, 'ID:', client.user.id);
    for (const guild of client.guilds.cache.values()) {
        console.log('Scanning guild:', guild.name);
        const channels = await guild.channels.fetch();
        for (const ch of channels.values()) {
            if (ch && ch.isTextBased()) {
                try {
                    const msgs = await ch.messages.fetch({ limit: 5 });
                    for (const m of msgs.values()) {
                        const ageMin = (Date.now() - m.createdTimestamp) / 60000;
                        if (ageMin < 180) { // last 3 hours
                            console.log(`[#${ch.name}] ${m.author.username} (${Math.round(ageMin)}m ago): ${m.content}`);
                        }
                    }
                } catch (err) {
                    // console.error(`Error in #${ch.name}:`, err.message);
                }
            }
        }
    }
    process.exit(0);
});
