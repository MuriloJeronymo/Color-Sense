const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  // displayId identifica QUAL monitor este overlay cobre — sem ele, todos
  // capturavam o mesmo monitor.
  getSource: (displayId) => ipcRenderer.invoke('overlay:get-source', displayId),
  onDisplay: (cb) => ipcRenderer.on('overlay-display', (_, info) => cb(info)),
  onRules:   (cb) => ipcRenderer.on('overlay-rules', (_, rules) => cb(rules)),
  onClear:   (cb) => ipcRenderer.on('overlay-clear', () => cb()),
  onStatus:  (cb) => ipcRenderer.on('overlay-status', (_, status) => cb(status))
});
