// ═══════════════════════════════════════════════════════════════════════════
// Notifier.js — MAX outbound notifications
// Sends to Discord webhook when something important happens.
// Set DISCORD_WEBHOOK_URL in config/api-keys.env to enable.
// ═══════════════════════════════════════════════════════════════════════════

export class Notifier {
    constructor(config = {}) {
        this.webhookUrl   = config.discordWebhook || process.env.DISCORD_WEBHOOK_URL || '';
        this.enabled      = !!this.webhookUrl;
        this.cooldownMs   = config.cooldownMs ?? 90_000;   // 90s between pings (rate limit guard)
        this.minImportance = config.minImportance ?? 0.6;  // 0–1 scale

        this._lastSent    = 0;
        this._queue       = [];                            // pending if rate-limited
        this.stats        = { sent: 0, dropped: 0, errors: 0 };

        if (this.enabled) {
            console.log('[Notifier] ✅ Discord webhook configured');
        } else {
            console.log('[Notifier] ⚠️  No DISCORD_WEBHOOK_URL — notifications disabled');
        }
    }

    // ── Public API ────────────────────────────────────────────────────────

    /** Send a freeform message. options.force bypasses cooldown. */
    async notify(message, options = {}) {
        if (!this.enabled) return false;

        const now = Date.now();
        if (!options.force && now - this._lastSent < this.cooldownMs) {
            this.stats.dropped++;
            return false;
        }
        return this._send({ content: message });
    }

    /**
     * Smart insight filter — only surfaces truly interesting signals.
     * Called from MAX's heartbeat insight handler.
     */
    async onInsight(insight) {
        if (!this.enabled) return;

        const { source, label, result } = insight;

        // Only ping for high-signal events
        const isHighSignal =
            source === 'agent' ||                       // goal completed / diagnosed
            source === 'proactive' ||                   // MAX flagging something
            (source === 'curiosity' && /critical|urgent|fail|error/i.test(label + result)) ||
            (result?.length > 20 && /complet|success|fix|solved|done/i.test(result));

        if (!isHighSignal) return;

        const body = result ? `${label}\n> ${result.slice(0, 400)}` : label;
        await this.notify(`**MAX** — ${body}`);
    }

    /** Morning briefing — call from Scheduler */
    async briefing(max) {
        if (!this.enabled) return;

        const goals    = max.goals?.listActive().slice(0, 8) || [];
        const outcomes = max.outcomes?.getStats?.() || {};
        const rate     = outcomes.total > 0
            ? Math.round(outcomes.success / outcomes.total * 100) + '%'
            : '—';

        const day  = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const lines = [
            `## MAX — Morning Briefing · ${day}`,
            '',
            `**Active Goals (${goals.length})**`,
            ...goals.map(g => `• **${g.title}** \`${g.status}\``),
            goals.length === 0 ? '• *(none)*' : '',
            '',
            `**Performance** — ${outcomes.total || 0} actions · ${rate} success rate`,
        ].filter(l => l !== undefined);

        await this._send({ content: lines.join('\n') }, true);
    }

    getStatus() {
        return { enabled: this.enabled, ...this.stats, cooldownMs: this.cooldownMs };
    }

    // ── Internal ──────────────────────────────────────────────────────────

    async _send(body, force = false) {
        const now = Date.now();
        if (!force && now - this._lastSent < this.cooldownMs) {
            this.stats.dropped++;
            return false;
        }

        try {
            const { default: fetch } = await import('node-fetch');
            const r = await Promise.race([
                fetch(this.webhookUrl, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ ...body, username: 'MAX' })
                }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
            ]);
            if (r.ok) {
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
