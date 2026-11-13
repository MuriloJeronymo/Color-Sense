const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
  onImage: (cb)  => ipcRenderer.on('picker:image', (_, image) => cb(image)),
  ready:   ()    => ipcRenderer.send('picker:ready'),
  done:    (hex) => ipcRenderer.send('picker:result', hex)
});
