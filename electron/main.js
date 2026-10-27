const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { createStartupController } = require('./startup-controller');

// Keep this checkout's profile, arena session and diagnostics together, even when launched elsewhere.
// Electron requires these directories to exist and sessionData must be set before ready.
const PROJECT_ROOT = path.resolve(__dirname, '..');
const profilePath = path.join(PROJECT_ROOT, 'data', 'desktop');
const logsPath = path.join(PROJECT_ROOT, 'data', 'logs');
const crashPath = path.join(PROJECT_ROOT, 'data', 'crashes');
for (const directory of [profilePath, logsPath, crashPath]) fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);
app.setPath('crashDumps', crashPath);
app.setAppLogsPath(logsPath);

// Mr Goose — Electron main process.
// Owns the window, spawns the C# backend sidecar, and manages embedded arena tabs (WebContentsView).
//
// HARD RAIL: the page bridge is FILL + READ only. No code path here sends, launches or submits on
// an arena page — the human clicks every send/launch/submit. (Gray Swan RoE + user decision.)

const BACKEND_URL = process.env.MRGOOSE_BACKEND_URL || 'http://127.0.0.1:5174';
let RENDERER_URL = process.env.MRGOOSE_RENDERER_URL || 'http://localhost:4200';
if (new URL(BACKEND_URL).hostname !== '127.0.0.1' || new URL(RENDERER_URL).hostname !== 'localhost' && new URL(RENDERER_URL).hostname !== '127.0.0.1') throw new Error('MrGoose services must use local addresses');
const { randomBytes, randomUUID } = require('node:crypto');
const backendToken = randomBytes(32).toString('hex');
const instanceId = randomUUID();

let backend = null;
let mainWindow = null;
let startup = null;
let quitting = false;

let arena = null;
let control = null;
let tray = null;
let arenaWindow = null;
let cockpitServer = null;
let cockpitOpening = null;

