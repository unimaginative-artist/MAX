'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn } = require('child_process');

// ── Paths ─────────────────────────────────────────────────────────────────────
const APP_ROOT = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');

const MAX_DIR   = path.join(APP_ROOT, '.max');
const USER_FILE = path.join(MAX_DIR, 'user.md');
const API_ENV   = path.join(APP_ROOT, 'config', 'api-keys.env');

let mainWindow  = null;
let wizardWindow = null;
let serverProc  = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function isFirstRun() {
    return !fs.existsSync(USER_FILE);
}

function ensureDirs() {
    [MAX_DIR, path.join(APP_ROOT, 'config')].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
    // Seed api-keys.env from example if it doesn't exist yet
    const example = path.join(APP_ROOT, 'config', 'api-keys.env.example');
    if (!fs.existsSync(API_ENV) && fs.existsSync(example)) {
        fs.copyFileSync(example, API_ENV);
    }
}

// Poll localhost until the server responds (or timeout)
function waitForServer(port = 3100, timeout = 20000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeout;
        const check = () => {
            http.get(`http://localhost:${port}/api/status`, res => {
                resolve();
            }).on('error', () => {
                if (Date.now() > deadline) return reject(new Error('Server startup timed out'));
                setTimeout(check, 600);
            });
        };
        check();
    });
}

// Find the node executable (dev uses system node; packaged could bundle one)
function findNode() {
    const candidates = process.platform === 'win32'
        ? ['node.exe', 'node']
        : ['node'];
    // Try PATH first
    for (const c of candidates) {
        try {
            require('child_process').execSync(`${c} --version`, { stdio: 'ignore' });
            return c;
        } catch {}
    }
    // Common install locations on Windows
    const winExtras = [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'nodejs', 'node.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'nodejs', 'node.exe'),
        process.env.APPDATA && path.join(process.env.APPDATA, 'nvm', 'current', 'node.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'fnm_multishells', 'node.exe'),
    ].filter(Boolean);
    for (const p of winExtras) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

// ── Server ────────────────────────────────────────────────────────────────────
async function startServer() {
    const nodeExe = findNode();
    if (!nodeExe) {
        dialog.showErrorBox(
            'Node.js not found',
            'Maxwell requires Node.js 18 or later.\n\nDownload it at https://nodejs.org then restart Maxwell.'
        );
        app.quit();
        return;
    }

    const entry = path.join(APP_ROOT, 'server', 'server.js');
    serverProc = spawn(nodeExe, [entry], {
        cwd: APP_ROOT,
        env: { ...process.env, MAX_PORT: '3100', ELECTRON: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProc.stderr.on('data', d => process.stderr.write('[server] ' + d));
    serverProc.on('exit', code => {
        if (code && code !== 0) console.error('[server] exited with code', code);
    });

    await waitForServer(3100);
}

// ── Windows ───────────────────────────────────────────────────────────────────
function createWizard() {
    wizardWindow = new BrowserWindow({
        width:  840,
        height: 700,
        resizable: false,
        center: true,
        frame: process.platform !== 'darwin',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#09090e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    wizardWindow.loadFile(path.join(__dirname, 'setup-wizard.html'));
}

async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width:  1400,
        height: 900,
        minWidth:  900,
        minHeight: 600,
        center: true,
        frame: process.platform !== 'darwin',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        backgroundColor: '#09090e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Show loading screen while server boots
    mainWindow.loadFile(path.join(__dirname, 'loading.html'));

    if (!serverProc) await startServer();

    mainWindow.loadURL('http://localhost:3100/maxwell');
    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('setup:save-profile', async (_e, profile) => {
    try {
        ensureDirs();
        const now = new Date().toISOString().split('T')[0];

        const userMd =
`# User Profile
> Edit this file anytime. MAX reads it on every boot and picks up changes automatically.

**Name:** ${profile.name || 'User'}
**Role:** ${profile.role || 'Not specified'}
**Communication Style:** ${profile.styleKey || 'chill'}
**First session:** ${now}

## Current Project
${profile.project || 'Not specified'}

## Stack
${profile.stack || 'Not specified'}

## Current Challenge
${profile.challenge || 'Not specified'}

## Notes
(MAX will add observations here as he gets to know you)
`;

        const taskList = (profile.tasks || '')
            .split(',').map(t => t.trim()).filter(Boolean)
            .map(t => `- [ ] ${t}`).join('\n') || '- [ ] (add your tasks here)';

        const tasksMd =
`# Tasks
> Edit this file anytime. MAX checks it regularly.
> Format: - [ ] pending | - [x] done | - [~] in progress

## Active
${taskList}

## Goals
${profile.goals || '(add longer-term goals here)'}

## Backlog
(add future tasks here)

## Completed
(MAX moves finished tasks here)
`;

        fs.writeFileSync(USER_FILE, userMd, 'utf8');
        fs.writeFileSync(path.join(MAX_DIR, 'tasks.md'), tasksMd, 'utf8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('setup:save-api-key', async (_e, { key }) => {
    try {
        ensureDirs();
        let content = fs.existsSync(API_ENV)
            ? fs.readFileSync(API_ENV, 'utf8')
            : '# MAX API Keys\n';

        if (content.includes('DEEPSEEK_API_KEY=')) {
            content = content.replace(/DEEPSEEK_API_KEY=.*/g, `DEEPSEEK_API_KEY=${key}`);
        } else {
            content += `\nDEEPSEEK_API_KEY=${key}\n`;
        }
        fs.writeFileSync(API_ENV, content, 'utf8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.on('open-external', (_e, url) => shell.openExternal(url));

ipcMain.on('setup:complete', async () => {
    if (wizardWindow) { wizardWindow.close(); wizardWindow = null; }
    await createMainWindow();
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    ensureDirs();
    if (isFirstRun()) {
        createWizard();
    } else {
        await createMainWindow();
    }
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
    });
});

app.on('window-all-closed', () => {
    if (serverProc) { serverProc.kill(); serverProc = null; }
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (serverProc) { serverProc.kill(); serverProc = null; }
});
