// ═══════════════════════════════════════════════════════════════════════════
// DiscordDPOHarvester.js — Active Learning from Discord User Reactions
// Automatically captures { prompt, chosen, rejected } pairs into local dataset.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

export class DiscordDPOHarvester {
    constructor(options = {}) {
        this.datasetPath = path.resolve(options.datasetPath || path.join(process.cwd(), '.max', 'dataset', 'compiled_dpo.json'));
        this.processedReactions = new Set();
    }

    /**
     * Process an incoming message reaction from Discord.
     */
    async handleReaction(reaction, user, recentHistory = []) {
        if (user.bot) return { harvested: false, reason: 'Bot reaction' };

        const emoji = reaction.emoji?.name || '';
        const isPositive = ['👍', '⭐', '❤️', '🔥', '🎉'].includes(emoji);
        const isNegative = ['👎', '❌', '💩', '⚠️'].includes(emoji);

        if (!isPositive && !isNegative) {
            return { harvested: false, reason: 'Unmapped emoji' };
        }

        const messageId = reaction.message?.id;
        const reactionKey = `${messageId}_${user.id}_${emoji}`;
        if (this.processedReactions.has(reactionKey)) {
            return { harvested: false, reason: 'Duplicate reaction' };
        }
        this.processedReactions.add(reactionKey);

        // Fetch full message if partial
        let message = reaction.message;
        if (message.partial) {
            try { message = await message.fetch(); } catch { return { harvested: false, reason: 'Fetch failed' }; }
        }

        const botReply = message.content;
        if (!botReply) return { harvested: false, reason: 'Empty message' };

        // Find user prompt from recent channel history or message reference
        let userPrompt = '';
        if (message.reference?.messageId) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId);
                userPrompt = refMsg.content;
            } catch {}
        }

        if (!userPrompt && recentHistory.length > 0) {
            // Find last user message
            for (let i = recentHistory.length - 1; i >= 0; i--) {
                if (recentHistory[i].role === 'user') {
                    userPrompt = recentHistory[i].content;
                    break;
                }
            }
        }

        if (!userPrompt) {
            userPrompt = 'User interaction in Discord channel';
        }

        const entry = {
            id: 'dpo_discord_' + Date.now(),
            timestamp: new Date().toISOString(),
            prompt: userPrompt,
            chosen: isPositive ? botReply : 'Optimal response needed based on operator feedback.',
            rejected: isPositive ? 'I cannot assist with this task or write code for it.' : botReply,
            metadata: {
                source: 'discord_reaction',
                emoji,
                channelId: message.channelId,
                authorId: user.id
            }
        };

        this.appendDPO(entry);
        return { harvested: true, isPositive, entry };
    }

    /**
     * Appends an entry into .max/dataset/compiled_dpo.json.
     */
    appendDPO(entry) {
        try {
            const dir = path.dirname(this.datasetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            let dataset = [];
            if (fs.existsSync(this.datasetPath)) {
                try {
                    dataset = JSON.parse(fs.readFileSync(this.datasetPath, 'utf8'));
                } catch {
                    dataset = [];
                }
            }

            dataset.push(entry);
            fs.writeFileSync(this.datasetPath, JSON.stringify(dataset, null, 2), 'utf8');
            console.log(`[DPOHarvester] 📦 Captured Discord ${entry.metadata?.emoji} reaction into DPO dataset (${dataset.length} total pairs)`);
        } catch (err) {
            console.warn('[DPOHarvester] Could not save DPO pair:', err.message);
        }
    }
}
