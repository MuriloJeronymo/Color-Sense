// ColorSense — verificador de cores do modo Criador (ajuste M1)
//
// A simulação mostra que a cor mudou, mas não diz se a mudança compromete a
// informação. Este módulo dá critérios objetivos para um par de cores:
//
//  • razão de contraste WCAG 2.2 — 4,5:1 para texto (1.4.3) e 3:1 para texto
//    grande e elementos gráficos (1.4.11);
//  • para cada tipo de daltonismo, a diferença perceptual (ΔE CIEDE2000) entre
//    as duas cores depois de simuladas, classificada em faixas.
//
// A simulação usada aqui é a de Machado, Oliveira e Fernandes (2009), aplicada
// em RGB linear. Ela é mais fiel que as matrizes da simulação de tela
// (colorFilters.js), que quase não aproximam pares clássicos de confusão como
// vermelho × verde — o que faria o verificador aprovar pares problemáticos.

const { hexToRgb, getContrastRatio, suggestAccessibleColor } = require('./contrastChecker');

const MIN_CONTRAST_TEXT    = 4.5;
const MIN_CONTRAST_GRAPHIC = 3;

// Faixas de ΔE00 entre as cores simuladas. Abaixo de ~2 a diferença é
// imperceptível; para distinguir categorias (status, séries de gráfico) com
// segurança, ferramentas de paleta costumam exigir ΔE00 de 10 a 20 ou mais.
const DELTA_E_HARD    = 10;  // abaixo: difíceis de distinguir
const DELTA_E_CAUTION = 20;  // abaixo: distinguíveis com atenção


// ── Simulação de Machado et al. (2009) ────────────────────────────────────────
// Matrizes de severidade 1,0 (dicromacia), em RGB linear. As anomalias
// (tricromacia anômala) usam severidade 0,6, aproximada por interpolação
// linear entre a identidade e a matriz de dicromacia.

const MACHADO_DICHROMAT = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
};

const ANOMALY_SEVERITY = 0.6;

function withSeverity(M, s) {
  return M.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) + s * (v - (i === j ? 1 : 0))));
}

const LUMINANCE = [0.2126, 0.7152, 0.0722];

const SIMULATION_LINEAR = {
  protanopia:     MACHADO_DICHROMAT.protan,
  protanomalia:   withSeverity(MACHADO_DICHROMAT.protan, ANOMALY_SEVERITY),
  deuteranopia:   MACHADO_DICHROMAT.deutan,
  deuteranomalia: withSeverity(MACHADO_DICHROMAT.deutan, ANOMALY_SEVERITY),
  tritanopia:     MACHADO_DICHROMAT.tritan,
  tritanomalia:   withSeverity(MACHADO_DICHROMAT.tritan, ANOMALY_SEVERITY),
  achromatopsia:  [LUMINANCE, LUMINANCE, LUMINANCE]
};

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const toSrgb = (v) => {
  const c = Math.max(0, Math.min(1, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

function simulateRgb(type, { r, g, b }) {
  const M = SIMULATION_LINEAR[type];
  const lin = [toLinear(r), toLinear(g), toLinear(b)];
  const out = M.map(row => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  return { r: toSrgb(out[0]), g: toSrgb(out[1]), b: toSrgb(out[2]) };
}

// ── sRGB → CIELAB (D65) ───────────────────────────────────────────────────────

function rgbToLab({ r, g, b }) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);

  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;

  const f = (t) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// ── ΔE CIEDE2000 (Sharma, Wu e Dalal, 2005) ───────────────────────────────────

const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

function deltaE2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G    = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p  = (1 + G) * a1;
  const a2p  = (1 + G) * a2;
  const C1p  = Math.hypot(a1p, b1);
  const C2p  = Math.hypot(a2p, b2);

  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }

  const T = 1
    - 0.17 * Math.cos(rad(hbp - 30))
    + 0.24 * Math.cos(rad(2 * hbp))
    + 0.32 * Math.cos(rad(3 * hbp + 6))
    - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

// ── Análise de um par de cores ────────────────────────────────────────────────

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function verdictFor(deltaE) {
  if (deltaE < DELTA_E_HARD)    return 'hard';
  if (deltaE < DELTA_E_CAUTION) return 'caution';
  return 'ok';
}

function analyzeColorPair(hex1, hex2) {
  const contrast = getContrastRatio(hex1, hex2);
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  const types = Object.keys(SIMULATION_LINEAR).map(type => {
    const s1 = simulateRgb(type, rgb1);
    const s2 = simulateRgb(type, rgb2);
    const deltaE = deltaE2000(rgbToLab(s1), rgbToLab(s2));
    return { type, sim1: rgbToHex(s1), sim2: rgbToHex(s2), deltaE, verdict: verdictFor(deltaE) };
  });

  return {
    contrast,
    passesText:    contrast >= MIN_CONTRAST_TEXT,
    passesGraphic: contrast >= MIN_CONTRAST_GRAPHIC,
    // Sugestão: escurece/clareia a cor 1 até atingir 4,5:1 contra a cor 2
    suggestion: contrast >= MIN_CONTRAST_TEXT ? null : suggestAccessibleColor(hex1, hex2),
    deltaENormal: deltaE2000(rgbToLab(rgb1), rgbToLab(rgb2)),
    types
  };
}

module.exports = {
  analyzeColorPair,
  deltaE2000,
  rgbToLab,
  MIN_CONTRAST_TEXT,
  MIN_CONTRAST_GRAPHIC,
  DELTA_E_HARD,
  DELTA_E_CAUTION
};
