const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('arenaWindow', {
  list: () => ipcRenderer.invoke('mrgoose:arena-window:list'),
  select: tabId => ipcRenderer.invoke('mrgoose:arena-window:select', { tabId }),
  close: tabId => ipcRenderer.invoke('mrgoose:arena-window:close', { tabId }),
  create: () => ipcRenderer.invoke('mrgoose:arena-window:create'),
  hide: () => ipcRenderer.invoke('mrgoose:arena-window:hide'),
  cockpit: () => ipcRenderer.invoke('mrgoose:arena-window:cockpit'),
  onTabs: callback => { const listener = (_event, tabs) => callback(tabs); ipcRenderer.on('mrgoose:arena-window:tabs', listener); return () => ipcRenderer.removeListener('mrgoose:arena-window:tabs', listener); },
});
