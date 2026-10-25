const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Mr Goose — Electron main process.
// Owns the window, spawns the C# backend sidecar, and manages embedded arena tabs (WebContentsView).
//
// HARD RAIL: the page bridge is FILL + READ only. No code path here sends, launches or submits on
// an arena page — the human clicks every send/launch/submit. (Gray Swan RoE + user decision.)

const BACKEND_URL = process.env.MRGOOSE_BACKEND_URL || 'http://127.0.0.1:5174';
const RENDERER_URL = process.env.MRGOOSE_RENDERER_URL || 'http://localhost:4200';
const ARENA_PARTITION = 'persist:arena'; // shared cookie jar → the Gray Swan login persists

let backend = null;
let mainWindow = null;

/** @type {Map<string, import('electron').WebContentsView>} */
const tabs = new Map();
let activeTabId = null;
let tabSeq = 0;
let arenaVisible = false;
let lastBounds = { x: 0, y: 0, width: 0, height: 0 };

// ───────────────────────── backend sidecar ─────────────────────────
function backendExePath() {
  return path.join(__dirname, '..', 'backend', 'bin', 'Debug', 'net10.0', 'MrGoose.Backend.exe');
}
function startBackend() {
  backend = spawn(backendExePath(), ['--urls', BACKEND_URL], { stdio: 'inherit', windowsHide: true });
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
    try { const r = await fetch(`${BACKEND_URL}/health`); if (r.ok) return true; } catch { /* not up */ }
    await new Promise((res) => setTimeout(res, 400));
  }
  return false;
}

// ───────────────────────── arena tab manager ─────────────────────────
function activeView() { return activeTabId ? tabs.get(activeTabId) : null; }

function applyVisibility() {
  for (const [id, view] of tabs) {
    const show = arenaVisible && id === activeTabId;
    try { view.setVisible(show); } catch { /* older electron */ }
    if (show) view.setBounds(lastBounds);
  }
}

function createTab(url) {
  const id = `arena-${++tabSeq}`;
  const view = new WebContentsView({
    webPreferences: { partition: ARENA_PARTITION, contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.contentView.addChildView(view);
  view.setBounds(lastBounds);
  view.webContents.loadURL(url || 'https://app.grayswan.ai/');
  tabs.set(id, view);
  activeTabId = id;
  applyVisibility();
  return id;
}

function closeTab(id) {
  const view = tabs.get(id);
  if (!view) return;
  try { mainWindow.contentView.removeChildView(view); view.webContents.close?.(); } catch { /* ignore */ }
  tabs.delete(id);
  if (activeTabId === id) activeTabId = tabs.keys().next().value ?? null;
  applyVisibility();
}

function listTabs() {
  return [...tabs.entries()].map(([id, v]) => ({
    id, url: v.webContents.getURL(), title: v.webContents.getTitle(), active: id === activeTabId,
  }));
}

// run JS in the active arena view; selector/value are JSON-embedded so there is nothing to escape
async function runInActive(buildScript) {
  const view = activeView();
  if (!view) return { ok: false, note: 'no active arena tab' };
  try { return await view.webContents.executeJavaScript(buildScript(), true); }
  catch (e) { return { ok: false, note: String(e?.message || e) }; }
}

function registerBridge() {
  // tab management
  ipcMain.handle('mrgoose:tabs:create', (_e, { url }) => createTab(url));
  ipcMain.handle('mrgoose:tabs:select', (_e, { tabId }) => { if (tabs.has(tabId)) { activeTabId = tabId; applyVisibility(); } return listTabs(); });
  ipcMain.handle('mrgoose:tabs:close', (_e, { tabId }) => { closeTab(tabId); return listTabs(); });
  ipcMain.handle('mrgoose:tabs:list', () => listTabs());
  ipcMain.handle('mrgoose:tabs:loadUrl', (_e, { tabId, url }) => { tabs.get(tabId)?.webContents.loadURL(url); return true; });
  ipcMain.handle('mrgoose:tabs:setBounds', (_e, b) => {
    lastBounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    if (arenaVisible) activeView()?.setBounds(lastBounds);
    return true;
  });
  ipcMain.handle('mrgoose:tabs:setVisible', (_e, { visible }) => { arenaVisible = !!visible; applyVisibility(); return true; });

  // FILL + READ bridge — deliberately no send/launch/submit
  ipcMain.handle('mrgoose:fillField', (_e, { selector, value }) => runInActive(() => `
    (() => {
      const sel = ${JSON.stringify(selector)}, val = ${JSON.stringify(value)};
      const el = document.querySelector(sel);
      if (!el) return { ok: false, note: 'selector not found' };
      if (el.isContentEditable) {
        el.focus(); el.textContent = val;
        el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
        const d = Object.getOwnPropertyDescriptor(proto.prototype, 'value');
        d.set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true };
    })()`));

  ipcMain.handle('mrgoose:readDom', (_e, { selector }) => runInActive(() => `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, note: 'selector not found' };
      return { ok: true, text: (el.value ?? el.innerText ?? '').slice(0, 20000) };
    })()`));

  ipcMain.handle('mrgoose:snapshotConversation', (_e, { selector }) => runInActive(() => `
    (() => {
      const root = ${JSON.stringify(selector || 'body')};
      const el = document.querySelector(root) || document.body;
      return { ok: true, text: (el.innerText || '').slice(0, 40000) };
    })()`));

  ipcMain.handle('mrgoose:highlightSendButton', (_e, { selector }) => runInActive(() => `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, note: 'selector not found' };
      el.scrollIntoView({ block: 'center' });
      const prev = el.style.outline;
      el.style.outline = '3px solid #b6f23d';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = prev; }, 2500);
      return { ok: true };
    })()`));

  // pick-element: resolve the next click's robust selector (for building SelectorProfiles)
  ipcMain.handle('mrgoose:pickElement', () => runInActive(() => `
    new Promise((resolve) => {
      const sel = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        while (el && el.nodeType === 1 && el.tagName !== 'HTML') {
          let p = el.tagName.toLowerCase();
          if (el.name) { p += '[name=' + JSON.stringify(el.getAttribute('name')) + ']'; parts.unshift(p); break; }
          const sibs = [...el.parentNode.children].filter(c => c.tagName === el.tagName);
          if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
          parts.unshift(p);
          el = el.parentElement;
        }
        return parts.join(' > ');
      };
      const onClick = (e) => {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('click', onClick, true);
        resolve({ ok: true, selector: sel(e.target), text: (e.target.innerText || e.target.value || '').slice(0, 80) });
      };
      document.addEventListener('click', onClick, true);
    })`));
}

// ───────────────────────── window ─────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480, height: 940, backgroundColor: '#0a0a0b', title: 'Mr Goose', autoHideMenuBar: true,
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await mainWindow.loadURL(RENDERER_URL);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.mrgoose.cockpit');   // proper taskbar icon grouping
  registerBridge();
  startBackend();
  const healthy = await waitForHealth();
  if (!healthy) console.error('[mrgoose] backend /health never came up at', BACKEND_URL);
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { stopBackend(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', stopBackend);
process.on('exit', stopBackend);
