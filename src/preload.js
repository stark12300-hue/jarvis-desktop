const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  openApp: (name) => ipcRenderer.invoke('open-app', name),
  openUrl: (url) => ipcRenderer.invoke('open-url', url)
});
