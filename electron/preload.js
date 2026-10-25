const { contextBridge, ipcRenderer } = require('electron');

// Mr Goose page-bridge — the ONLY surface the cockpit has onto an embedded arena page.
//
// HARD RAIL (Gray Swan Rule of Engagement + user decision): FILL + READ ONLY.
// There is deliberately NO send / launch / submit here, and there never will be.
// Every send/launch/submit on an arena page stays a human click. Do not add one.
contextBridge.exposeInMainWorld('mrgoose', {
  backendUrl: process.env.MRGOOSE_BACKEND_URL || 'http://127.0.0.1:5174',

  // embedded arena tabs (native WebContentsView, managed in main)
  tabs: {
    create: (url) => ipcRenderer.invoke('mrgoose:tabs:create', { url }),
    select: (tabId) => ipcRenderer.invoke('mrgoose:tabs:select', { tabId }),
    close: (tabId) => ipcRenderer.invoke('mrgoose:tabs:close', { tabId }),
    list: () => ipcRenderer.invoke('mrgoose:tabs:list'),
    loadUrl: (tabId, url) => ipcRenderer.invoke('mrgoose:tabs:loadUrl', { tabId, url }),
    setBounds: (rect) => ipcRenderer.invoke('mrgoose:tabs:setBounds', rect),
    setVisible: (visible) => ipcRenderer.invoke('mrgoose:tabs:setVisible', { visible }),
  },

  // fill + read on the active arena tab
  bridge: {
    fillField: (selector, value) => ipcRenderer.invoke('mrgoose:fillField', { selector, value }),
    readDom: (selector) => ipcRenderer.invoke('mrgoose:readDom', { selector }),
    snapshotConversation: (selector) => ipcRenderer.invoke('mrgoose:snapshotConversation', { selector }),
    highlightSendButton: (selector) => ipcRenderer.invoke('mrgoose:highlightSendButton', { selector }),
    pickElement: () => ipcRenderer.invoke('mrgoose:pickElement'),
    // NO sendMessage / launch / submit — by design.
  },
});
