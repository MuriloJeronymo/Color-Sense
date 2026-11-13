function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

function rgbToRelativeLuminance({ r, g, b }) {
  const linearize = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function getContrastRatio(hex1, hex2) {
  const l1 = rgbToRelativeLuminance(hexToRgb(hex1));
  const l2 = rgbToRelativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function checkWcagAA(ratio, isLargeText = false) {
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

function checkWcagAAA(ratio, isLargeText = false) {
  return isLargeText ? ratio >= 4.5 : ratio >= 7;
}

function getContrastLevel(ratio, isLargeText = false) {
  if (checkWcagAAA(ratio, isLargeText)) return 'AAA';
  if (checkWcagAA(ratio, isLargeText)) return 'AA';
  return 'FAIL';
}

function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      default: h = ((rn - gn) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  const hn = h / 360, sn = s / 100, ln = l / 100;
  let r, g, b;
  if (sn === 0) {
    r = g = b = ln;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    r = hue2rgb(p, q, hn + 1 / 3);
    g = hue2rgb(p, q, hn);
    b = hue2rgb(p, q, hn - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function suggestAccessibleColor(foreground, background) {
  const bgLum = rgbToRelativeLuminance(hexToRgb(background));
  const { r, g, b } = hexToRgb(foreground);
  const hsl = rgbToHsl(r, g, b);

  for (let step = 0; step <= 100; step++) {
    for (const dir of [1, -1]) {
      const newL = Math.max(0, Math.min(100, hsl.l + dir * step));
      const candidate = hslToHex(hsl.h, hsl.s, newL);
      const ratio = getContrastRatio(candidate, background);
      if (checkWcagAA(ratio)) return candidate;
    }
  }
  return bgLum > 0.5 ? '#000000' : '#ffffff';
}

module.exports = {
  hexToRgb,
  rgbToRelativeLuminance,
  getContrastRatio,
  checkWcagAA,
  checkWcagAAA,
  getContrastLevel,
  suggestAccessibleColor,
  rgbToHsl
};
