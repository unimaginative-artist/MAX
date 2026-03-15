
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
            if (!max.brain._smart.openaiKey) {
                return { success: false, error: "Vision requires a configured OpenAI API key (Smart Tier)." };
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

                // Read image as base64 for OpenAI
                const imageBuffer = await fs.readFile(tmpPath);
                const base64Image = imageBuffer.toString('base64');

                // Cleanup
                await browser.close();
                await fs.unlink(tmpPath).catch(() => {});

                console.log(`[VisionTool] 🧠 Processing visual data via OpenAI...`);

                // OpenAI Multimodal Format
                const body = {
                    model: max.brain._smart.openaiModel || "gpt-4o",
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: instruction },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/png;base64,${base64Image}`
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 1024
                };

                const res = await fetch(`${max.brain._smart.openaiUrl}/chat/completions`, {
                    method:  'POST',
                    headers: {
                        'Content-Type':  'application/json',
                        'Authorization': `Bearer ${max.brain._smart.openaiKey}`
                    },
                    body:    JSON.stringify(body),
                    signal:  AbortSignal.timeout(60000)
                });

                if (!res.ok) {
                    const err = await res.text();
                    return { success: false, error: `OpenAI Vision API failed: ${err}` };
                }

                const data = await res.json();
                const analysis = data.choices?.[0]?.message?.content?.trim() || 'No visual analysis returned.';

                return { success: true, url, analysis };

            } catch (err) {
                if (browser) await browser.close().catch(() => {});
                return { success: false, error: err.message };
            }
        }
    }
});
