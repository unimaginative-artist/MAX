// ═══════════════════════════════════════════════════════════════════════════
// DiscordFinanceRadar.js — SOMA Finance & Crypto Alert Dispatcher
// Formats and routes market opportunities from SOMA into Discord channels.
// ═══════════════════════════════════════════════════════════════════════════

import { DiscordUIFactory } from './DiscordUIFactory.js';

export class DiscordFinanceRadar {
    constructor(max = null) {
        this.max = max;
        this.signalsHistory = [];
    }

    /**
     * Dispatch a market opportunity into a designated Discord channel.
     */
    async dispatchSignal(signal, discordClient = null) {
        const client = discordClient || this.max?.tools?.get('discord')?.getClient?.();
        const embed = DiscordUIFactory.createFinanceSignalEmbed(signal);

        this.signalsHistory.push({
            id: 'sig_' + Date.now(),
            timestamp: new Date().toISOString(),
            ...signal
        });
        if (this.signalsHistory.length > 50) this.signalsHistory.shift();

        if (client) {
            try {
                // Look for #market-signals or #finance or default channel
                const channel = client.channels.cache.find(c => /finance|market|signals|trading/i.test(c.name))
                    || client.channels.cache.first();
                if (channel && typeof channel.send === 'function') {
                    await channel.send({ embeds: [embed] });
                    console.log(`[FinanceRadar] 📈 Dispatched ${signal.symbol} signal to #${channel.name}`);
                    return { dispatched: true, channel: channel.name };
                }
            } catch (err) {
                console.warn('[FinanceRadar] Could not send signal to Discord:', err.message);
            }
        }

        return { dispatched: false, embed };
    }
}
