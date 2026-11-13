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

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, desktopCapturer, shell, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { getPreferences, savePreferences } = require('./src/store/preferences');
const { SIMULATION_MATRICES, CORRECTION_MATRICES, getCorrectionMatrix } = require('./src/algorithms/colorFilters');
const { analyzeColorPair } = require('./src/algorithms/colorChecker');
const { colorName } = require('./src/algorithms/colorNames');
const { trayIcon } = require('./src/tray/trayIcons');
const { signUp, signIn, signOut, getSession, getUser } = require('./src/store/auth');
const { getScenes, createScene, updateScene, deleteScene, addPatternRule, updatePatternRule, deletePatternRule } = require('./src/store/sceneStore');
const atualizacao = require('./src/updater');

let mainWindow    = null;
let tray          = null;
let colorDaemon   = null;
let daemonReady   = false;
let pendingCommand = null;
let appQuitting   = false;
let overlayWindows = [];
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

// Vira true quando a abertura termina. Antes disso, abrir o programa de novo
// não cria janela: ou a abertura ainda vai criar a sua, ou está instalando uma
// atualização e o app vai fechar — criar outra aqui daria janela duplicada.
let aberturaConcluida = false;

app.setAppUserModelId('com.colorsense.app');

// Instância única — se o app já está aberto, foca a janela existente
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (aberturaConcluida) mostrarJanela(); });
}

