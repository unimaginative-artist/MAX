// ═══════════════════════════════════════════════════════════════════════════
// EdgeWorkerOrchestrator.js — MAX's peripheral perception
// 
// This orchestrator bridges MAX's cognition with SOMA's hardware-level tools.
// It allows MAX to perform "Edge" tasks like visual verification, audio
// analysis, and peripheral interaction.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';

export class EdgeWorkerOrchestrator {
    constructor(max) {
        this.max = max;
        this.soma = max.soma;
        this._active = false;
    }

    async initialize() {
        if (this.soma && this.soma.available) {
            this._active = true;
            console.log('[EdgeWorker] 👁️  Perception bridge active via SOMA');
        } else {
            console.log('[EdgeWorker] ⚠️  SOMA offline — perception tasks will be simulated');
        }
    }

    /**
     * Perform a visual verification task.
     * @param {string} instruction - What to look for (e.g., "Is the login button visible?")
     * @returns {Promise<{success: boolean, result: string, screenshot?: string}>}
     */
    async visualVerify(instruction) {
        if (!this._active) return { success: false, error: 'SOMA perception bridge offline' };

        console.log(`[EdgeWorker] 👁️  Visual verify: "${instruction}"`);
        
        try {
            // 1. Capture screen
            const screenshot = await this.soma.callTool('screenshot', {});
            
            // 2. Use vision_scan to find objects
            const scan = await this.soma.callTool('vision_scan', { 
                source: 'screen', 
                instruction 
            });

            // 3. Analyze with brain + vision context
            const analysis = await this.max.brain.think(
                `Analyze this visual scan for the instruction: "${instruction}"\n\nScan Result: ${JSON.stringify(scan)}`,
                {
                    systemPrompt: 'You are MAX\'s visual perception unit. Be precise and factual.',
                    temperature: 0.2,
                    tier: 'smart'
                }
            );

            return {
                success: true,
                result: analysis.text,
                screenshot: screenshot.result,
                scan: scan.result
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
        if (!this._active) return { success: false, error: 'SOMA audio bridge offline' };

        console.log(`[EdgeWorker] 👂 Listening to environment...`);
        
        try {
            const audio = await this.soma.callTool('audio_listen', { duration: 5 });
            return {
                success: true,
                transcription: audio.result
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    getStatus() {
        return {
            active: this._active,
            somaConnected: this.soma?.available || false
        };
    }
}
