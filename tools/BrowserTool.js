import path from 'path';
import fs   from 'fs';

const screenshotDir = path.join(process.cwd(), '.max', 'screenshots');

let _browser = null;
let _context = null;
let _page    = null;
let _pw      = null;

async function pw() {
    if (!_pw) {
        try {
            _pw = await import('playwright');
        } catch {
            throw new Error('Playwright not installed — run: npm install playwright && npx playwright install chromium');
        }
    }
    return _pw;
}

async function getPage() {
    const { chromium } = await pw();
    if (!_browser || !_browser.isConnected()) {
        _browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        _context = await _browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
            viewport:  { width: 1280, height: 800 }
        });
    }
    if (!_page || _page.isClosed()) {
        _page = await _context.newPage();
    }
    return _page;
}

export const BrowserTool = {
    name: 'browser',
    description: `Control a real Chromium browser for web automation, research, and testing.
Actions:
  goto       → navigate to a URL: TOOL:browser:goto:{"url":"https://example.com"}
  click      → click an element: TOOL:browser:click:{"selector":"button#submit"}  OR  {"text":"Sign in"}
  type       → fill a field: TOOL:browser:type:{"selector":"input[name=q]","text":"query"}
  extract    → get page text as clean markdown: TOOL:browser:extract:{}
  screenshot → save a screenshot: TOOL:browser:screenshot:{"name":"result"}
  eval       → run JavaScript on the page: TOOL:browser:eval:{"code":"document.title"}
  wait       → wait for selector to appear: TOOL:browser:wait:{"selector":".loaded"}
  close      → close the browser: TOOL:browser:close:{}

Use browser:goto + browser:extract as a high-fidelity alternative to web:search for pages that block scrapers.`,

    actions: {
        goto: async ({ url, waitUntil = 'domcontentloaded' }) => {
            const page = await getPage();
            const res  = await page.goto(url, { waitUntil, timeout: 30_000 });
            const title = await page.title();
            return { success: true, url: page.url(), title, status: res?.status() };
        },

        click: async ({ selector, text }) => {
            const page = await getPage();
            if (text) await page.getByText(text, { exact: false }).first().click({ timeout: 10_000 });
            else await page.click(selector, { timeout: 10_000 });
            await page.waitForTimeout(400);
            return { success: true };
        },

        type: async ({ selector, text, clear = true }) => {
            const page = await getPage();
            await page.waitForSelector(selector, { timeout: 8_000 });
            if (clear) await page.fill(selector, '');
            await page.type(selector, String(text), { delay: 25 });
            return { success: true };
        },

        extract: async ({ selector } = {}) => {
            const page = await getPage();
            const url  = page.url();

            const content = await page.evaluate((sel) => {
                if (sel) {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : '';
                }
                // Strip noise, return main content
                ['script','style','nav','footer','header','aside','iframe','noscript'].forEach(tag =>
                    document.querySelectorAll(tag).forEach(el => el.remove())
                );
                const main = document.querySelector('main, article, [role="main"], .content, #content, body');
                return (main || document.body)?.innerText?.trim() || '';
            }, selector || null);

            return { success: true, url, content: content.slice(0, 10_000) };
        },

        screenshot: async ({ name = 'shot', fullPage = false } = {}) => {
            const page = await getPage();
            if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
            const filename = `${name}_${Date.now()}.png`;
            const filepath = path.join(screenshotDir, filename);
            await page.screenshot({ path: filepath, fullPage });
            return { success: true, path: filepath, filename };
        },

        eval: async ({ code }) => {
            const page   = await getPage();
            const result = await page.evaluate(code);
            return { success: true, result: String(result ?? '').slice(0, 3_000) };
        },

        wait: async ({ selector, timeout = 10_000 }) => {
            const page = await getPage();
            await page.waitForSelector(selector, { timeout });
            return { success: true, selector };
        },

        close: async () => {
            if (_page)    { try { await _page.close();    } catch {} _page    = null; }
            if (_context) { try { await _context.close(); } catch {} _context = null; }
            if (_browser) { try { await _browser.close(); } catch {} _browser = null; }
            return { success: true };
        }
    }
};
