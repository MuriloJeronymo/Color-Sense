const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  getSource: ()   => ipcRenderer.invoke('overlay:get-source'),
  onRules:   (cb) => ipcRenderer.on('overlay-rules', (_, rules) => cb(rules)),
  onClear:   (cb) => ipcRenderer.on('overlay-clear', () => cb()),
  onStatus:  (cb) => ipcRenderer.on('overlay-status', (_, status) => cb(status))
});
