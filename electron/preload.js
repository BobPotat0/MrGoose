const { contextBridge, ipcRenderer } = require('electron');

// Mr Goose page-bridge — the ONLY surface the cockpit has onto an embedded arena page.
//
// HARD RAIL (Gray Swan Rule of Engagement + user decision): FILL + READ ONLY.
// There is deliberately NO send / launch / submit here, and there never will be.
// Every send/launch/submit on an arena page stays a human click. Do not add one.
contextBridge.exposeInMainWorld('mrgoose', {
  backendUrl: process.env.MRGOOSE_BACKEND_URL || 'http://127.0.0.1:5174',
  backendToken: process.argv.find(x => x.startsWith('--mrgoose-backend-token='))?.split('=')[1] || '',
  mcp: {
    status: () => ipcRenderer.invoke('mrgoose:mcp:status'),
    saveProfile: (profile) => ipcRenderer.invoke('mrgoose:mcp:profile', profile),
  },

  // embedded arena tabs (native WebContentsView, managed in main)
  tabs: {
    create: (url) => ipcRenderer.invoke('mrgoose:tabs:create', { url }),
    select: (tabId) => ipcRenderer.invoke('mrgoose:tabs:select', { tabId }),
    close: (tabId) => ipcRenderer.invoke('mrgoose:tabs:close', { tabId }),
    list: () => ipcRenderer.invoke('mrgoose:tabs:list'),
    show: () => ipcRenderer.invoke('mrgoose:tabs:show'),
    onChanged: (callback) => { const listener = (_event, tabs) => callback(tabs); ipcRenderer.on('mrgoose:tabs:changed', listener); return () => ipcRenderer.removeListener('mrgoose:tabs:changed', listener); },
    loadUrl: (tabId, url) => ipcRenderer.invoke('mrgoose:tabs:loadUrl', { tabId, url }),
    setBounds: (rect) => ipcRenderer.invoke('mrgoose:tabs:setBounds', rect),
    setVisible: (visible) => ipcRenderer.invoke('mrgoose:tabs:setVisible', { visible }),
  },

  // Explicit tab targeting. No default to the active tab in the main process.
  bridge: {
    fillField: (tabId, selector, value) => ipcRenderer.invoke('mrgoose:fillField', { tabId, selector, value }),
    readDom: (tabId, selector) => ipcRenderer.invoke('mrgoose:readDom', { tabId, selector }),
    snapshotConversation: (tabId, selector) => ipcRenderer.invoke('mrgoose:snapshotConversation', { tabId, selector }),
    highlightSendButton: (tabId, selector) => ipcRenderer.invoke('mrgoose:highlightSendButton', { tabId, selector }),
    pickElement: (tabId) => ipcRenderer.invoke('mrgoose:pickElement', { tabId }),
    // NO sendMessage / launch / submit — by design.
  },
});