// Traz o usuário de volta para alguma janela, sempre.
//
// Antes isto era `if (mainWindow) mainWindow.show()`. Bastava fechar a tela de
// login — ou fazer logout e fechar — para mainWindow ficar null e NADA mais
// abrir: nem clicar na bandeja, nem abrir o programa de novo. O app seguia
// rodando, invisível e inalcançável, e só o Gerenciador de Tarefas resolvia.
async function mostrarJanela() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show(); mainWindow.focus(); return;
  }
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.show(); authWindow.focus(); return;
  }

  // Nenhuma janela viva: a sessão decide qual abrir.
  let sessao = null;
  try { sessao = await getSession(); } catch (_) {}

  if (sessao) {
    createMainWindow();
    applyCurrentFilter();
    refreshActiveRules();
  } else {
    createAuthWindow();
  }
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

  authWindow.on('closed', () => { authWindow = null; });

  // removeAllListeners antes do once: createAuthWindow pode ser chamada de
  // novo (logout, ou reabrir depois de fechar) e os listeners empilhariam.
  ipcMain.removeAllListeners('auth:success');

  // Após login bem-sucedido, abre o painel principal
  ipcMain.once('auth:success', () => {
    if (authWindow && !authWindow.isDestroyed()) authWindow.close();
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

// Uma janela por monitor. O filtro de cor é global do Windows e cobre todos os
// monitores sozinho, mas os padrões visuais são desenhados por nós — com uma
// janela só, eles apareciam apenas no monitor primário.
function createOverlayWindows() {
  destroyOverlayWindows();

  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.bounds;

    const win = new BrowserWindow({
      x, y, width, height,
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

    win.setIgnoreMouseEvents(true, { forward: true });
    // Proteção de captura desligada: o filtro aparece em prints e compartilhamento de tela.
    win.setContentProtection(false);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(__dirname, 'src', 'ui', 'overlay.html'));

    win.webContents.on('did-finish-load', () => {
      // Cada overlay precisa capturar o SEU monitor, não o primeiro da lista.
      // As dimensões vão junto porque a janela é limitada à área de trabalho
      // (1920x1032 com a barra de tarefas), enquanto a captura de tela vem no
      // tamanho cheio do monitor (1920x1080). Dimensionar o canvas pela janela
      // desalinha o mapeamento de coordenadas da máscara.
      win.webContents.send('overlay-display', {
        id: String(display.id), width, height
      });
      // Regras e indicador de estado (M4) também após reload/startup
      syncOverlay();
      sendIndicator(getStatus());
    });

    overlayWindows.push({ win, displayId: String(display.id) });
  }
}

function destroyOverlayWindows() {
  for (const { win } of overlayWindows) {
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
  }
  overlayWindows = [];
}

// Plugar ou desplugar um monitor recria os overlays: sem isso, o monitor novo
// fica sem padrões e o removido deixa uma janela órfã.
function observarMonitores() {
  const recriar = () => {
    if (appQuitting) return;
    createOverlayWindows();
  };
  screen.on('display-added', recriar);
  screen.on('display-removed', recriar);
  screen.on('display-metrics-changed', recriar);
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
  if (!overlayWindows.length) return;
  const mostrar = patternsShown();

  for (const { win } of overlayWindows) {
    if (win.isDestroyed()) continue;
    win.webContents.send(mostrar ? 'overlay-rules' : 'overlay-clear', cachedRules);
  }
}

// Overlay do monitor principal: é nele que o indicador de estado aparece
function primaryOverlay() {
  const id = String(screen.getPrimaryDisplay().id);
  const o = overlayWindows.find(w => w.displayId === id && !w.win.isDestroyed()) || overlayWindows.find(w => !w.win.isDestroyed());
  return o ? o.win : null;
}

// O overlay captura a tela via getUserMedia (stream contínuo, acelerado por GPU).
// Aqui só fornecemos o id da fonte de captura.
ipcMain.handle('overlay:get-source', async (_evt, displayId) => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  if (!sources.length) return null;

  // Cada overlay tem que capturar o monitor onde ele está. Pegar sources[0]
  // fazia todos capturarem o mesmo monitor.
  const doMonitor = displayId && sources.find(s => String(s.display_id) === String(displayId));
  return (doMonitor || sources[0]).id;
});

// ── Color Daemon (Windows Magnification API) ─────────────────────────────────

function startColorDaemon() {
  if (colorDaemon || appQuitting) return;

  // No app empacotado o código vive dentro de app.asar, que é um FS virtual
  // visível só para o Electron. O powershell.exe é um processo externo e não
  // consegue abrir o script ali — por isso o asarUnpack no package.json joga
  // src/native/ para app.asar.unpacked, e o caminho é redirecionado aqui.
  const scriptPath = path
    .join(__dirname, 'src', 'native', 'colorDaemon.ps1')
    .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

  if (!fs.existsSync(scriptPath)) {
    console.error('[ColorDaemon] script não encontrado em', scriptPath);
    return;
  }

  // O -ParentPid liga o vigia do daemon: ele acompanha este processo e se
  // encerra junto. Sem isso, um encerramento anormal poderia deixar o filtro
  // preso na tela inteira, sem nenhuma janela para desligá-lo.
  colorDaemon = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-File', scriptPath,
    '-ParentPid', String(process.pid)
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  // Escrever num daemon que já morreu (travou, foi fechado ou o app está
  // saindo) falha com EPIPE de forma assíncrona, no próprio stream. Sem este
  // ouvinte o Node trata a falha como exceção não capturada: o Electron abre a
  // caixa "A JavaScript error occurred in the main process" e, durante a
  // saída, essa caixa ainda impede o processo de terminar.
  colorDaemon.stdin.on('error', (err) => {
    if (!['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'].includes(err.code)) {
      console.error('[ColorDaemon] stdin:', err);
    }
  });

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
  const d = colorDaemon;
  colorDaemon = null;
  daemonReady = false;
  // 'clear' devolve a tela ao normal, e o fim do stdin (EOF) faz o daemon sair
  // do laço, restaurar a tela de novo e encerrar sozinho. Sem kill() logo em
  // seguida: matar o processo com escritas ainda na fila gerava EPIPE na saída.
  // Se o daemon estiver travado, o vigia -ParentPid o derruba quando o app
  // terminar.
  try { d.stdin.end(JSON.stringify({ action: 'clear' }) + '\n'); } catch (_) {}
}

// ── Filter Logic ─────────────────────────────────────────────────────────────

// Intensidade do filtro: 0 = sem efeito, 1 = correção padrão, até 2 = reforçada
// (calibração, M2). Versões anteriores gravavam o valor em "opacity" (0 a 1).
function filterIntensity(prefs) {
  return prefs.intensity ?? prefs.opacity ?? 1;
}

function applyCurrentFilter() {
  // A simulação (modo Criador) tem prioridade sobre o filtro de correção:
  // o designer quer ver a tela exatamente como um daltônico veria. Ela roda
  // sempre em intensidade cheia — simular "pela metade" não corresponde a
  // nenhuma visão real.
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
    return;
  }

  const filter = CORRECTION_MATRICES[prefs.filterType];

  // Acromatopsia e acromatomalia não têm correção possível por matriz linear:
  // não sobra canal funcional para onde realocar a informação de cor perdida.
  // Limpar é honesto; aplicar a identidade fingindo que filtrou, não.
  if (!filter || !filter.temCorrecao) {
    sendToDaemon({ action: 'clear' });
    return;
  }

  sendToDaemon({ action: 'apply', matrix: getCorrectionMatrix(prefs.filterType, filterIntensity(prefs)) });
}

