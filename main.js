// Carrega .env manualmente — dotenv v17+ quebra o require do Electron
const fs = require('fs');
// No executável o .env vai para a pasta resources (extraResources no package.json)
const envFile = [
  require('path').join(__dirname, '.env'),
  process.resourcesPath && require('path').join(process.resourcesPath, '.env')
].find(f => f && fs.existsSync(f));
if (envFile) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx > 0) process.env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
}

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { getPreferences, savePreferences } = require('./src/store/preferences');
const { SIMULATION_MATRICES, getCorrectionMatrix } = require('./src/algorithms/colorFilters');
const { analyzeColorPair } = require('./src/algorithms/colorChecker');
const { colorName } = require('./src/algorithms/colorNames');
const { trayIcon } = require('./src/tray/trayIcons');
const { signUp, signIn, signOut, getSession, getUser } = require('./src/store/auth');
const { getScenes, createScene, updateScene, deleteScene, addPatternRule, updatePatternRule, deletePatternRule } = require('./src/store/sceneStore');

let mainWindow    = null;
let tray          = null;
let colorDaemon   = null;
let daemonReady   = false;
let pendingCommand = null;
let appQuitting   = false;
let overlayWindow = null;
let cachedRules   = [];

// Modo Criador — simulação de daltonismo para designers/devs.
// Em memória (ferramenta transitória, não persiste entre sessões).
let simulationActive = false;
let simulationType   = 'protanopia';

// Calibração guiada do filtro (M2): enquanto não for nulo, a tela mostra a
// prévia { type, intensity } em vez das preferências salvas.
let calibrating = null;

// Atalhos globais (M5). "ok" fica falso se outro programa já usa a combinação.
const SHORTCUTS = [
  { id: 'filter',   accelerator: 'CommandOrControl+Alt+F', label: 'Ctrl+Alt+F', description: 'Liga/desliga o filtro', ok: false },
  { id: 'patterns', accelerator: 'CommandOrControl+Alt+P', label: 'Ctrl+Alt+P', description: 'Liga/desliga os padrões das cenas', ok: false },
  { id: 'sim',      accelerator: 'CommandOrControl+Alt+S', label: 'Ctrl+Alt+S', description: 'Liga/desliga a simulação', ok: false }
];

app.setAppUserModelId('com.colorsense.app');

// Instância única — se o app já está aberto, foca a janela existente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

let authWindow = null;

function createAuthWindow() {
  authWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    title: 'ColorSense — Entrar',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  authWindow.loadFile(path.join(__dirname, 'src', 'auth', 'auth.html'));
  authWindow.setMenuBarVisibility(false);

  // Após login bem-sucedido, abre o painel principal
  ipcMain.once('auth:success', () => {
    authWindow.close();
    authWindow = null;
    createMainWindow();
    applyCurrentFilter();
    refreshActiveRules();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    resizable: false,
    show: false,
    title: 'ColorSense',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!appQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Overlay Window ────────────────────────────────────────────────────────────

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x: 0, y: 0, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src', 'ui', 'overlay-preload.js')
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  // Proteção de captura desligada: o filtro aparece em prints e compartilhamento de tela.
  overlayWindow.setContentProtection(false);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'src', 'ui', 'overlay.html'));

  // Garante que o overlay receba as regras e o indicador mesmo após reload/startup
  overlayWindow.webContents.on('did-finish-load', () => {
    syncOverlay();
    sendIndicator(getStatus());
  });
}

// Recarrega do Supabase as regras da cena ativa e empurra para o overlay
async function refreshActiveRules() {
  const prefs = getPreferences();

  if (!prefs.activeSceneId) {
    cachedRules = [];
  } else {
    try {
      const { supabase } = require('./src/store/supabase');
      const { data } = await supabase
        .from('pattern_rules')
        .select('*')
        .eq('scene_id', prefs.activeSceneId);
      cachedRules = data || [];
    } catch (err) {
      console.error('[Overlay] erro ao carregar regras:', err.message);
      cachedRules = [];
    }
  }

  syncOverlay();
  notifyStateChanged();
}

