const { contextBridge, ipcRenderer } = require('electron');

// This local intro gets only startup controls, never the cockpit's arena bridge.
contextBridge.exposeInMainWorld('gooseStartup', {
  onPhase(callback) {
    const listener = (_event, phase) => callback(phase);
    ipcRenderer.on('mrgoose:startup:phase', listener);
    return () => ipcRenderer.removeListener('mrgoose:startup:phase', listener);
  },
  close: () => ipcRenderer.send('mrgoose:startup:close'),
  retry: () => ipcRenderer.send('mrgoose:startup:retry'),
});