// O toggle universal precisa desligar TUDO que altera a tela. Sem isto, com a
// simulação do Criador ligada o badge dizia "Desativado" enquanto a tela
// continuava simulando daltonismo — o oposto do que o app se propõe a fazer.
function setFilterActive(enabled) {
  savePreferences({ filterActive: enabled });

  // (o painel recebe o novo estado da simulação pelo notifyStateChanged)
  if (!enabled) simulationActive = false;

  refreshAll();
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
  // acromatopsia e acromatomalia não têm correção: o selo não finge que há
  if (CORRECTION_MATRICES[prefs.filterType]?.temCorrecao) parts.push(`Filtro ligado: ${typeLabel(prefs.filterType)}`);
  if (patternsShown()) parts.push('Padrões ligados');
  if (!parts.length) parts.push('Filtro ligado: sem correção de cor');
  return { mode: 'filter', icon: '◐', text: parts.join(' · ') };
}

function sendIndicator(status) {
  const win = primaryOverlay();
  if (!win) return;
  const { bounds, workArea } = screen.getPrimaryDisplay();
  win.webContents.send('overlay-status', {
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
  setFilterActive(!getPreferences().filterActive);
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

// ── Tray ─────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
  const prefs = getPreferences();
  const shortcut = (id) => SHORTCUTS.find(s => s.id === id && s.ok)?.label;
  const withShortcut = (label, id) => shortcut(id) ? `${label}\t${shortcut(id)}` : label;

  return Menu.buildFromTemplate([
    { label: `ColorSense — ${getStatus().text}`, enabled: false },
    { type: 'separator' },
    // Sempre habilitado: mostrarJanela() decide o que abrir conforme a sessão,
    // e recria a janela se não houver nenhuma viva. Desabilitar este item
    // deixava o usuário sem nenhuma saída depois de fechar a tela de login.
    { label: 'Abrir Painel', click: () => { mostrarJanela(); } },
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
    ...itensDeAtualizacao(),
    { type: 'separator' },
    { label: 'Sair', click: () => { appQuitting = true; app.quit(); } }
  ]);
}

// Itens da bandeja que só aparecem quando há algo a fazer com uma atualização.
function itensDeAtualizacao() {
  const { tipo, versao } = atualizacao.estadoAtual();
  if (tipo === 'pronta') {
    return [{ type: 'separator' },
      { label: `Reiniciar e atualizar (versão ${versao})`, click: () => atualizacao.instalarAgora() }];
  }
  if (tipo === 'disponivel') {
    return [{ type: 'separator' },
      { label: `Baixar a versão ${versao}`, click: () => shell.openExternal(atualizacao.PAGINA_DE_DOWNLOAD) }];
  }
  if (tipo === 'baixando') {
    return [{ type: 'separator' }, { label: `Baixando a versão ${versao}...`, enabled: false }];
  }
  return [];
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
  for (const { win } of overlayWindows) {
    if (win.isDestroyed()) continue;
    win.webContents.send('overlay-clear');
    win.webContents.send('overlay-status', { visible: false });
  }
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

// Fonte única da verdade sobre quais tipos têm correção possível por matriz
// linear. A interface usa isto para não oferecer um filtro que não faz nada.
ipcMain.handle('filters:get-info', () => {
  const info = {};
  for (const [key, f] of Object.entries(CORRECTION_MATRICES)) {
    info[key] = { temCorrecao: f.temCorrecao };
  }
  return info;
});

ipcMain.handle('save-preferences', (_, prefs) => {
  savePreferences(prefs);
  refreshAll();
  return getPreferences();
});

ipcMain.handle('toggle-overlay', (_, enabled) => {
  setFilterActive(enabled);
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
  registerShortcuts();
  createTray();

  atualizacao.configurar({
    aoMudar: () => { if (tray) tray.setContextMenu(buildTrayMenu()); },
    avisar: (title, content) => { if (tray) tray.displayBalloon({ title, content, iconType: 'info' }); },
    // quitAndInstall fecha as janelas ANTES do before-quit. Sem isto, o 'close'
    // do painel cancela o fechamento (ele só esconde a janela), o app não sai
    // e a atualização não é instalada.
    antesDeInstalar: () => { appQuitting = true; }
  });

  let instalando = false;
  try {
    // Versão baixada numa sessão anterior: instala antes de abrir qualquer
    // janela, para o app não aparecer e sumir logo depois.
    instalando = await atualizacao.instalarPendenteNaAbertura();
    if (instalando) return;

    const session = await getSession();

    startColorDaemon();
    createOverlayWindows();
    observarMonitores();

    if (session) {
      await refreshActiveRules();
      createMainWindow();
      applyCurrentFilter();
    } else {
      createAuthWindow();
    }
  } finally {
    aberturaConcluida = true;
    // Mesmo se a abertura falhar: uma versão nova pode ser justamente a correção.
    if (!instalando) atualizacao.iniciarVerificacoes();
  }
});

app.on('before-quit', () => {
  appQuitting = true;
  stopColorDaemon();
  destroyOverlayWindows();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
