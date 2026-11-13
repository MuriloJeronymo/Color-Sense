// ColorSense — ícones da bandeja do sistema, desenhados em código
//
// Cada estado tem uma FORMA diferente, além da cor, para que o estado não
// dependa só da cor (ajuste M4):
//   off    → anel cinza vazio          ("Desligado")
//   filter → três pontos do logotipo   ("Filtro ligado")
//   sim    → alvo (anel + centro)      ("Simulando")

const { nativeImage } = require('electron');

const SIZE = 32; // desenhado em 32 px e exibido com scaleFactor 2 (16 px lógicos)

const SHAPES = {
  off: [
    { kind: 'ring', cx: 16, cy: 16, r: 11, w: 3.2, color: [139, 146, 184] }
  ],
  filter: [
    { kind: 'disc', cx: 16,   cy: 8.5,  r: 6.5, color: [224, 92, 122] },
    { kind: 'disc', cx: 8.5,  cy: 21.5, r: 6.5, color: [76, 175, 138] },
    { kind: 'disc', cx: 23.5, cy: 21.5, r: 6.5, color: [108, 99, 255] }
  ],
  sim: [
    { kind: 'ring', cx: 16, cy: 16, r: 12, w: 3.2, color: [128, 120, 255] },
    { kind: 'disc', cx: 16, cy: 16, r: 5,  color: [128, 120, 255] }
  ]
};

// Cobertura antisserrilhada do pixel pela forma (0 a 1)
function coverage(shape, x, y) {
  const d = Math.hypot(x - shape.cx, y - shape.cy);
  const dist = shape.kind === 'disc'
    ? d - shape.r
    : Math.abs(d - shape.r) - shape.w / 2;
  return Math.max(0, Math.min(1, 0.5 - dist));
}

function drawIcon(shapes) {
  // BGRA pré-multiplicado, formato esperado por createFromBitmap no Windows
  const buf = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      for (const s of shapes) {
        const a = coverage(s, x + 0.5, y + 0.5);
        if (a === 0) continue;
        // composição "over" em alfa pré-multiplicado
        buf[i]     = Math.round(s.color[2] * a + buf[i]     * (1 - a));
        buf[i + 1] = Math.round(s.color[1] * a + buf[i + 1] * (1 - a));
        buf[i + 2] = Math.round(s.color[0] * a + buf[i + 2] * (1 - a));
        buf[i + 3] = Math.round(255 * a      + buf[i + 3] * (1 - a));
      }
    }
  }

  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

const cache = {};

function trayIcon(mode) {
  if (!cache[mode]) cache[mode] = drawIcon(SHAPES[mode] || SHAPES.off);
  return cache[mode];
}

module.exports = { trayIcon };