// Padrões visuais seguem o toggle universal: só aparecem com o filtro ativo.
// Durante a simulação (modo Criador) ficam ocultos para não poluir a tela.
// O atalho de padrões (M5) permite desligá-los sem desligar o filtro.
function patternsShown() {
  const prefs = getPreferences();
  return !simulationActive && prefs.filterActive && prefs.patternsActive && cachedRules.length > 0;
}

function syncOverlay() {
  if (!overlayWindow) return;
  if (patternsShown()) {
    overlayWindow.webContents.send('overlay-rules', cachedRules);
  } else {
    overlayWindow.webContents.send('overlay-clear');
  }
}

// O overlay captura a tela via getUserMedia (stream contínuo, acelerado por GPU).
// Aqui só fornecemos o id da fonte de captura.
ipcMain.handle('overlay:get-source', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources.length ? sources[0].id : null;
});

// ── Color Daemon (Windows Magnification API) ─────────────────────────────────

function startColorDaemon() {
  if (colorDaemon) return;

  // No executável o script fica fora do .asar (asarUnpack), pois o PowerShell não lê dentro dele
  const scriptPath = path.join(__dirname, 'src', 'native', 'colorDaemon.ps1')
    .replace('app.asar', 'app.asar.unpacked');

  colorDaemon = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-File', scriptPath
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let buf = '';

  colorDaemon.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();

    lines.forEach(line => {
      line = line.trim();
      if (line === 'READY') {
        daemonReady = true;
        if (pendingCommand) {
          _sendToDaemon(pendingCommand);
          pendingCommand = null;
        }
      } else if (line.startsWith('ERROR:')) {
        console.error('[ColorDaemon]', line);
      }
    });
  });

  colorDaemon.stderr.on('data', (d) => console.error('[ColorDaemon stderr]', d.toString()));

  colorDaemon.on('exit', (code) => {
    colorDaemon = null;
    daemonReady = false;
    if (!appQuitting && code !== 0) {
      console.error('[ColorDaemon] exited unexpectedly with code', code);
    }
  });
}

function _sendToDaemon(command) {
  try {
    colorDaemon.stdin.write(JSON.stringify(command) + '\n');
  } catch (err) {
    console.error('[ColorDaemon] write error:', err);
  }
}

function sendToDaemon(command) {
  if (!colorDaemon) {
    startColorDaemon();
    pendingCommand = command;
    return;
  }
  if (!daemonReady) {
    pendingCommand = command;
    return;
  }
  _sendToDaemon(command);
}

function stopColorDaemon() {
  if (!colorDaemon) return;
  try {
    _sendToDaemon({ action: 'exit' });
    setTimeout(() => { if (colorDaemon) colorDaemon.kill(); }, 1000);
  } catch (_) {
    colorDaemon.kill();
  }
}

// ── Filter Logic ─────────────────────────────────────────────────────────────

function applyCurrentFilter() {
  // A simulação (modo Criador) tem prioridade sobre o filtro de correção:
  // o designer quer ver a tela exatamente como um daltônico veria.
  if (simulationActive) {
    const sim = SIMULATION_MATRICES[simulationType];
    sendToDaemon(sim ? { action: 'apply', matrix: sim.matrix } : { action: 'clear' });
    return;
  }

  // Durante a calibração, a prévia substitui as preferências salvas
  if (calibrating) {
    sendToDaemon({ action: 'apply', matrix: getCorrectionMatrix(calibrating.type, calibrating.intensity) });
    return;
  }

  const prefs = getPreferences();

  if (!prefs.filterActive || prefs.filterType === 'normal') {
    sendToDaemon({ action: 'clear' });
  } else {
    sendToDaemon({ action: 'apply', matrix: getCorrectionMatrix(prefs.filterType, prefs.intensity ?? 1) });
  }
}

// ── Estado visível (M4) ──────────────────────────────────────────────────────
// Uma única descrição do estado alimenta o painel, a bandeja e o indicador na
// tela. Cada modo tem ícone e texto próprios, sem depender só da cor.

function typeLabel(type) {
  return SIMULATION_MATRICES[type]?.label || type;
}

