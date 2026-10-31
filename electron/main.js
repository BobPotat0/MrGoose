const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { createStartupController } = require('./startup-controller');
const { resolveRuntimePaths } = require('./runtime-paths');

// Keep this checkout's profile, arena session and diagnostics together, even when launched elsewhere.
// Electron requires these directories to exist and sessionData must be set before ready.
const PROJECT_ROOT = path.resolve(__dirname, '..');
if (app.isPackaged) app.setName('MrGoose');
const runtime = resolveRuntimePaths({ isPackaged: !!app.isPackaged, projectRoot: PROJECT_ROOT,
  resourcesPath: process.resourcesPath, userDataPath: app.isPackaged ? app.getPath('userData') : null, platform: process.platform, env: process.env });
const profilePath = runtime.profile;
const logsPath = runtime.logs;
const crashPath = runtime.crashes;
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
let sourceWindow = null; // standalone browser window for Source-library links (separate from the arena)
let cockpitServer = null;
let cockpitOpening = null;
let updater = null;
// The arena browser is embedded in the cockpit by default; it can be detached into its own window.
let arenaDocked = true;
let dockedBounds = { x: 0, y: 0, width: 0, height: 0 };

// ───────────────────────── backend sidecar ─────────────────────────
function backendExePath() {
  return runtime.backend;
}
let keyEncryptionKey;
function startBackend() {
  backend = spawn(backendExePath(), ['--urls', BACKEND_URL], { cwd: runtime.backendDirectory, stdio: 'inherit', windowsHide: true, env: { ...process.env,
    MRGOOSE_DB_PATH: runtime.database, MRGOOSE_KEY_ENCRYPTION_KEY: keyEncryptionKey, MRGOOSE_APP_VERSION: app.isPackaged ? app.getVersion() : '',
    MRGOOSE_CONTROL_TOKEN: backendToken, MRGOOSE_INSTANCE_ID: instanceId, MRGOOSE_RENDERER_ORIGIN: new URL(RENDERER_URL).origin } });
  backend.on('error', (err) =>
    console.error('[mrgoose] backend failed to start:', err.message,
      app.isPackaged ? '\n  Reinstall MrGoose or check its local logs.' : '\n  Build it first: dotnet build backend/MrGoose.Backend.csproj -c Debug'));
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
  arena = new ArenaBrowserService({ WebContentsView, getWindow: () => (arenaDocked ? mainWindow : arenaWindow?.window),
    changed: value => { arenaWindow?.update(value); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mrgoose:tabs:changed', value); } });
  const { createArenaWindow } = require('./arena-window');
  arenaWindow = createArenaWindow({ BrowserWindow, ipcMain, browser: arena, isQuitting: () => quitting, openCockpit: showCockpit, dock: dockArena });
  const handle = (name, action) => ipcMain.handle(name, (event, args = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('UNAUTHORIZED_IPC');
    return action(args);
  });
  handle('mrgoose:tabs:create', async ({ url }) => { const id = await arena.create(url); await presentArena(id); return id; });
  handle('mrgoose:tabs:select', ({ tabId }) => { arena.select(tabId); if (!arenaDocked) arenaWindow.show(tabId); return arena.list(); });
  handle('mrgoose:tabs:show', () => presentArena());
  handle('mrgoose:tabs:close', ({ tabId }) => arena.close(tabId));
  handle('mrgoose:tabs:list', () => arena.list());
  handle('mrgoose:tabs:loadUrl', ({ tabId, url }) => arena.loadUrl(tabId, url));
  // Docked: the cockpit pane positions and shows the embedded view. Detached: the Arena window owns bounds.
  handle('mrgoose:tabs:setBounds', (rect) => { dockedBounds = rect; if (arenaDocked) arena.setBounds(rect); return true; });
  handle('mrgoose:tabs:setVisible', ({ visible }) => { if (arenaDocked) arena.setVisible(visible); return true; });
  handle('mrgoose:arena:detach', () => detachArena());
  handle('mrgoose:arena:dock', () => dockArena());
  handle('mrgoose:arena:state', () => ({ docked: arenaDocked }));
  // Source-library links open in their OWN standalone browser window, never embedded and never the arena.
  handle('mrgoose:open-url', ({ url }) => openSourceUrl(url));
  handle('mrgoose:app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, updates: updater?.status() }));
  handle('mrgoose:update:check', () => updater?.check());
  handle('mrgoose:update:download', () => updater?.download());
  handle('mrgoose:update:install', () => updater?.install());
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
  const candidate = new LocalControl({ directory: runtime.mcp, browser: arena,
    runtimePath: process.execPath, adapterPath: runtime.adapter,
    hide: hideArena,
    present: presentArena,
    data: async (operation, args) => {
      const response = await fetch(BACKEND_URL + '/api/control/' + operation, { method: 'POST',
        headers: { Authorization: 'Bearer ' + backendToken, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.message || value.code || 'BACKEND_ERROR'), { code: value.code || 'BACKEND_ERROR' });
      return value;
    } });
  await candidate.start();
  const { Tray, Menu } = require('electron');
  tray = new Tray(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
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

// ───────────────────────── arena docking ─────────────────────────
// Bring the arena forward on whichever surface currently hosts it.
async function presentArena(tabId) {
  if (tabId) arena.select(tabId);
  if (arenaDocked) { arena.setVisible(true); await showCockpit(); }
  else { if (!arenaWindow.window) await arenaWindow.create(); arenaWindow.show(tabId); }
}
function hideArena() { if (arenaDocked) arena.setVisible(false); else arenaWindow.hide(); }

async function detachArena() {
  if (!arenaDocked) { arenaWindow.show(); return { docked: false }; }
  if (!arenaWindow.window) await arenaWindow.create();
  arena.reparent(mainWindow, arenaWindow.window);
  arenaDocked = false;
  arenaWindow.show();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mrgoose:arena:docked', { docked: false });
  return { docked: false };
}
async function dockArena() {
  if (arenaDocked) return { docked: true };
  arena.reparent(arenaWindow?.window, mainWindow);
  arenaDocked = true;
  arenaWindow?.hide();
  if (Number.isFinite(dockedBounds.width)) arena.setBounds(dockedBounds);
  arena.setVisible(true);
  await showCockpit();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mrgoose:arena:docked', { docked: true });
  return { docked: true };
}

// ───────────────────────── source links ─────────────────────────
// Open a Source-library link in a real, standalone browser window. This is a genuine top-level
// browser (own persisted session, free navigation) — not an iframe and not the arena view, so it
// handles sites that block framing and never collides with the embedded Gray Swan arena. One window
// is reused: a second "view" loads the new URL and brings it forward.
function openSourceUrl(url) {
  let raw = String(url || '').trim();
  if (!raw) return false;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw; // bare domains (e.g. "google.de") need a scheme
  let target;
  try { target = new URL(raw); } catch { return false; }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  url = raw;
  if (!sourceWindow || sourceWindow.isDestroyed()) {
    sourceWindow = new BrowserWindow({
      width: 1200, height: 860, show: false, backgroundColor: '#0a0a0b',
      title: 'Mr Goose — Source', autoHideMenuBar: true,
      icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      webPreferences: { partition: 'persist:sources', contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // It's a browser: let popups/target=_blank navigate in the same window instead of spawning windows.
    sourceWindow.webContents.setWindowOpenHandler(({ url: next }) => {
      try { const u = new URL(next); if (u.protocol === 'http:' || u.protocol === 'https:') sourceWindow.loadURL(next); } catch { /* ignore */ }
      return { action: 'deny' };
    });
    sourceWindow.webContents.on('page-title-updated', (_e, title) => { if (sourceWindow && !sourceWindow.isDestroyed()) sourceWindow.setTitle(title ? `${title} — Source` : 'Mr Goose — Source'); });
    sourceWindow.on('closed', () => { sourceWindow = null; });
  }
  void sourceWindow.loadURL(url);
  sourceWindow.show();
  sourceWindow.focus();
  return true;
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', (_event, argv) => { if (argv.includes('--arena-only')) { if (arenaWindow?.window) arenaWindow.show(); } else void showCockpit().catch(error => console.error(error.message)); });
  if (process.platform === 'win32') app.setAppUserModelId('com.mrgoose.cockpit');
  registerBridge();
  if (app.isPackaged || !process.env.MRGOOSE_RENDERER_URL) {
    const { startCockpitServer } = require('./cockpit-server');
    cockpitServer = await startCockpitServer(runtime.client, { port: Number(process.env.MRGOOSE_RENDERER_PORT || 5175) });
    if (app.isPackaged && !cockpitServer) throw new Error('The installed workspace is missing. Reinstall MrGoose.');
    if (cockpitServer) RENDERER_URL = cockpitServer.url;
  }
  startup = createStartupController({ app, BrowserWindow, ipcMain, directory: __dirname });
  await startup.open(async report => {
    report('service');
    if (process.platform !== 'win32' && !keyEncryptionKey) {
      const { prepareKeyEncryption } = require('./secure-key');
      keyEncryptionKey = await prepareKeyEncryption(runtime.data, require('electron').safeStorage);
    }
    if (!backend) startBackend();
    const healthy = await waitForHealth();
    if (quitting) return null;
    if (!healthy) throw new Error('The local service did not respond. Check the backend log and retry.');
    report('workspace');
    if (!arenaWindow.window) await arenaWindow.create();
    await startControl();
    const { createUpdater } = require('./updates');
    updater ||= createUpdater({ app, ipcMain, getWindow: () => mainWindow, beforeInstall: async () => {
      quitting = true; await control?.stop(); stopBackend();
    } });
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
