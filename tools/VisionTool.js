
import puppeteer from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import fs from 'fs/promises';
import path from 'path';

/**
 * VisionTool — Gives MAX the ability to "see" the web.
 * Launches a local Chrome instance, navigates to a URL, takes a screenshot,
 * and uses the multimodal Gemini brain to analyze the image.
 */
export const createVisionTool = (max) => ({
    name: 'vision',
    description: 'Load a webpage and visually inspect it. Use this to read charts, dashboards, or complex UI layouts that standard HTML scraping cannot parse.',

    actions: {
        async inspect({ url, instruction = "Describe what you see on this page." }) {
            if (!max.brain._smart.geminiKey) {
                return { success: false, error: "Vision requires a configured Gemini API key (Smart Tier)." };
            }

            console.log(`[VisionTool] 👁️  Looking at: ${url}`);
            let browser = null;

            try {
                // Find local Chrome executable
                const chromePath = chromeLauncher.Launcher.getInstallations()[0];
                if (!chromePath) {
                    return { success: false, error: "Could not find a local Chrome/Edge installation." };
                }

                // Launch headless browser
                browser = await puppeteer.launch({
                    executablePath: chromePath,
                    headless: "new",
                    defaultViewport: { width: 1280, height: 800 }
                });

                const page = await browser.newPage();
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

                // Take screenshot
                const tmpPath = path.join(process.cwd(), '.max', 'tmp', `vision_${Date.now()}.png`);
                await fs.mkdir(path.dirname(tmpPath), { recursive: true });
                await page.screenshot({ path: tmpPath, fullPage: false });

                // Read image as base64 for Gemini
                const imageBuffer = await fs.readFile(tmpPath);
                const base64Image = imageBuffer.toString('base64');

                // Cleanup
                await browser.close();
                await fs.unlink(tmpPath).catch(() => {});

                console.log(`[VisionTool] 🧠 Processing visual data...`);

                // We must use the raw Gemini API format for multimodal requests
                const body = {
                    contents: [{
                        parts: [
                            { text: instruction },
                            { inlineData: { mimeType: "image/png", data: base64Image } }
                        ]
                    }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
                };

                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${max.brain._smart.geminiModel}:generateContent?key=${max.brain._smart.geminiKey}`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body),
                    signal:  AbortSignal.timeout(60000)
                });

                if (!res.ok) {
                    const err = await res.text();
                    return { success: false, error: `Vision API failed: ${err}` };
                }

                const data = await res.json();
                const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No visual analysis returned.';

                return { success: true, url, analysis };

            } catch (err) {
                if (browser) await browser.close().catch(() => {});
                return { success: false, error: err.message };
            }
        }
    }
});