function getStatus() {
  const prefs = getPreferences();

  if (simulationActive) {
    return { mode: 'sim', icon: '◎', text: `Simulando: ${typeLabel(simulationType)}` };
  }
  if (calibrating) {
    const pct = Math.round(calibrating.intensity * 100);
    return { mode: 'filter', icon: '◐', text: `Calibrando: ${typeLabel(calibrating.type)} (${pct}%)` };
  }
  if (!prefs.filterActive) {
    return { mode: 'off', icon: '○', text: 'Desligado' };
  }

  const parts = [];
  if (prefs.filterType !== 'normal') parts.push(`Filtro ligado: ${typeLabel(prefs.filterType)}`);
  if (patternsShown()) parts.push('Padrões ligados');
  if (!parts.length) parts.push('Filtro ligado: sem correção de cor');
  return { mode: 'filter', icon: '◐', text: parts.join(' · ') };
}

function sendIndicator(status) {
  if (!overlayWindow) return;
  const { bounds, workArea } = screen.getPrimaryDisplay();
  overlayWindow.webContents.send('overlay-status', {
    visible: getPreferences().showIndicator,
    icon: status.icon,
    text: status.text,
    // mantém o indicador acima da barra de tarefas
    bottom: (bounds.y + bounds.height) - (workArea.y + workArea.height)
  });
}

function notifyStateChanged() {
  const status = getStatus();

  if (tray) {
    tray.setImage(trayIcon(status.mode));
    tray.setToolTip(`ColorSense — ${status.text}`);
    tray.setContextMenu(buildTrayMenu());
  }

  sendIndicator(status);

  if (mainWindow) {
    mainWindow.webContents.send('state-changed', {
      prefs: getPreferences(),
      sim: { active: simulationActive, type: simulationType },
      status
    });
  }
}

// Reaplica tudo depois de qualquer mudança de estado
function refreshAll() {
  applyCurrentFilter();
  syncOverlay();
  notifyStateChanged();
}

// ── Acesso rápido (M5) ───────────────────────────────────────────────────────

function toggleFilter() {
  savePreferences({ filterActive: !getPreferences().filterActive });
  refreshAll();
}

function togglePatterns() {
  savePreferences({ patternsActive: !getPreferences().patternsActive });
  refreshAll();
}

function toggleSimulation() {
  simulationActive = !simulationActive;
  refreshAll();
}

const SHORTCUT_ACTIONS = { filter: toggleFilter, patterns: togglePatterns, sim: toggleSimulation };

function registerShortcuts() {
  SHORTCUTS.forEach(s => {
    s.ok = globalShortcut.register(s.accelerator, SHORTCUT_ACTIONS[s.id]);
    if (!s.ok) console.error('[Atalhos] combinação indisponível:', s.label);
  });
}

function showPanel() {
  const win = mainWindow || authWindow;
  if (win) { win.show(); win.focus(); }
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
  const prefs = getPreferences();
  const shortcut = (id) => SHORTCUTS.find(s => s.id === id && s.ok)?.label;
  const withShortcut = (label, id) => shortcut(id) ? `${label}\t${shortcut(id)}` : label;

  return Menu.buildFromTemplate([
    { label: `ColorSense — ${getStatus().text}`, enabled: false },
    { type: 'separator' },
    { label: 'Abrir Painel', click: showPanel },
    {
      label: withShortcut('Filtro Ativo', 'filter'),
      type: 'checkbox',
      checked: prefs.filterActive,
      click: toggleFilter
    },
    {
      label: withShortcut('Padrões das Cenas', 'patterns'),
      type: 'checkbox',
      checked: prefs.patternsActive,
      click: togglePatterns
    },
    {
      label: withShortcut('Simulação (modo Criador)', 'sim'),
      type: 'checkbox',
      checked: simulationActive,
      click: toggleSimulation
    },
    { type: 'separator' },
    {
      label: 'Tipo de Daltonismo',
      submenu: Object.keys(SIMULATION_MATRICES)
        .filter(type => type !== 'achromatomaly')
        .map(type => ({
          label: typeLabel(type),
          type: 'radio',
          checked: prefs.filterType === type,
          click: () => {
            savePreferences({ filterType: type });
            refreshAll();
          }
        }))
    },
    {
      label: 'Mostrar indicador na tela',
      type: 'checkbox',
      checked: prefs.showIndicator,
      click: (item) => {
        savePreferences({ showIndicator: item.checked });
        notifyStateChanged();
      }
    },
    { type: 'separator' },
    { label: 'Sair', click: () => { appQuitting = true; app.quit(); } }
  ]);
}

