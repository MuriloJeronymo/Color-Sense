// ColorSense — overlay de padrões visuais (RF06)
// Captura a tela como stream de vídeo (GPU), analisa pixels a ~2fps e
// desenha padrões somente onde a cor da regra é detectada (máscara por pixel).

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const ANALYZE_MS = 500;  // intervalo entre análises
const CAP_W      = 960;  // resolução de análise
const CAP_H      = 540;

let rules     = [];
let video     = null;
let loopTimer = null;

// Dimensões do MONITOR, não da janela: a janela é limitada à área de trabalho
// e fica menor que a tela, mas a captura vem no tamanho cheio. Começam com um
// palpite e o processo principal corrige em onDisplay, antes de qualquer
// captura começar.
let screenW = window.screen.width;
let screenH = window.screen.height;

// Preenchido pelo processo principal; identifica o monitor a capturar.
let displayId = null;
canvas.width  = screenW;
canvas.height = screenH;

// Canvases reutilizados
const capCanvas  = new OffscreenCanvas(CAP_W, CAP_H);
const capCtx     = capCanvas.getContext('2d', { willReadFrequently: true });
let   maskCanvas = null;   // máscara na resolução de captura
let   maskCtx    = null;
let workCanvas = new OffscreenCanvas(screenW, screenH);
let workCtx    = workCanvas.getContext('2d');

// Redimensiona tudo quando o processo principal informa o monitor de verdade.
function ajustarDimensoes(w, h) {
  if (w === screenW && h === screenH && canvas.width === w) return;
  screenW = w; screenH = h;
  canvas.width = w; canvas.height = h;
  workCanvas = new OffscreenCanvas(w, h);
  workCtx = workCanvas.getContext('2d');
}

// ── Tiles de padrão ───────────────────────────────────────────────────────────
// Cada padrão vira um tile pequeno repetido via createPattern — muito mais
// rápido que desenhar milhares de linhas por frame.

const tileCache = {};

