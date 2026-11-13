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

// ── Correção protan/deutan: codificação do eixo oponente ──────────────────────
//
// A daltonização clássica (Fidaner) redistribui o erro com a matriz
//
//     [0,   0, 0]
//     [0.7, 1, 0]
//     [0.7, 0, 1]
//
// Ela é formulada para RGB LINEAR. Aqui a matriz é aplicada pela Magnification
// API do Windows diretamente sobre valores já codificados em gama sRGB, e nesse
// regime ela se comporta ao contrário do pretendido.
//
// O motivo é a interação com estas matrizes de simulação. Em deuteranopia a
// linha azul da simulação é [0, 0.3, 0.7]: o verde JÁ vaza para o canal azul.
// Somar +0.7·erro_r ao azul aproxima o vermelho do verde em vez de afastar:
//
//   vermelho (1,0,0): erro_r = +0.375  →  azul sobe   0 → 0.184 (visto)
//   verde    (0,1,0): erro_r = −0.375  →  azul satura em 0, fica em 0.300
//   diferença no canal azul: 0.300 antes  →  0.116 depois
//
// Medido em ΔE (Lab) contra pares confundíveis, a fórmula acima piorava a
// distinção em 10 de 10 pares em deuteranopia e 9 de 10 em protanopia.
//
// A abordagem adotada aqui é direta: o eixo que o protan/deutan perde é o
// vermelho-verde, (R − G). O canal que ele preserva é o azul. Então gravamos
// aquele eixo neste canal, com sinal NEGATIVO — que é a direção que de fato
// separa, dado como estas simulações tratam o azul:
//
//     R' = R
//     G' = G
//     B' = B − k·(R − G)
//
// Neutros são preservados por construção: se R = G, o termo é zero.

const K_MAX = 0.7;

// Quanto do eixo perdido ainda sobrevive à simulação. Para um dicromata
// (protanopia/deuteranopia/tritanopia) o eixo colapsa e a sobrevivência é ~0;
// nas formas leves parte da informação ainda passa, e uma correção agressiva só
// distorceria o que a pessoa já enxerga bem. Derivar k daqui evita número
// mágico: um tipo novo ganha um k coerente sozinho.
function sobrevivenciaDoEixo(S, d) {
  const Sd = [0, 1, 2].map(i => S[i][0] * d[0] + S[i][1] * d[1] + S[i][2] * d[2]);
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  return (Sd[0] * d[0] + Sd[1] * d[1] + Sd[2] * d[2]) / dd;
}

function kDerivado(S, d) {
  const sobra = Math.min(1, Math.max(0, sobrevivenciaDoEixo(S, d)));
  return K_MAX * (1 - sobra);
}

// Protan/deutan — eixo perdido: vermelho-verde (R − G). Canal preservado: azul.
//     B' = B − k(R − G)
const EIXO_RG = [1, -1, 0];

function correcaoRedeVerde(S) {
  const k = kDerivado(S, EIXO_RG);
  return [
    [1,  0, 0],
    [0,  1, 0],
    [-k, k, 1]
  ];
}

// Tritan — eixo perdido: azul-amarelo, B − (R+G)/2. Canal preservado: verde.
//     G' = G + k·(B − (R+G)/2)
// O sinal aqui é o oposto do caso vermelho-verde: nas matrizes de simulação
// tritan o azul já vaza fortemente para o verde (linha G da simulação de
// tritanopia é [0, 0.433, 0.567]), então é somando que se abre a diferença.
// Verificado par a par; inverter este sinal piora 6 dos 9 pares azul-amarelo.
const EIXO_BY = [-0.5, -0.5, 1];

function correcaoAzulAmarelo(S) {
  const k = kDerivado(S, EIXO_BY);
  return [
    [1,      0,         0],
    [-k / 2, 1 - k / 2, k],
    [0,      0,         1]
  ];
}

// ── Daltonização clássica (mantida onde ainda mede melhor) ────────────────────
// Redistribuição de erro no formato de Fidaner, usada por tritanomalia.
const SHIFT_BLUE_YELLOW = [
  [1, 0, 0.7],
  [0, 1, 0.7],
  [0, 0, 0]
];

// ── Qual estratégia cada tipo usa ─────────────────────────────────────────────
//
// A escolha abaixo é medida, não estética. Métrica: ganho médio de ΔE (Lab)
// entre pares de cores classicamente confundidos, vistos através da simulação
// do próprio tipo — positivo significa que o filtro afastou as cores.
//
//   tipo             daltonização clássica      eixo oponente
//   protanopia              -19.91                  +35.00
//   deuteranopia            -15.31                  +31.93
//   protanomalia             +3.55                   +6.85
//   deuteranomalia           +3.43                   +3.82
//   tritanopia               -2.18                  +11.81
//   tritanomalia             +2.91                   -1.10   <- clássica vence
//
// Tritanomalia é a única exceção: o eixo oponente piora 4 dos 9 pares
// azul-amarelo enquanto a clássica piora só 1, e o efeito é pequeno nos dois
// casos. Seguir o número em vez de uniformizar por elegância.
// Amostra pequena (8-9 pares por família) — vale remedir se a lista crescer.
const ESTRATEGIA = {
  protanopia:     correcaoRedeVerde,
  protanomalia:   correcaoRedeVerde,
  deuteranopia:   correcaoRedeVerde,
  deuteranomalia: correcaoRedeVerde,
  tritanopia:     correcaoAzulAmarelo,
  tritanomalia:   (S) => daltonize(S, SHIFT_BLUE_YELLOW)
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

  SIMULATION_MATRICES[key] = {
    label: LABELS[key].label,
    description: LABELS[key].description,
    matrix: to20(S)
  };

  // Sem estratégia (normal, acromatopsia, acromatomalia) não há correção
  // possível por matriz linear: não sobra canal funcional para onde realocar a
  // informação perdida. Nesses casos a matriz é a identidade e temCorrecao é
  // false, para a interface poder dizer isso ao usuário em vez de fingir que
  // aplicou algo.
  const estrategia = ESTRATEGIA[key];
  const M = estrategia ? estrategia(S) : I3;

  CORRECTION_MATRICES[key] = {
    label: LABELS[key].label,
    description: LABELS[key].description,
    temCorrecao: !!estrategia,
    matrix: to20(M)
  };
}

// ── Intensidade da correção (calibração do filtro) ────────────────────────────
// M = I + k · (D − I): k = 0 desliga a correção, k = 1 é a correção padrão do
// tipo (ESTRATEGIA) e k > 1 a reforça, para quem não percebe ganho com o
// filtro padrão. Tipos sem correção possível devolvem a identidade.

function getCorrectionMatrix(type, intensity = 1) {
  const S = SIMULATION_3X3[type];
  const estrategia = ESTRATEGIA[type];
  if (!S || !estrategia) return to20(I3);
  const D = estrategia(S);
  return to20(matCombine(I3, D, (i, d) => i + intensity * (d - i)));
}

module.exports = { SIMULATION_MATRICES, CORRECTION_MATRICES, getCorrectionMatrix };
