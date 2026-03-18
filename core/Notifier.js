// ═══════════════════════════════════════════════════════════════════════════
// Notifier.js — MAX outbound notifications via Discord
// Delegates to DiscordTool (the shared bot connection) — no duplicate client.
// Credentials live in .max/integrations.json (set via: discord.setup in chat).
// Optional override: DISCORD_CHANNEL_ID env var for the notification channel.
// ═══════════════════════════════════════════════════════════════════════════

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

export class Notifier {
    constructor(config = {}) {
        this.cooldownMs    = config.cooldownMs    ?? 90_000;
        this.minImportance = config.minImportance ?? 0.6;
        this._lastSent     = 0;
        this.stats         = { sent: 0, dropped: 0, errors: 0 };

        // DiscordTool is injected after construction (MAX.js wires it post-boot)
        this._discord = null;

        // Resolve channel: env var → integrations.json → null
        this._channelId = process.env.DISCORD_CHANNEL_ID || loadCreds()?.discord?.channelId || null;

        // enabled is determined at send-time (DiscordTool may connect after Notifier is created)
        console.log(this._channelId
            ? `[Notifier] ✅ Discord channel set (${this._channelId}) — waiting for bot connection`
            : '[Notifier] ⚠️  No Discord channel configured — run: discord.setup in chat, or set DISCORD_CHANNEL_ID'
        );
    }

    /** Called by MAX.js after DiscordTool is ready */
    setDiscordTool(discordTool) {
        this._discord = discordTool;
        // Re-check channel from creds in case setup happened after construction
        if (!this._channelId) {
            this._channelId = loadCreds()?.discord?.channelId || null;
        }
        if (this._channelId) {
            console.log('[Notifier] ✅ Discord bot connected — notifications active');
        }
    }

    get enabled() {
        return !!(this._discord && this._channelId);
    }

    // ── Public API ────────────────────────────────────────────────────────

    async notify(message, options = {}) {
        if (!this.enabled) return false;

        const now = Date.now();
        if (!options.force && now - this._lastSent < this.cooldownMs) {
            this.stats.dropped++;
            return false;
        }
        return this._send(message);
    }

    async onInsight(insight) {
        if (!this.enabled) return;

        const { source, label, result } = insight;
        const isHighSignal =
            source === 'agent' ||
            source === 'proactive' ||
            (source === 'curiosity' && /critical|urgent|fail|error/i.test(label + result)) ||
            (result?.length > 20 && /complet|success|fix|solved|done/i.test(result));

        if (!isHighSignal) return;

        const body = result ? `${label}\n> ${result.slice(0, 400)}` : label;
        await this.notify(`**MAX** — ${body}`);
    }

    async briefing(max) {
        if (!this.enabled) return;

        const goals    = max.goals?.listActive().slice(0, 8) || [];
        const outcomes = max.outcomes?.getStats?.() || {};
        const rate     = outcomes.total > 0
            ? Math.round(outcomes.success / outcomes.total * 100) + '%'
            : '—';

        const day   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const lines = [
            `## MAX — Morning Briefing · ${day}`,
            '',
            `**Active Goals (${goals.length})**`,
            ...goals.map(g => `• **${g.title}** \`${g.status}\``),
            goals.length === 0 ? '• *(none)*' : '',
            '',
            `**Performance** — ${outcomes.total || 0} actions · ${rate} success rate`,
        ].filter(l => l !== undefined);

        await this._send(lines.join('\n'), true);
    }

    getStatus() {
        return { enabled: this.enabled, channelId: this._channelId, ...this.stats, cooldownMs: this.cooldownMs };
    }

    // ── Internal ──────────────────────────────────────────────────────────

    async _send(content, force = false) {
        if (!this._discord || !this._channelId) return false;

        const now = Date.now();
        if (!force && now - this._lastSent < this.cooldownMs) {
            this.stats.dropped++;
            return false;
        }

        try {
            const result = await this._discord.actions.send({
                channelId: this._channelId,
                message:   content
            });
            if (result.success) {
                this._lastSent = Date.now();
                this.stats.sent++;
                return true;
            }
            this.stats.errors++;
            return false;
        } catch {
            this.stats.errors++;
            return false;
        }
    }
}
