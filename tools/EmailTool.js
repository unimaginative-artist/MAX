// ═══════════════════════════════════════════════════════════════════════════
// EmailTool.js — MAX's email integration
//
// IMAP for reading (via imapflow — modern, promise-based).
// SMTP for sending (via nodemailer).
//
// Gmail setup: use an App Password from Google account settings, NOT your
// main password. (Google → Security → 2-Step Verification → App Passwords)
//
// Polls inbox every 60s and routes new emails to MAX's heartbeat as insights.
// ═══════════════════════════════════════════════════════════════════════════

import { ImapFlow }  from 'imapflow';
import nodemailer    from 'nodemailer';
import fs            from 'fs';
import path          from 'path';

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

// ── Singleton state ───────────────────────────────────────────────────────
let _config    = null;
let _pollTimer = null;
let _seenUids  = new Set();

function getConfig() {
    if (_config) return _config;
    const creds = loadCreds();
    _config = creds.email || null;
    return _config;
}

// Auto-detect Gmail IMAP/SMTP hosts
function resolveHosts(email, imapHost, smtpHost) {
    if (!imapHost) {
        if (email.includes('@gmail.com'))    { imapHost = 'imap.gmail.com';     smtpHost = smtpHost || 'smtp.gmail.com'; }
        else if (email.includes('@yahoo'))   { imapHost = 'imap.mail.yahoo.com'; smtpHost = smtpHost || 'smtp.mail.yahoo.com'; }
        else if (email.includes('@outlook') || email.includes('@hotmail')) {
            imapHost = 'outlook.office365.com';
            smtpHost = smtpHost || 'smtp.office365.com';
        }
    }
    return { imapHost, smtpHost: smtpHost || imapHost };
}

// ── Fetch unread emails via IMAP ──────────────────────────────────────────
async function fetchUnread(config, limit = 20) {
    const client = new ImapFlow({
        host:   config.imapHost,
        port:   config.imapPort || 993,
        secure: true,
        auth:   { user: config.email, pass: config.password },
        logger: false
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const emails = [];

    try {
        const uids = await client.search({ unseen: true });
        const toFetch = uids.slice(-limit); // newest N

        if (toFetch.length > 0) {
            for await (const msg of client.fetch(toFetch, { envelope: true, uid: true })) {
                emails.push({
                    uid:     msg.uid,
                    from:    msg.envelope.from?.[0]?.address || 'unknown',
                    subject: msg.envelope.subject || '(no subject)',
                    date:    msg.envelope.date?.toISOString() || new Date().toISOString()
                });
            }
        }
    } finally {
        lock.release();
        await client.logout();
    }

    return emails;
}

// ── Poll inbox and surface new emails ─────────────────────────────────────
function startPolling(intervalMs = 60_000) {
    if (_pollTimer) clearInterval(_pollTimer);

    _pollTimer = setInterval(async () => {
        const config = getConfig();
        if (!config) return;

        try {
            const emails = await fetchUnread(config, 10);
            for (const email of emails) {
                if (!_seenUids.has(email.uid)) {
                    _seenUids.add(email.uid);
                    EmailTool.onMessage?.(email);
                }
            }
        } catch { /* non-fatal — poll again next cycle */ }
    }, intervalMs);

    console.log(`[Email] ⏰ Polling inbox every ${intervalMs / 1000}s`);
}

// ── Tool definition ───────────────────────────────────────────────────────
export const EmailTool = {
    name: 'email',
    description: 'Read and send emails via IMAP/SMTP. Supports Gmail, Yahoo, Outlook.',

    // Set by MAX.js — routes new emails to the heartbeat
    onMessage: null,

    actions: {
        // ── Setup: credentials → test → save → start polling ─────────────
        async setup({ email, password, imapHost = null, smtpHost = null, imapPort = 993, smtpPort = 587 }) {
            if (!email || !password) {
                return { success: false, error: 'email and password required. For Gmail, use an App Password.' };
            }

            const hosts = resolveHosts(email, imapHost, smtpHost);
            if (!hosts.imapHost) {
                return { success: false, error: 'Could not detect IMAP host. Provide imapHost manually.' };
            }

            const config = {
                email,
                password,
                imapHost: hosts.imapHost,
                smtpHost: hosts.smtpHost,
                imapPort,
                smtpPort
            };

            // Test IMAP connection
            try {
                const unread = await fetchUnread(config, 5);
                _config = config;
                saveCreds({ email: config });

                // Seed seen UIDs so we don't re-surface old emails
                for (const e of unread) _seenUids.add(e.uid);

                // Start polling
                startPolling(60_000);

                return {
                    success:     true,
                    account:     email,
                    unreadCount: unread.length,
                    message:     `Connected to ${hosts.imapHost}. ${unread.length} unread email(s).`
                };
            } catch (err) {
                return {
                    success: false,
                    error:   `IMAP connection failed: ${err.message}. For Gmail, ensure IMAP is enabled and use an App Password.`
                };
            }
        },

        // ── Read unread emails ────────────────────────────────────────────
        async read({ limit = 10 }) {
            const config = getConfig();
            if (!config) return { success: false, error: 'Not configured — run setup first' };
            try {
                const emails = await fetchUnread(config, limit);
                return { success: true, emails, total: emails.length };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Send an email ─────────────────────────────────────────────────
        async send({ to, subject, body }) {
            const config = getConfig();
            if (!config) return { success: false, error: 'Not configured' };

            try {
                const transporter = nodemailer.createTransport({
                    host:   config.smtpHost,
                    port:   config.smtpPort,
                    secure: config.smtpPort === 465,
                    auth:   { user: config.email, pass: config.password }
                });

                await transporter.sendMail({
                    from:    config.email,
                    to,
                    subject,
                    text:    body
                });

                return { success: true, to, subject };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // ── Status ────────────────────────────────────────────────────────
        async status() {
            const config = getConfig();
            return {
                success:    true,
                configured: !!config,
                account:    config?.email || null,
                polling:    !!_pollTimer,
                seenEmails: _seenUids.size
            };
        }
    }
};

// ── Auto-reconnect on boot if credentials saved ───────────────────────────
export async function autoConnectEmail() {
    const creds = loadCreds();
    if (!creds.email?.email) return false;
    _config = creds.email;
    startPolling(60_000);
    console.log(`[Email] ♻️  Auto-connected: ${_config.email}`);
    return true;
}