function createTray() {
  tray = new Tray(trayIcon('off'));
  // Clique simples liga/desliga o filtro (M5); o menu fica no botão direito
  tray.on('click', toggleFilter);
  notifyStateChanged();
}

// ── Conta-gotas (M1 e M3) ────────────────────────────────────────────────────
// Captura a tela (sem o painel e sem os padrões), mostra a captura em uma
// janela de tela cheia e devolve a cor do pixel clicado. A captura de tela
// não inclui o efeito da Magnification API, então a cor devolvida é a cor
// original — a mesma que o overlay analisa nas regras de cena.

let pickerWindow  = null;
let pickerResolve = null;

function finishPick(hex) {
  const resolve = pickerResolve;
  pickerResolve = null;
  if (resolve) resolve(hex);
  if (pickerWindow) pickerWindow.close();
}

async function pickScreenColor() {
  if (pickerWindow) return null;

  const display   = screen.getPrimaryDisplay();
  const panelOpen = mainWindow?.isVisible();

  // Esconde o painel, os padrões e o indicador para não aparecerem na captura
  mainWindow?.hide();
  overlayWindow?.webContents.send('overlay-clear');
  overlayWindow?.webContents.send('overlay-status', { visible: false });
  await new Promise(r => setTimeout(r, 250));

  let image = null;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width:  Math.round(display.size.width  * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor)
      }
    });
    const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
    image = source?.thumbnail;
  } catch (err) {
    console.error('[Conta-gotas] erro na captura:', err);
  }

  let hex = null;
  if (image && !image.isEmpty()) {
    const { width, height } = image.getSize();
    const bitmap = image.toBitmap();

    hex = await new Promise(resolve => {
      pickerResolve = resolve;
      pickerWindow = new BrowserWindow({
        ...display.bounds,
        // tela cheia: sem isso o Windows limita a janela à área de trabalho
        fullscreen: true,
        frame: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'src', 'picker', 'picker-preload.js')
        }
      });
      pickerWindow.setAlwaysOnTop(true, 'screen-saver');
      pickerWindow.loadFile(path.join(__dirname, 'src', 'picker', 'picker.html'));
      pickerWindow.webContents.once('did-finish-load', () => {
        pickerWindow.webContents.send('picker:image', { width, height, data: bitmap });
      });
      pickerWindow.on('closed', () => {
        pickerWindow = null;
        finishPick(null);
      });
    });
  }

  syncOverlay();
  notifyStateChanged();
  if (panelOpen) { mainWindow.show(); mainWindow.focus(); }

  return hex ? { hex, name: colorName(hex) } : null;
}

// A janela do conta-gotas só é exibida depois de desenhar a captura (sem piscar)
ipcMain.on('picker:ready', () => {
  if (!pickerWindow) return;
  pickerWindow.show();
  pickerWindow.focus();
});

