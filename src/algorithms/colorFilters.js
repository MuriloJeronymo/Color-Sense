// ColorSense — matrizes de transformação de cor
//
// Há DOIS conjuntos de matrizes, com propósitos opostos:
//
//  • SIMULATION_MATRICES — reproduzem como um daltônico ENXERGA a tela.
//    Usadas na aba "Criador" (designer/dev validando o próprio trabalho).
//    São as matrizes clássicas de Viénot/Brettel, que ACHATAM o eixo de cor
//    que o daltônico não percebe.
//
//  • CORRECTION_MATRICES — COMPENSAM o daltonismo para o usuário daltônico.
//    Usadas na aba "Filtro". São geradas por DALTONIZAÇÃO: pega-se a
//    informação de cor que o daltônico perde e redistribui-se para canais
//    que ele consegue distinguir.
//
// Aplicar simulação na tela de um daltônico NÃO corrige nada — por isso os
// dois conjuntos precisam ser distintos.

// ── Matrizes de simulação (RGB→RGB, 3×3) ──────────────────────────────────────

const SIMULATION_3X3 = {
  normal:         [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia:     [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  protanomalia:   [[0.817, 0.183, 0], [0.333, 0.667, 0], [0, 0.125, 0.875]],
  deuteranopia:   [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  deuteranomalia: [[0.8, 0.2, 0], [0.258, 0.742, 0], [0, 0.142, 0.858]],
  tritanopia:     [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
  tritanomalia:   [[0.967, 0.033, 0], [0, 0.733, 0.267], [0, 0.183, 0.817]],
  achromatopsia:  [[0.299, 0.587, 0.114], [0.299, 0.587, 0.114], [0.299, 0.587, 0.114]],
  achromatomaly:  [[0.618, 0.320, 0.062], [0.163, 0.775, 0.062], [0.163, 0.320, 0.516]]
};

const LABELS = {
  normal:         { label: 'Normal',         description: 'Visão de cores padrão, sem alteração.' },
  protanopia:     { label: 'Protanopia',     description: 'Ausência de cones vermelhos.' },
  protanomalia:   { label: 'Protanomalia',   description: 'Deficiência leve de cones vermelhos.' },
  deuteranopia:   { label: 'Deuteranopia',   description: 'Ausência de cones verdes. Tipo mais comum.' },
  deuteranomalia: { label: 'Deuteranomalia', description: 'Deficiência leve de cones verdes.' },
  tritanopia:     { label: 'Tritanopia',     description: 'Ausência de cones azuis.' },
  tritanomalia:   { label: 'Tritanomalia',   description: 'Deficiência leve de cones azuis.' },
  achromatopsia:  { label: 'Acromatopsia',   description: 'Ausência total de percepção de cor.' },
  achromatomaly:  { label: 'Acromatomalia',  description: 'Redução parcial da percepção de cor.' }
};

// ── Matrizes de redistribuição de erro (daltonização) ─────────────────────────
// Definem para onde a informação de cor perdida é jogada.

// Deficiências vermelho-verde (protan/deutan): o erro vermelho-verde é
// redistribuído para os canais verde e azul.
const SHIFT_RED_GREEN = [
  [0,   0, 0],
  [0.7, 1, 0],
  [0.7, 0, 1]
];

// Deficiências azul-amarelo (tritan): o erro é redistribuído para
// vermelho e verde.
const SHIFT_BLUE_YELLOW = [
  [1, 0, 0.7],
  [0, 1, 0.7],
  [0, 0, 0]
];

// Qual matriz de redistribuição cada tipo usa. Acromatopsia/acromatomalia
// não têm canal funcional para redistribuir → sem correção (identidade).
const SHIFT_BY_TYPE = {
  protanopia:     SHIFT_RED_GREEN,
  protanomalia:   SHIFT_RED_GREEN,
  deuteranopia:   SHIFT_RED_GREEN,
  deuteranomalia: SHIFT_RED_GREEN,
  tritanopia:     SHIFT_BLUE_YELLOW,
  tritanomalia:   SHIFT_BLUE_YELLOW
};

// ── Álgebra de matrizes 3×3 ───────────────────────────────────────────────────

const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function matMul(A, B) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        R[i][j] += A[i][k] * B[k][j];
  return R;
}

function matCombine(A, B, op) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      R[i][j] = op(A[i][j], B[i][j]);
  return R;
}

const matAdd = (A, B) => matCombine(A, B, (a, b) => a + b);
const matSub = (A, B) => matCombine(A, B, (a, b) => a - b);

// Daltonização: M = I + C · (I − S)
//   S = matriz de simulação (o que o daltônico perde)
//   C = matriz de redistribuição (para onde o erro vai)
function daltonize(S, C) {
  return matAdd(I3, matMul(C, matSub(I3, S)));
}

// Converte 3×3 (RGB) para o formato 4×5 da feColorMatrix / Magnification API.
function to20(m) {
  return [
    m[0][0], m[0][1], m[0][2], 0, 0,
    m[1][0], m[1][1], m[1][2], 0, 0,
    m[2][0], m[2][1], m[2][2], 0, 0,
    0,       0,       0,       1, 0
  ];
}

// ── Construção dos dois conjuntos exportados ──────────────────────────────────

const SIMULATION_MATRICES = {};
const CORRECTION_MATRICES = {};

for (const key of Object.keys(SIMULATION_3X3)) {
  const S = SIMULATION_3X3[key];
  const C = SHIFT_BY_TYPE[key];

  SIMULATION_MATRICES[key] = {
    label: LABELS[key].label,
    description: LABELS[key].description,
    matrix: to20(S)
  };

  CORRECTION_MATRICES[key] = {
    label: LABELS[key].label,
    description: LABELS[key].description,
    // Sem matriz de redistribuição (normal/acromatopsia) → identidade (sem correção)
    matrix: to20(C ? daltonize(S, C) : I3)
  };
}

// ── Intensidade da correção (calibração do filtro) ────────────────────────────
// M = I + k · (D − I): k = 0 desliga a correção, k = 1 é a daltonização padrão
// e k > 1 a exagera, para quem não percebe ganho com o filtro padrão.

function getCorrectionMatrix(type, intensity = 1) {
  const S = SIMULATION_3X3[type];
  const C = SHIFT_BY_TYPE[type];
  if (!S || !C) return to20(I3);
  const D = daltonize(S, C);
  return to20(matCombine(I3, D, (i, d) => i + intensity * (d - i)));
}

module.exports = { SIMULATION_MATRICES, CORRECTION_MATRICES, getCorrectionMatrix };
