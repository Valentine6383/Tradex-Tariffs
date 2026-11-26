const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('k2', {
  cmd: (c) => ipcRenderer.invoke('cmd', c),
  onUpdate: (fn) => ipcRenderer.on('update', (_e, d) => fn(d)),
  onOpenSettings: (fn) => ipcRenderer.on('open-settings', () => fn()),
  onScanProgress: (fn) => ipcRenderer.on('scan-progress', (_e, p) => fn(p)),
});
