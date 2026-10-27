const path = require('node:path');

// Lightweight native host. It owns its bounds; Angular never positions these views.
function createArenaWindow({ BrowserWindow, ipcMain, browser, isQuitting, openCockpit, directory = __dirname }) {
  let window = null;
  const handles = [];
  const sync = () => {
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    browser.setBounds({ x: 0, y: 52, width, height: Math.max(0, height - 52) });
    browser.setVisible(true);
  };
  function update(tabs) {
    if (window && !window.isDestroyed()) window.webContents.send('mrgoose:arena-window:tabs', tabs);
  }
  function show(tabId) {
    if (!window || window.isDestroyed()) throw new Error('ARENA_WINDOW_UNAVAILABLE');
    if (tabId) browser.select(tabId);
    sync(); update(browser.list());
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  function handle(name, action) {
    const channel = 'mrgoose:arena-window:' + name;
    ipcMain.handle(channel, (event, args = {}) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('UNAUTHORIZED_IPC');
      return action(args);
    });
    handles.push(channel);
  }
  return {
    get window() { return window; },
    update, show,
    hide() { window?.hide(); },
    async create() {
      window = new BrowserWindow({ width: 1280, height: 900, minWidth: 640, minHeight: 480, show: false,
        title: 'MrGoose Arena', backgroundColor: '#111315', autoHideMenuBar: true,
        icon: path.join(directory, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        webPreferences: { preload: path.join(directory, 'arena-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.on('resize', sync);
      window.on('close', event => { if (!isQuitting()) { event.preventDefault(); window.hide(); } });
      window.on('closed', () => { for (const channel of handles) ipcMain.removeHandler(channel); window = null; });
      handle('list', () => browser.list());
      handle('select', ({ tabId }) => { browser.select(tabId); sync(); return browser.list(); });
      handle('close', ({ tabId }) => browser.close(tabId));
      handle('create', async () => { const id = await browser.create('https://app.grayswan.ai/arena/challenge/ipi-black-2026'); show(id); return browser.list(); });
      handle('hide', () => window.hide());
      handle('cockpit', () => openCockpit());
      await window.loadFile(path.join(directory, 'arena-window.html'));
      sync(); update(browser.list());
      return window;
    },
  };
}
module.exports = { createArenaWindow };
