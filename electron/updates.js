const fs = require('node:fs');
const path = require('node:path');

function createUpdater({ app, beforeInstall, getWindow, engine }) {
  let state = { state: 'unavailable', message: 'Updates are available in release builds.' };
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return { status: () => state, check: async () => state, download: async () => state, install: async () => false };
  }
  const updater = engine || require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  state = { state: 'idle', message: '' };
  updater.on('update-available', info => { state = { state: 'available', version: info.version, message: '' }; });
  updater.on('update-not-available', () => { state = { state: 'current', message: 'You are up to date.' }; });
  updater.on('download-progress', info => { state = { ...state, state: 'downloading', percent: Math.round(info.percent) }; });
  updater.on('update-downloaded', info => { state = { state: 'ready', version: info.version, message: 'Ready to restart.' }; });
  // Do not expose provider URLs, credentials or raw network errors in the renderer.
  updater.on('error', () => { state = { state: 'error', message: 'Could not fetch the release. Try again later.' }; });
  return {
    status: () => state,
    async check() {
      if (['checking', 'downloading', 'ready'].includes(state.state)) return state;
      state = { state: 'checking', message: '' };
      try { await updater.checkForUpdates(); } catch { state = { state: 'error', message: 'No accessible release feed. Try again after a release is published.' }; }
      return state;
    },
    async download() {
      if (state.state !== 'available') return state;
      state = { ...state, state: 'downloading', percent: 0 };
      try { await updater.downloadUpdate(); } catch { state = { state: 'error', message: 'Download failed. Check for updates to retry.' }; }
      return state;
    },
    async install() {
      if (state.state !== 'ready') return false;
      const { dialog } = require('electron');
      const answer = await dialog.showMessageBox(getWindow(), { type: 'question', buttons: ['Later', 'Restart and update'], defaultId: 0, cancelId: 0,
        title: 'Update MrGoose', message: 'Restart to install the update?', detail: 'Active model requests and browser tabs will close. Saved libraries and conversations stay in your data directory.' });
      if (answer.response !== 1) return false;
      await beforeInstall(); updater.quitAndInstall(false, true); return true;
    },
  };
}
module.exports = { createUpdater };