function getPatternTile(type) {
  if (tileCache[type]) return tileCache[type];

  const S = 12;
  const t = new OffscreenCanvas(S, S);
  const c = t.getContext('2d');
  c.strokeStyle = '#000';
  c.fillStyle   = '#000';
  c.lineWidth   = 2;
  c.lineCap     = 'square';

  if (type === 'horizontal') {
    c.beginPath(); c.moveTo(0, S / 2); c.lineTo(S, S / 2); c.stroke();

  } else if (type === 'vertical') {
    c.beginPath(); c.moveTo(S / 2, 0); c.lineTo(S / 2, S); c.stroke();

  } else if (type === 'diagonal') {
    c.beginPath();
    c.moveTo(-S / 2, S * 1.5); c.lineTo(S * 1.5, -S / 2);
    c.moveTo(-S / 2, S / 2);   c.lineTo(S / 2, -S / 2);
    c.moveTo(S / 2, S * 1.5);  c.lineTo(S * 1.5, S / 2);
    c.stroke();

  } else if (type === 'crosshatch') {
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(S, S);
    c.moveTo(S, 0); c.lineTo(0, S);
    c.stroke();

  } else if (type === 'zigzag') {
    c.beginPath();
    c.moveTo(0, S * 0.75);
    c.lineTo(S * 0.25, S * 0.25);
    c.lineTo(S * 0.5,  S * 0.75);
    c.lineTo(S * 0.75, S * 0.25);
    c.lineTo(S,        S * 0.75);
    c.stroke();

  } else if (type === 'dots') {
    c.beginPath(); c.arc(S * 0.25, S * 0.25, 1.8, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(S * 0.75, S * 0.75, 1.8, 0, Math.PI * 2); c.fill();
  }

  const pattern = ctx.createPattern(t, 'repeat');
  tileCache[type] = pattern;
  return pattern;
}

// ── Análise de pixels ─────────────────────────────────────────────────────────
// Uma única passada calcula o matiz de cada pixel e preenche a máscara de
// cada regra (alpha 255 onde a cor bate).

// Os buffers de máscara são reaproveitados entre quadros. Alocar
// nPixels x nRegras a cada 500 ms gerava cerca de 2 MB por regra por quadro, e
// a pressão de GC num processo que fica ligado o dia inteiro é real.
let masksCache = [];
let masksTam = 0;

function obterMasks(nPixels) {
  if (masksTam !== nPixels || masksCache.length !== rules.length) {
    masksCache = rules.map(() => new Uint32Array(nPixels));
    masksTam = nPixels;
  } else {
    for (const m of masksCache) m.fill(0);
  }
  return masksCache;
}

function buildMasks(data, nPixels) {
  const masks = obterMasks(nPixels);   // 0 ou 0xFF000000 (ABGR)

  for (let p = 0, i = 0; p < nPixels; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const d   = max - min;

    // ignora cinzas, quase-preto e quase-branco
    if (d < 28 || max < 40) continue;

    let h;
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else                h = ((r - g) / d + 4) * 60;

    for (let k = 0; k < rules.length; k++) {
      const diff  = Math.abs(h - rules[k].hue_center);
      if (Math.min(diff, 360 - diff) <= rules[k].hue_tolerance)
        masks[k][p] = 0xFF000000;
    }
  }

  return masks;
}

// ── Render ────────────────────────────────────────────────────────────────────

function analyze() {
  if (!rules.length || !video || video.readyState < 2) return;

  capCtx.drawImage(video, 0, 0, CAP_W, CAP_H);
  const frame   = capCtx.getImageData(0, 0, CAP_W, CAP_H);
  const nPixels = CAP_W * CAP_H;
  const masks   = buildMasks(frame.data, nPixels);

  ctx.clearRect(0, 0, screenW, screenH);

  for (let k = 0; k < rules.length; k++) {
    if (!maskCanvas) {
      maskCanvas = new OffscreenCanvas(CAP_W, CAP_H);
      maskCtx    = maskCanvas.getContext('2d');
    }

    // máscara → ImageData (pixels pretos com alpha onde a cor bate)
    const maskImg = new ImageData(
      new Uint8ClampedArray(masks[k].buffer), CAP_W, CAP_H
    );
    maskCtx.putImageData(maskImg, 0, 0);

    // amplia a máscara para o tamanho da tela (suavizada = bordas macias)
    workCtx.globalCompositeOperation = 'source-over';
    workCtx.clearRect(0, 0, screenW, screenH);
    workCtx.drawImage(maskCanvas, 0, 0, screenW, screenH);

    // aplica o padrão apenas dentro da máscara
    workCtx.globalCompositeOperation = 'source-in';
    workCtx.fillStyle = getPatternTile(rules[k].pattern);
    workCtx.fillRect(0, 0, screenW, screenH);

    ctx.globalAlpha = rules[k].opacity ?? 0.7;
    ctx.drawImage(workCanvas, 0, 0);
  }

  ctx.globalAlpha = 1;
}

// ── Captura via getUserMedia ──────────────────────────────────────────────────

async function startCapture() {
  if (video) return;

  const sourceId = await overlayAPI.getSource(displayId);
  if (!sourceId) { console.error('[Overlay] nenhuma fonte de captura'); return; }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: CAP_W,
        maxHeight: CAP_H,
        maxFrameRate: 5
      }
    }
  });

  video = document.createElement('video');
  video.srcObject = stream;
  await video.play();
}

function stopCapture() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  if (video) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video = null;
  }
  ctx.clearRect(0, 0, screenW, screenH);
}

async function syncState() {
  if (rules.length) {
    try {
      await startCapture();
      if (!loopTimer) loopTimer = setInterval(analyze, ANALYZE_MS);
    } catch (err) {
      console.error('[Overlay] erro na captura:', err);
    }
  } else {
    stopCapture();
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────

overlayAPI.onDisplay((info) => {
  if (!info) return;
  displayId = info.id;
  if (info.width && info.height) ajustarDimensoes(info.width, info.height);
});

overlayAPI.onRules((newRules) => {
  rules = newRules || [];
  syncState();
});

overlayAPI.onClear(() => {
  rules = [];
  stopCapture();
});

// ── Indicador de estado (M4) ──────────────────────────────────────────────────

const statusEl = document.getElementById('status');

overlayAPI.onStatus(({ visible, icon, text, bottom }) => {
  statusEl.style.display = visible ? 'flex' : 'none';
  if (!visible) return;
  document.getElementById('status-icon').textContent = icon;
  document.getElementById('status-text').textContent = text;
  statusEl.style.bottom = (16 + (bottom || 0)) + 'px';
});