ipcMain.on('picker:result', (_, hex) => {
  finishPick(/^#[0-9a-f]{6}$/i.test(hex || '') ? hex.toLowerCase() : null);
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-preferences', () => getPreferences());

ipcMain.handle('save-preferences', (_, prefs) => {
  savePreferences(prefs);
  refreshAll();
  return getPreferences();
});

ipcMain.handle('toggle-overlay', (_, enabled) => {
  savePreferences({ filterActive: enabled });
  refreshAll();
  return getPreferences();
});

ipcMain.handle('set-filter-type', (_, type) => {
  savePreferences({ filterType: type });
  refreshAll();
  return getPreferences();
});

ipcMain.handle('state:get', () => ({
  status: getStatus(),
  shortcuts: SHORTCUTS.map(({ id, label, description, ok }) => ({ id, label, description, ok }))
}));

// ── IPC: Calibração do filtro (M2) ────────────────────────────────────────────

ipcMain.handle('calibration:preview', (_, type, intensity) => {
  // A calibração ajusta a correção; a simulação do modo Criador é desligada
  simulationActive = false;
  calibrating = { type, intensity: Math.max(0, Math.min(2, Number(intensity) || 0)) };
  refreshAll();
});

ipcMain.handle('calibration:end', (_, save) => {
  if (save && calibrating) {
    savePreferences({ filterType: calibrating.type, intensity: calibrating.intensity, filterActive: true });
  }
  calibrating = null;
  refreshAll();
  return getPreferences();
});

// ── IPC: Conta-gotas e verificador de cores (M1 e M3) ─────────────────────────

const isHex = (hex) => /^#[0-9a-f]{6}$/i.test(hex || '');

ipcMain.handle('color:pick', () => pickScreenColor());
ipcMain.handle('color:name', (_, hex) => isHex(hex) ? colorName(hex) : null);
ipcMain.handle('checker:analyze', (_, hex1, hex2) =>
  isHex(hex1) && isHex(hex2) ? analyzeColorPair(hex1, hex2) : null
);

// ── IPC: Criador (simulação de daltonismo) ────────────────────────────────────

ipcMain.handle('sim:get-state', () => ({ active: simulationActive, type: simulationType }));

ipcMain.handle('sim:toggle', (_, enabled) => {
  simulationActive = enabled;
  refreshAll();
  return { active: simulationActive, type: simulationType };
});

ipcMain.handle('sim:set-type', (_, type) => {
  simulationType = type;
  refreshAll();
  return { active: simulationActive, type: simulationType };
});

// ── IPC: Auth ────────────────────────────────────────────────────────────────

ipcMain.handle('auth:sign-up',     (_, data)        => signUp(data));
ipcMain.handle('auth:sign-in',     (_, data)        => signIn(data));
ipcMain.handle('auth:sign-out', async () => {
  await signOut();
  savePreferences({ activeSceneId: null, filterActive: false });
  cachedRules = [];
  simulationActive = false;
  calibrating = null;
  refreshAll();
  if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
  createAuthWindow();
});
ipcMain.handle('auth:get-session', ()               => getSession());
ipcMain.handle('auth:get-user',    ()               => getUser());

// ── IPC: Cenas ────────────────────────────────────────────────────────────────

ipcMain.handle('scenes:get-all', ()              => getScenes());
ipcMain.handle('scenes:create',  (_, data)       => createScene(data));
ipcMain.handle('scenes:update',  (_, id, fields) => updateScene(id, fields));
ipcMain.handle('scenes:delete',  (_, id)         => deleteScene(id));

ipcMain.handle('scenes:add-rule', async (_, sceneId, data) => {
  const rule = await addPatternRule(sceneId, data);
  // Se a regra pertence à cena ativa, aplica imediatamente
  if (getPreferences().activeSceneId === sceneId) await refreshActiveRules();
  return rule;
});

ipcMain.handle('scenes:update-rule', async (_, id, data) => {
  const rule = await updatePatternRule(id, data);
  await refreshActiveRules();
  return rule;
});

ipcMain.handle('scenes:delete-rule', async (_, id) => {
  await deletePatternRule(id);
  await refreshActiveRules();
});

ipcMain.handle('scenes:activate', (_, sceneId, filterType, rules) => {
  // Ativar uma cena liga o filtro automaticamente
  savePreferences({ activeSceneId: sceneId, filterType, filterActive: true });
  cachedRules = rules || [];
  refreshAll();
  return getPreferences();
});

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const session = await getSession();

  registerShortcuts();
  createTray();
  startColorDaemon();
  createOverlayWindow();

  if (session) {
    await refreshActiveRules();
    createMainWindow();
    applyCurrentFilter();
  } else {
    createAuthWindow();
  }
});

app.on('before-quit', () => {
  appQuitting = true;
  stopColorDaemon();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
