// ═══════════════════════════════════════════════════════════════════════════
// ExecutionReporter.js — Resilient execution reporting & outbox dispatcher
// Enforces "Persist Before Notifying" — notifications never alter task state.
// ═══════════════════════════════════════════════════════════════════════════

export const EXECUTION_EVENTS = new Set([
    'execution_started',
    'execution_progress',
    'execution_complete',
    'execution_failed',
    'execution_blocked',
    'execution_cancelled',
    'execution_incomplete'
]);

export class ExecutionReporter {
    /**
     * @param {Object} max - MAX instance
     * @param {Object} jobStore - ExecutionJobStore instance
     * @param {Function} [broadcast] - WebSocket/SSE broadcast function
     */
    constructor(max, jobStore, broadcast = null) {
        this.max = max;
        this.jobStore = jobStore;
        this.broadcast = broadcast || ((event) => {
            if (this.max?.emitActivity) {
                this.max.emitActivity(event);
            }
        });
        this._outboxTimer = null;
        this._isProcessingOutbox = false;
    }

    setBroadcast(broadcastFn) {
        if (typeof broadcastFn === 'function') {
            this.broadcast = broadcastFn;
        }
    }

    /**
     * Reports an execution event across all channels with strict persistence ordering:
     * 1. Confirms record is in jobStore
     * 2. Broadcasts to WS/SSE
     * 3. Attempts external channels (Discord, Notifier)
     * 4. Enqueues failed deliveries into the durable outbox without failing the task
     * @param {string} jobId
     * @param {string} event
     * @param {Object} [details]
     */
    async reportExecution(jobId, event, details = {}) {
        if (!EXECUTION_EVENTS.has(event)) {
            console.warn(`[ExecutionReporter] Unknown execution event: ${event}`);
            return { success: false, error: `Unknown event: ${event}` };
        }

        const job = this.jobStore.getJob(jobId);
        if (!job) {
            console.warn(`[ExecutionReporter] Cannot report for missing job: ${jobId}`);
            return { success: false, error: `Job not found: ${jobId}` };
        }

        const deliveryResult = {
            jobId,
            event,
            websocket: 'skipped',
            sse: 'skipped',
            notifier: 'skipped',
            discord: 'skipped'
        };

        // ── 1. WS & SSE Broadcast ──────────────────────────────────────────
        try {
            if (typeof this.broadcast === 'function') {
                this.broadcast({
                    type: event,
                    jobId,
                    goalId: job.goalId,
                    status: job.status,
                    task: job.task,
                    summary: job.summary,
                    evidence: job.evidence,
                    toolsUsed: job.toolsUsed,
                    toolResults: job.toolResults,
                    verification: job.verification,
                    error: job.error,
                    nextStep: job.nextStep,
                    ...details,
                    ts: Date.now()
                });
                deliveryResult.websocket = 'sent';
                deliveryResult.sse = 'sent';
            }
        } catch (err) {
            console.error(`[ExecutionReporter] WS/SSE broadcast failed for ${jobId}:`, err.message);
            deliveryResult.websocket = 'failed';
            deliveryResult.sse = 'failed';
        }

        // ── 2. External Channels (Only on terminal events) ──────────────────
        const isTerminal = ['execution_complete', 'execution_failed', 'execution_blocked', 'execution_incomplete', 'execution_cancelled'].includes(event);
        if (!isTerminal) {
            this.jobStore.updateJob(jobId, {
                reporting: {
                    websocket: deliveryResult.websocket,
                    sse: deliveryResult.sse
                }
            });
            return deliveryResult;
        }

        const isSuccess = event === 'execution_complete';
        const summaryText = job.summary || details.summary || (isSuccess ? 'Task completed successfully' : 'Task failed');
        const formattedMessage = this._formatReportMessage(job, isSuccess, summaryText);

        // ── Discord Delivery ──
        const discordTool = this.max?.tools?.get?.('discord');
        const hasDiscord = discordTool && (discordTool.connected || discordTool.client?.isReady?.());

        if (hasDiscord) {
            try {
                await this._dispatchDiscord(job, formattedMessage);
                deliveryResult.discord = 'sent';
            } catch (err) {
                console.warn(`[ExecutionReporter] Discord direct dispatch failed for ${jobId}: ${err.message}. Enqueuing to outbox.`);
                deliveryResult.discord = 'failed';
                this.jobStore.enqueueNotification({
                    jobId,
                    channel: 'discord',
                    event,
                    payload: { message: formattedMessage, goalId: job.goalId }
                });
            }
        } else {
            deliveryResult.discord = 'skipped';
        }

        // ── Notifier Delivery ──
        if (this.max?.notifier?.notify) {
            try {
                await this.max.notifier.notify(formattedMessage, { force: true });
                deliveryResult.notifier = 'sent';
            } catch (err) {
                console.warn(`[ExecutionReporter] Notifier direct dispatch failed for ${jobId}: ${err.message}. Enqueuing to outbox.`);
                deliveryResult.notifier = 'failed';
                this.jobStore.enqueueNotification({
                    jobId,
                    channel: 'notifier',
                    event,
                    payload: { message: formattedMessage }
                });
            }
        } else {
            deliveryResult.notifier = 'skipped';
        }

        // ── 3. Persist Reporting Statuses to Job Record ────────────────────
        this.jobStore.updateJob(jobId, {
            reporting: {
                websocket: deliveryResult.websocket,
                sse: deliveryResult.sse,
                notifier: deliveryResult.notifier,
                discord: deliveryResult.discord
            }
        });

        return deliveryResult;
    }

