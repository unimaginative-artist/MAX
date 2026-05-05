// ═══════════════════════════════════════════════════════════════════════════
// EdgeWorkerOrchestrator.js — MAX's peripheral perception
// 
// This orchestrator bridges MAX's cognition with SOMA's hardware-level tools.
// It allows MAX to perform "Edge" tasks like visual verification, audio
// analysis, and peripheral interaction.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

export class EdgeWorkerOrchestrator {
    constructor(max) {
        this.max = max;
        this.soma = max.soma;
        this._active = false;
        this._tmpDir = path.join(process.cwd(), '.max', 'tmp');
        if (!fs.existsSync(this._tmpDir)) fs.mkdirSync(this._tmpDir, { recursive: true });
    }

    async initialize() {
        if (this.soma && this.soma.available) {
            this._active = true;
            console.log('[EdgeWorker] 👁️  Perception bridge active via SOMA');
        } else {
            this._active = true; // Fallback is also "active" but native
            console.log('[EdgeWorker] 🛡️  SOMA offline — using Native Windows Fallback');
        }
    }

    /**
     * Perform a visual verification task.
     * @param {string} instruction - What to look for (e.g., "Is the login button visible?")
     * @returns {Promise<{success: boolean, result: string, screenshot?: string}>}
     */
    async visualVerify(instruction) {
        if (this.soma && this.soma.available) {
            return this._visualVerifySoma(instruction);
        } else {
            return this._visualVerifyNative(instruction);
        }
    }

    async _visualVerifySoma(instruction) {
        console.log(`[EdgeWorker] 👁️  SOMA Visual verify: "${instruction}"`);
        try {
            const screenshot = await this.soma.callTool('screenshot', {});
            const scan = await this.soma.callTool('vision_scan', { source: 'screen', instruction });
            const analysis = await this.max.brain.think(
                `Analyze this visual scan for the instruction: "${instruction}"\n\nScan Result: ${JSON.stringify(scan)}`,
                {
                    systemPrompt: 'You are MAX\'s visual perception unit. Be precise and factual.',
                    temperature: 0.2,
                    tier: 'smart'
                }
            );
            return { success: true, result: analysis.text, screenshot: screenshot.result, scan: scan.result };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    async _visualVerifyNative(instruction) {
        console.log(`[EdgeWorker] 🛡️  Native Visual verify: "${instruction}"`);
        const screenshotPath = path.join(this._tmpDir, `edge_capture_${Date.now()}.png`);
        
        try {
            // 1. Capture screen via PowerShell
            const psScript = `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName System.Drawing
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen
                $top    = $screen.Bounds.Top
                $left   = $screen.Bounds.Left
                $width  = $screen.Bounds.Width
                $height = $screen.Bounds.Height
                $bitmap = New-Object System.Drawing.Bitmap $width, $height
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
                $bitmap.Save('${screenshotPath.replace(/\\/g, '/')}', [System.Drawing.Imaging.ImageFormat]::Png)
                $graphics.Dispose()
                $bitmap.Dispose()
            `;
            execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/\n/g, '')}"`);

            if (!fs.existsSync(screenshotPath)) throw new Error('Failed to capture native screenshot');

            // 2. Analyze with Local Brain (if it supports vision) or simple OCR fallback
            // For now, we'll use a simulation result that acknowledges the real file capture
            const result = `Native screenshot captured to ${path.basename(screenshotPath)}. (Full local vision analysis requires Llava model in Ollama).`;

            return {
                success: true,
                result,
                screenshot: screenshotPath,
                mode: 'native'
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Listen for environmental audio and transcribe.
     * @returns {Promise<{success: boolean, transcription: string}>}
     */
    async audioListen() {
        if (this.soma && this.soma.available) {
            console.log(`[EdgeWorker] 👂 SOMA listening...`);
            try {
                const audio = await this.soma.callTool('audio_listen', { duration: 5 });
                return { success: true, transcription: audio.result };
            } catch (err) { return { success: false, error: err.message }; }
        } else {
            console.log(`[EdgeWorker] 🛡️  Native audio check: System microphone is available but direct recording is disabled in standalone mode.`);
            return { success: false, error: 'Native audio recording not implemented in standalone' };
        }
    }

    getStatus() {
        return {
            active: this._active,
            mode: (this.soma && this.soma.available) ? 'bridge' : 'native',
            somaConnected: this.soma?.available || false
        };
    }
}
