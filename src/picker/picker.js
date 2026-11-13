// ColorSense — conta-gotas (ajustes M1 e M3)
// Mostra a captura da tela e devolve ao processo principal a cor do pixel
// clicado. Os pixels são lidos da captura em resolução física, não da tela.

const shot   = document.getElementById('shot');
const loupe  = document.getElementById('loupe');
const zoom   = document.getElementById('zoom');
const hexEl  = document.getElementById('hex');
const swatch = document.getElementById('swatch');

const ZOOM_PX = 11;   // pixels da captura exibidos na lupa (ímpar: há um centro)
const zoomCtx = zoom.getContext('2d');

let img = null;       // { width, height, data: RGBA }

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// A captura cobre a tela inteira. A imagem é posicionada em coordenadas da
// tela (não da janela), para coincidir com o que está atrás mesmo se o
// Windows não deixar a janela cobrir a barra de tarefas.
function placeShot() {
  shot.style.left   = -window.screenX + 'px';
  shot.style.top    = -window.screenY + 'px';
  shot.style.width  = window.screen.width + 'px';
  shot.style.height = window.screen.height + 'px';
}

// Converte coordenadas da janela (DIP) em pixel da captura (resolução física)
function pixelAt(clientX, clientY) {
  const sx = clientX + window.screenX;
  const sy = clientY + window.screenY;
  const x = Math.max(0, Math.min(img.width - 1,  Math.floor(sx / window.screen.width  * img.width)));
  const y = Math.max(0, Math.min(img.height - 1, Math.floor(sy / window.screen.height * img.height)));
  return { x, y };
}

window.addEventListener('resize', placeShot);

function colorAt(x, y) {
  const i = (y * img.width + x) * 4;
  return toHex(img.data[i], img.data[i + 1], img.data[i + 2]);
}

function updateLoupe(e) {
  const { x, y } = pixelAt(e.clientX, e.clientY);
  const half = (ZOOM_PX - 1) / 2;

  zoomCtx.clearRect(0, 0, ZOOM_PX, ZOOM_PX);
  zoomCtx.drawImage(shot, x - half, y - half, ZOOM_PX, ZOOM_PX, 0, 0, ZOOM_PX, ZOOM_PX);
  // contorno do pixel central, em preto e branco para aparecer sobre qualquer cor
  zoomCtx.lineWidth = 0.15;
  zoomCtx.strokeStyle = '#000';
  zoomCtx.strokeRect(half, half, 1, 1);
  zoomCtx.strokeStyle = '#fff';
  zoomCtx.strokeRect(half - 0.15, half - 0.15, 1.3, 1.3);

  const hex = colorAt(x, y);
  hexEl.textContent = hex;
  swatch.style.background = hex;

  // a lupa acompanha o cursor e muda de lado perto das bordas
  const w = loupe.offsetWidth  || 146;
  const h = loupe.offsetHeight || 170;
  const left = e.clientX + 20 + w > window.innerWidth  ? e.clientX - 20 - w : e.clientX + 20;
  const top  = e.clientY + 20 + h > window.innerHeight ? e.clientY - 20 - h : e.clientY + 20;
  loupe.style.left = left + 'px';
  loupe.style.top  = top + 'px';
  loupe.style.display = 'block';
}

pickerAPI.onImage(({ width, height, data }) => {
  // A captura chega em BGRA; o canvas espera RGBA
  const rgba = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    rgba[i]     = data[i + 2];
    rgba[i + 1] = data[i + 1];
    rgba[i + 2] = data[i];
    rgba[i + 3] = 255;
  }
  img = { width, height, data: rgba };

  shot.width  = width;
  shot.height = height;
  shot.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  placeShot();
  pickerAPI.ready();
});

window.addEventListener('mousemove', (e) => { if (img) updateLoupe(e); });

window.addEventListener('click', (e) => {
  if (!img) return;
  const { x, y } = pixelAt(e.clientX, e.clientY);
  pickerAPI.done(colorAt(x, y));
});

window.addEventListener('contextmenu', (e) => { e.preventDefault(); pickerAPI.done(null); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') pickerAPI.done(null); });