    _formatReportMessage(job, isSuccess, summaryText) {
        const title = job.task ? (job.task.length > 70 ? job.task.slice(0, 67) + '...' : job.task) : (job.jobId || 'Task');
        const icon = isSuccess ? '✅' : '❌';
        const label = isSuccess ? 'Task Completed' : `Task ${job.status.toUpperCase()}`;
        return `${icon} **[MAX] ${label}**: **${title}**\n> ${summaryText.slice(0, 600)}`;
    }

    async _dispatchDiscord(job, message) {
        if (!this.max?.tools?.execute) {
            throw new Error('Tool execution unavailable for Discord dispatch');
        }

        if (job.goalId && job.goalId.startsWith('discord_') && job.channelId) {
            if (job.messageId) {
                return await this.max.tools.execute('discord', 'reply', {
                    messageId: job.messageId,
                    channelName: job.channelId,
                    message,
                    __approvedExternal: true,
                    __source: 'discord'
                });
            }
            return await this.max.tools.execute('discord', 'send', {
                channelName: job.channelId,
                message,
                __approvedExternal: true,
                __source: 'discord'
            });
        }

        return await this.max.tools.execute('discord', 'send', {
            message,
            __approvedExternal: true,
            __source: 'discord'
        });
    }

    /**
     * Start background worker to drain pending outbox retries.
     */
    startOutboxWorker(intervalMs = 5000) {
        if (this._outboxTimer) return;
        this._outboxTimer = setInterval(() => this.processOutbox().catch(() => {}), intervalMs);
        if (this._outboxTimer.unref) this._outboxTimer.unref();
    }

    stopOutboxWorker() {
        if (this._outboxTimer) {
            clearInterval(this._outboxTimer);
            this._outboxTimer = null;
        }
    }

    /**
     * Drains pending outbox items and attempts bounded backoff retries.
     * Retries ONLY the notification message without re-running any tasks.
     */
    async processOutbox(limit = 10) {
        if (this._isProcessingOutbox) return;
        this._isProcessingOutbox = true;

        try {
            const pending = this.jobStore.getPendingNotifications(limit);
            for (const item of pending) {
                try {
                    if (item.channel === 'discord') {
                        const discordTool = this.max?.tools?.get?.('discord');
                        if (!discordTool || (!discordTool.connected && !discordTool.client?.isReady?.())) {
                            // Defer until Discord comes online
                            this.jobStore.markNotificationFailed(item.id, 'Discord client still offline', 15000);
                            continue;
                        }
                        const job = this.jobStore.getJob(item.jobId);
                        await this._dispatchDiscord(job || {}, item.payload.message);
                        this.jobStore.markNotificationDelivered(item.id);
                    } else if (item.channel === 'notifier') {
                        if (!this.max?.notifier?.notify) {
                            this.jobStore.markNotificationFailed(item.id, 'Notifier unavailable', 15000);
                            continue;
                        }
                        await this.max.notifier.notify(item.payload.message, { force: true });
                        this.jobStore.markNotificationDelivered(item.id);
                    } else {
                        // Unknown channel
                        this.jobStore.markNotificationDelivered(item.id);
                    }
                } catch (err) {
                    const backoffMs = Math.min(60000, 5000 * Math.pow(2, item.attempts));
                    this.jobStore.markNotificationFailed(item.id, err.message, backoffMs);
                }
            }
        } finally {
            this._isProcessingOutbox = false;
        }
    }
}
