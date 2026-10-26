const path = require('node:path');

/** A local intro stays visible until both backend and cockpit are ready. */
function createStartupController({ app, BrowserWindow, ipcMain, directory, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let splash = null;
  let busy = false;
  let stopped = false;
  let completed = false;
  let boot;
  const isSplash = event => splash && event.sender === splash.webContents;
  const phase = value => {
    if (splash && !splash.isDestroyed()) splash.webContents.send('mrgoose:startup:phase', value);
  };
  const onClose = event => { if (isSplash(event)) { stopped = true; cleanup(); app.quit(); } };
  const onRetry = event => { if (isSplash(event)) void run(); };
  function cleanup() {
    ipcMain.removeListener('mrgoose:startup:close', onClose);
    ipcMain.removeListener('mrgoose:startup:retry', onRetry);
  }
  async function run() {
    if (busy || stopped || completed) return;
    busy = true;
    phase('starting');
    try {
      const cockpit = await boot(phase);
      if (!cockpit) throw new Error('Cockpit did not open');
      if (stopped) { if (!cockpit.isDestroyed()) cockpit.destroy(); return; }
      phase('ready');
      await wait(360);
      if (stopped || cockpit.isDestroyed()) return;
      // Show the cockpit first, so closing the intro cannot trigger window-all-closed.
      cockpit.show();
      completed = true;
      if (splash && !splash.isDestroyed()) splash.close();
      cleanup();
    } catch (error) {
      console.error('[mrgoose] startup failed:', error.message);
      if (!stopped) phase('error');
    } finally {
      busy = false;
    }
  }
  return {
    async open(start) {
      boot = start;
      splash = new BrowserWindow({
        width: 740, height: 540, show: false, frame: false,
        resizable: false, maximizable: false, fullscreenable: false,
        backgroundColor: '#0a0a0b', title: 'Mr Goose — starting up',
        icon: path.join(directory, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        webPreferences: {
          preload: path.join(directory, 'startup-preload.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      splash.on('closed', () => {
        splash = null;
        cleanup();
        if (!completed && !stopped) { stopped = true; app.quit(); }
      });
      ipcMain.on('mrgoose:startup:close', onClose);
      ipcMain.on('mrgoose:startup:retry', onRetry);
      try {
        await splash.loadFile(path.join(directory, 'startup.html'));
        if (stopped || !splash || splash.isDestroyed()) return;
        splash.show();
        await run();
      } catch (error) {
        console.error('[mrgoose] could not load startup screen:', error.message);
        stopped = true;
        cleanup();
        app.quit();
      }
    },
    cancel() { stopped = true; cleanup(); },
  };
}
module.exports = { createStartupController };
