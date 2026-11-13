const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('colorSenseAPI', {
  // Preferências locais
  getPreferences:  ()       => ipcRenderer.invoke('get-preferences'),
  savePreferences: (prefs)  => ipcRenderer.invoke('save-preferences', prefs),
  toggleOverlay:   (enabled)=> ipcRenderer.invoke('toggle-overlay', enabled),
  setFilterType:   (type)   => ipcRenderer.invoke('set-filter-type', type),

  // Estado atual (M4) e atalhos (M5); o main avisa a cada mudança
  getState:       ()   => ipcRenderer.invoke('state:get'),
  onStateChanged: (cb) => ipcRenderer.on('state-changed', (_, data) => cb(data)),

  // Calibração do filtro (M2)
  previewCalibration: (type, intensity) => ipcRenderer.invoke('calibration:preview', type, intensity),
  endCalibration:     (save)            => ipcRenderer.invoke('calibration:end', save),

  // Conta-gotas e verificador de cores (M1 e M3)
  pickColor:    ()           => ipcRenderer.invoke('color:pick'),
  colorName:    (hex)        => ipcRenderer.invoke('color:name', hex),
  analyzeColors:(hex1, hex2) => ipcRenderer.invoke('checker:analyze', hex1, hex2),

  // Auth
  signUp:     (data)  => ipcRenderer.invoke('auth:sign-up', data),
  signIn:     (data)  => ipcRenderer.invoke('auth:sign-in', data),
  signOut:    ()      => ipcRenderer.invoke('auth:sign-out'),
  getSession: ()      => ipcRenderer.invoke('auth:get-session'),
  getUser:    ()      => ipcRenderer.invoke('auth:get-user'),

  // Cenas
  getScenes:        ()           => ipcRenderer.invoke('scenes:get-all'),
  createScene:      (data)       => ipcRenderer.invoke('scenes:create', data),
  updateScene:      (id, fields) => ipcRenderer.invoke('scenes:update', id, fields),
  deleteScene:      (id)         => ipcRenderer.invoke('scenes:delete', id),
  addPatternRule:   (sid, data)  => ipcRenderer.invoke('scenes:add-rule', sid, data),
  updatePatternRule:(id, data)   => ipcRenderer.invoke('scenes:update-rule', id, data),
  deletePatternRule:(id)         => ipcRenderer.invoke('scenes:delete-rule', id),
  activateScene:    (id, filterType, rules) => ipcRenderer.invoke('scenes:activate', id, filterType, rules),

  // Criador (simulação de daltonismo)
  getSimState:   ()        => ipcRenderer.invoke('sim:get-state'),
  toggleSim:     (enabled) => ipcRenderer.invoke('sim:toggle', enabled),
  setSimType:    (type)    => ipcRenderer.invoke('sim:set-type', type),

  // Renderer → main: login concluído
  notifyAuthSuccess: () => ipcRenderer.send('auth:success'),

  // Main → renderer
  onAuthChange: (cb) => ipcRenderer.on('auth:changed', (_, data) => cb(data))
});
