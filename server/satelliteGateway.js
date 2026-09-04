// ═══════════════════════════════════════════════════════════════════════════
// satelliteGateway.js — GMN Reverse-RPC & WebSocket Gateway for Maxwell Satellite
// Enables remote desktop Orbs to connect, stream cognition, drop office files,
// and receive Reverse-RPC actions to execute locally on the user's computer.
// ═══════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
import { existsSync, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { OfficeTool } from '../tools/OfficeTool.js';

export class SatelliteGateway {
    constructor(max, opts = {}) {
        this.max = max;
        this.officeTool = new OfficeTool(max);
        this.clients = new Map(); // ws -> clientMetadata
        this.uploadDir = path.resolve(process.cwd(), '.max', 'satellite_uploads');
        this.secret = opts.secret || process.env.MAX_CLUSTER_SECRET || '';
        fs.mkdir(this.uploadDir, { recursive: true }).catch(() => {});
    }

    handleConnection(ws, req) {
        const clientId = crypto.randomUUID();
        const ip = req.socket?.remoteAddress || 'unknown';
        const meta = {
            id: clientId,
            ip,
            connectedAt: Date.now(),
            platform: req.headers?.['user-agent'] || 'satellite-client'
        };

        this.clients.set(ws, meta);
        console.log(`[SatelliteGateway] 🛰️ Satellite Orb connected: ${clientId} (${ip})`);

        // Send handshake ack
        this._send(ws, {
            type: 'handshake_ack',
            clientId,
            clusterNodes: {
                machine_a: 'SOMA Queen (3001)',
                machine_b: 'MAX Master (3100)'
            },
            capabilities: ['office_audit', 'formula_healing', 'pptx_generation', 'reverse_rpc_actions']
        });

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await this._handleMessage(ws, message, meta);
            } catch (err) {
                this._send(ws, { type: 'error', error: `Malformed message: ${err.message}` });
            }
        });

        ws.on('close', () => {
            console.log(`[SatelliteGateway] 🔌 Satellite Orb disconnected: ${clientId}`);
            this.clients.delete(ws);
        });
    }

    mountRestRoutes(app) {
        this._mountRestRoutes(app);
        console.log('[SatelliteGateway] ✅ Gateway online on /ws/satellite & /api/satellite/*');
    }

    _send(ws, data) {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    async _handleMessage(ws, msg, meta) {
        const { type, payload } = msg;

        switch (type) {
            case 'ping':
                this._send(ws, { type: 'pong', timestamp: Date.now() });
                break;

            case 'prompt':
                await this._handlePrompt(ws, payload);
                break;

            case 'audit_sheet':
                await this._handleAuditSheet(ws, payload);
                break;

            case 'repair_sheet':
                await this._handleRepairSheet(ws, payload);
                break;

            case 'generate_deck':
                await this._handleGenerateDeck(ws, payload);
                break;

            case 'action_result':
                console.log(`[SatelliteGateway] 📥 Received local action result from ${meta.id}:`, payload);
                this.max?.memory?.remember(`Satellite local action ${payload.actionId} finished: ${JSON.stringify(payload.result)}`, {
                    source: 'satellite_action',
                    clientId: meta.id
                });
                break;

            default:
                this._send(ws, { type: 'unknown_type', originalType: type });
        }
    }

    async _handlePrompt(ws, payload) {
        const { text, context = {} } = payload;
        if (!text) return;

        this._send(ws, { type: 'status', status: 'thinking' });

        try {
            const res = await this.max.think(text, {
                systemPrompt: `You are Maxwell Satellite, Barry's sovereign AI desktop assistant. You are running on an unobtrusive floating desktop Orb. You assist with daily office workflows, spreadsheet audits, calculations, document creation, and desktop actions with warm, sharp, and concise execution.`,
                onToken: (token) => {
                    this._send(ws, { type: 'token', token });
                }
            });

            this._send(ws, {
                type: 'complete',
                response: res.response || res.text || '',
                persona: res.persona,
                drive: res.drive
            });
        } catch (err) {
            this._send(ws, { type: 'error', error: err.message });
        }
    }

    async _handleAuditSheet(ws, payload) {
        const { filePath, fileBase64, fileName } = payload;
        let targetPath = filePath;

        if (fileBase64 && fileName) {
            targetPath = path.join(this.uploadDir, `${Date.now()}_${fileName}`);
            await fs.writeFile(targetPath, Buffer.from(fileBase64, 'base64'));
        }

        if (!targetPath || !existsSync(targetPath)) {
            return this._send(ws, { type: 'audit_result', ok: false, error: 'File path not found or invalid' });
        }

        this._send(ws, { type: 'status', status: 'auditing_spreadsheet' });
        const result = await this.officeTool.analyzeSpreadsheet({ filePath: targetPath });

        this._send(ws, {
            type: 'audit_result',
            ...result,
            fileName: path.basename(targetPath)
        });
    }

    async _handleRepairSheet(ws, payload) {
        const { filePath, fileBase64, fileName, autoHealGaps = true } = payload;
        let targetPath = filePath;

        if (fileBase64 && fileName) {
            targetPath = path.join(this.uploadDir, `${Date.now()}_${fileName}`);
            await fs.writeFile(targetPath, Buffer.from(fileBase64, 'base64'));
        }

        this._send(ws, { type: 'status', status: 'repairing_spreadsheet' });
        const result = await this.officeTool.repairSpreadsheet({ filePath: targetPath, autoHealGaps });

        let repairedBase64 = null;
        if (result.ok && result.repairedPath && existsSync(result.repairedPath)) {
            const buf = await fs.readFile(result.repairedPath);
            repairedBase64 = buf.toString('base64');
        }

        this._send(ws, {
            type: 'repair_result',
            ...result,
            fileName: path.basename(result.repairedPath || targetPath),
            fileBase64: repairedBase64
        });
    }

    async _handleGenerateDeck(ws, payload) {
        const { title, subtitle, slides, theme } = payload;
        this._send(ws, { type: 'status', status: 'generating_presentation' });

        const result = await this.officeTool.generatePresentation({ title, subtitle, slides, theme });
        let deckBase64 = null;
        if (result.ok && result.outputPath && existsSync(result.outputPath)) {
            const buf = await fs.readFile(result.outputPath);
            deckBase64 = buf.toString('base64');
        }

        this._send(ws, {
            type: 'deck_result',
            ...result,
            fileName: path.basename(result.outputPath),
            fileBase64: deckBase64
        });
    }

    // ── Dispatch a Reverse-RPC action to a connected satellite desktop ───
    dispatchAction(wsOrClientId, actionPayload) {
        let ws = wsOrClientId;
        if (typeof wsOrClientId === 'string') {
            for (const [socket, meta] of this.clients.entries()) {
                if (meta.id === wsOrClientId) {
                    ws = socket;
                    break;
                }
            }
        }

        if (!ws || ws.readyState !== ws.OPEN) {
            return { ok: false, error: 'Target satellite client not connected' };
        }

        const actionId = crypto.randomUUID();
        this._send(ws, {
            type: 'dispatch_action',
            actionId,
            ...actionPayload
        });

        return { ok: true, actionId };
    }

    _mountRestRoutes(app) {
        // Raw file upload
        app.post('/api/satellite/upload', async (req, res) => {
            const filename = req.query.name || `drop_${Date.now()}.xlsx`;
            const destPath = path.join(this.uploadDir, filename);

            try {
                const chunks = [];
                req.on('data', chunk => chunks.push(chunk));
                req.on('end', async () => {
                    const buffer = Buffer.concat(chunks);
                    await fs.writeFile(destPath, buffer);

                    // Auto audit on upload
                    const audit = await this.officeTool.analyzeSpreadsheet({ filePath: destPath });
                    res.json({
                        ok: true,
                        filePath: destPath,
                        filename,
                        audit
                    });
                });
            } catch (err) {
                res.status(500).json({ ok: false, error: err.message });
            }
        });

        // File download
        app.get('/api/satellite/download/:filename', async (req, res) => {
            const filename = path.basename(req.params.filename);
            const candidates = [
                path.join(this.uploadDir, filename),
                path.join(process.cwd(), '.max', 'presentations', filename),
                path.join(process.cwd(), '.max', 'tmp', filename)
            ];

            const found = candidates.find(p => existsSync(p));
            if (!found) {
                return res.status(404).json({ ok: false, error: 'File not found' });
            }

            res.download(found, filename);
        });

        // Tier connection matrix discovery endpoint
        app.get('/api/satellite/tier-matrix', async (req, res) => {
            const relayFile = path.resolve(process.cwd(), '.max', 'gmn_public_relay.json');
            let publicRelay = null;
            try {
                if (existsSync(relayFile)) {
                    const data = JSON.parse(await fs.readFile(relayFile, 'utf8'));
                    publicRelay = data.url;
                }
            } catch {}

            res.json({
                ok: true,
                tiers: {
                    tier1_lan: 'http://192.168.1.250:3100',
                    tier2_mesh: process.env.MAX_TAILSCALE_URL || null,
                    tier3_relay: publicRelay
                }
            });
        });
    }
}