// ───────────────────────── backend sidecar ─────────────────────────
function backendExePath() {
  return path.join(__dirname, '..', 'backend', 'bin', 'Debug', 'net10.0', 'MrGoose.Backend.exe');
}
function startBackend() {
  backend = spawn(backendExePath(), ['--urls', BACKEND_URL], { cwd: PROJECT_ROOT, stdio: 'inherit', windowsHide: true, env: { ...process.env, MRGOOSE_CONTROL_TOKEN: backendToken, MRGOOSE_INSTANCE_ID: instanceId, MRGOOSE_RENDERER_ORIGIN: new URL(RENDERER_URL).origin } });
  backend.on('error', (err) =>
    console.error('[mrgoose] backend failed to start:', err.message,
      '\n  Build it first:  dotnet build backend/MrGoose.Backend.csproj -c Debug'));
  backend.on('exit', (code) => { console.log('[mrgoose] backend exited', code); backend = null; });
}
function stopBackend() {
  if (backend && !backend.killed) { try { backend.kill(); } catch { /* ignore */ } backend = null; }
}
async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BACKEND_URL}/health`, { headers: { Authorization: 'Bearer ' + backendToken } }); if (r.ok && (await r.json()).instanceId === instanceId) return true; } catch { /* not up */ }
    await new Promise((res) => setTimeout(res, 400));
  }
  return false;
}

// All page callers share the same explicit-tab service. Only the cockpit may invoke IPC.
function registerBridge() {
  const { ArenaBrowserService } = require('./arena-browser-service');
  arena = new ArenaBrowserService({ WebContentsView, getWindow: () => arenaWindow?.window,
    changed: value => { arenaWindow?.update(value); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mrgoose:tabs:changed', value); } });
  const { createArenaWindow } = require('./arena-window');
  arenaWindow = createArenaWindow({ BrowserWindow, ipcMain, browser: arena, isQuitting: () => quitting, openCockpit: showCockpit });
  const handle = (name, action) => ipcMain.handle(name, (event, args = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('UNAUTHORIZED_IPC');
    return action(args);
  });
  handle('mrgoose:tabs:create', async ({ url }) => { const id = await arena.create(url); arenaWindow.show(id); return id; });
  handle('mrgoose:tabs:select', ({ tabId }) => { arenaWindow.show(tabId); return arena.list(); });
  handle('mrgoose:tabs:show', () => arenaWindow.show());
  handle('mrgoose:tabs:close', ({ tabId }) => arena.close(tabId));
  handle('mrgoose:tabs:list', () => arena.list());
  handle('mrgoose:tabs:loadUrl', ({ tabId, url }) => arena.loadUrl(tabId, url));
  // Older cockpit panes cannot move or hide the separate Arena window.
  handle('mrgoose:tabs:setBounds', () => true);
  handle('mrgoose:tabs:setVisible', () => true);
  for (const [channel, operation] of Object.entries({ fillField: 'fill', readDom: 'read', snapshotConversation: 'snapshot', highlightSendButton: 'highlight', pickElement: 'pick' })) {
    handle('mrgoose:' + channel, async ({ tabId, selector, value }) => {
      try {
        if (operation === 'fill' && arena.entry(tabId).attemptId) throw Object.assign(new Error('MCP attempt inputs are immutable; prepare a new attempt.'), { code: 'ATTEMPT_TAB_LOCKED' });
        return await arena.page(tabId, operation, { selector, value, limit: 16000 });
      } catch (error) { return { ok: false, code: error.code || 'PAGE_ERROR', note: error.message }; }
    });
  }
  handle('mrgoose:mcp:status', () => control.management());
  handle('mrgoose:mcp:profile', profile => control.saveProfile(profile));
}

async function startControl() {
  if (control) return;
  const { LocalControl } = require('./local-control');
  const candidate = new LocalControl({ directory: path.join(PROJECT_ROOT, 'data', 'mcp'), browser: arena,
    runtimePath: process.execPath, adapterPath: path.join(PROJECT_ROOT, 'mcp', 'server.cjs'),
    hide: () => arenaWindow.hide(),
    present: async tabId => arenaWindow.show(tabId),
    data: async (operation, args) => {
      const response = await fetch(BACKEND_URL + '/api/control/' + operation, { method: 'POST',
        headers: { Authorization: 'Bearer ' + backendToken, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.message || value.code || 'BACKEND_ERROR'), { code: value.code || 'BACKEND_ERROR' });
      return value;
    } });
  await candidate.start();
  const { Tray, Menu } = require('electron');
  tray = new Tray(path.join(__dirname, 'icon.ico'));
  tray.setToolTip('MrGoose — running');
  const show = () => { void showCockpit().catch(error => console.error('[mrgoose] workspace:', error.message)); };
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show workspace', click: show }, { label: 'Show Arena', click: () => arenaWindow.show() }, { label: 'Hide Arena', click: () => arenaWindow.hide() }, { type: 'separator' }, { label: 'Quit MrGoose', click: () => app.quit() }]));
  tray.on('double-click', show);
  control = candidate;
}

// ───────────────────────── window ─────────────────────────
async function createWindow() {
  const window = new BrowserWindow({
    width: 1480, height: 940, show: false,
    backgroundColor: '#0a0a0b', title: 'Mr Goose', autoHideMenuBar: true,
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, additionalArguments: ['--mrgoose-backend-token=' + backendToken] },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(RENDERER_URL).origin) event.preventDefault(); });
  window.on('close', event => { if (!quitting && control) { event.preventDefault(); window.hide(); } });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  const painted = new Promise(resolve => window.once('ready-to-show', resolve));
  try {
    await window.loadURL(RENDERER_URL);
    await painted;
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

async function showCockpit() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    cockpitOpening ||= createWindow().finally(() => { cockpitOpening = null; });
    await cockpitOpening;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', (_event, argv) => { if (argv.includes('--arena-only')) { if (arenaWindow?.window) arenaWindow.show(); } else void showCockpit().catch(error => console.error(error.message)); });
  if (process.platform === 'win32') app.setAppUserModelId('com.mrgoose.cockpit');
  registerBridge();
  if (!process.env.MRGOOSE_RENDERER_URL) {
    const { startCockpitServer } = require('./cockpit-server');
    cockpitServer = await startCockpitServer(path.join(PROJECT_ROOT, 'client', 'dist', 'client', 'browser'));
    if (cockpitServer) RENDERER_URL = cockpitServer.url;
  }
  startup = createStartupController({ app, BrowserWindow, ipcMain, directory: __dirname });
  await startup.open(async report => {
    report('service');
    if (!backend) startBackend();
    const healthy = await waitForHealth();
    if (quitting) return null;
    if (!healthy) throw new Error('The local service did not respond. Check the backend log and retry.');
    report('workspace');
    if (!arenaWindow.window) await arenaWindow.create();
    await startControl();
    if (process.argv.includes('--arena-only')) return arenaWindow.window;
    // Normal app launches always open the workspace. The hidden Arena host is shown
    // only by an explicit arena request (for example arena_open_tab/attempt_present).
    await showCockpit();
    return mainWindow;
  });
  app.on('activate', () => {
    if (!quitting) void showCockpit().catch(error => console.error(error.message));
  });
}).catch(error => { console.error('[mrgoose] startup error:', error); app.quit(); });

app.on('window-all-closed', () => { stopBackend(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { quitting = true; startup?.cancel(); void control?.stop(); cockpitServer?.close(); tray?.destroy(); stopBackend(); });
process.on('exit', stopBackend);
