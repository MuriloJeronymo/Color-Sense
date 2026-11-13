// ColorSense — nome aproximado de uma cor em português
// Usado no conta-gotas das regras de cena: quem não distingue a cor precisa
// saber, em palavras, qual cor capturou.

const { hexToRgb, rgbToHsl } = require('./contrastChecker');

// Faixas de matiz (graus) → nome base
const HUE_NAMES = [
  [15,  'Vermelho'],
  [40,  'Laranja'],
  [65,  'Amarelo'],
  [80,  'Verde-amarelado'],
  [165, 'Verde'],
  [195, 'Ciano'],
  [255, 'Azul'],
  [285, 'Roxo'],
  [320, 'Magenta'],
  [345, 'Rosa'],
  [360, 'Vermelho']
];

function grayName(l) {
  if (l < 12) return 'Preto';
  if (l < 35) return 'Cinza escuro';
  if (l < 70) return 'Cinza';
  if (l < 92) return 'Cinza claro';
  return 'Branco';
}

function colorName(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);

  if (s < 12 || l < 6 || l > 96) return grayName(l);

  let name = HUE_NAMES.find(([max]) => h < max)[1];

  // Tons escuros de laranja/amarelo e tons claros de vermelho têm nome próprio
  if (name === 'Laranja' && l < 40)  return s < 35 ? 'Marrom acinzentado' : 'Marrom';
  if (name === 'Amarelo' && l < 35)  return 'Oliva';
  if (name === 'Vermelho' && l > 75) name = 'Rosa';

  if (l < 30)      name += ' escuro';
  else if (l > 75) name += ' claro';
  if (s < 35)      name += ' acinzentado';

  return name;
}

module.exports = { colorName };
