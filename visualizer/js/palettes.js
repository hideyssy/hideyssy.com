'use strict';

const PALETTES = {
  neon:     { name: 'ネオン',       colors: ['#00f0ff', '#9a7dff', '#ff4fe0', '#ffab3d'] },
  aurora:   { name: 'オーロラ',     colors: ['#2bff9a', '#7af3ff', '#c98aff', '#3dc2ff'] },
  sunset:   { name: '夕焼け',       colors: ['#ff6466', '#ffa24d', '#ffe04a', '#ff85a6'] },
  ocean:    { name: '深海',         colors: ['#2fd4ff', '#3d8fff', '#2bffe0', '#a8ffb4'] },
  forest:   { name: '森',           colors: ['#b8f07a', '#7bd14f', '#d4ffe6', '#ffe09a'] },
  fire:     { name: '炎',           colors: ['#ff4a20', '#ff8a2a', '#ffd84a', '#fff5c4'] },
  sakura:   { name: '桜',           colors: ['#ffc8d4', '#ff7dc0', '#fff2f7', '#f08cb0'] },
  pastel:   { name: 'パステル',     colors: ['#ffb5e8', '#bfa0ff', '#b4fbe0', '#fff5ba'] },
  gold:     { name: 'ゴールド',     colors: ['#ffdd33', '#ffbd5c', '#fff4d0', '#e6c04a'] },
  mono:     { name: 'モノクロ',     colors: ['#ffffff', '#c0c0c0', '#e6e6e6', '#a0a0a0'] },
  redblue:  { name: '赤×青',        colors: ['#ff2d55', '#3d6bff', '#ff4f8a', '#2fb8ff'] },
  tropical: { name: 'トロピカル',   colors: ['#ff6b9d', '#ffd93d', '#3ee8c8', '#4da6ff'] },
  candy:    { name: 'キャンディ',   colors: ['#ff9ad5', '#8fd8ff', '#d0b0ff', '#ffe98f'] },
  citrus:   { name: 'シトラス',     colors: ['#ffe14d', '#b0ff57', '#4dffd2', '#ffa54d'] },
  sky:      { name: '青空',         colors: ['#8adcff', '#ffffff', '#a8c8ff', '#ffd8f0'] },
};

(function prepare() {
  for (const p of Object.values(PALETTES)) {
    p.rgb = p.colors.map(hexToRgb);
  }
})();

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getPalette(key) {
  return PALETTES[key] || PALETTES.neon;
}

/** Cyclic interpolation through the palette. t wraps at 1. Returns [r, g, b]. */
function palRgb(pal, t) {
  const c = pal.rgb;
  const n = c.length;
  let x = (t % 1 + 1) % 1 * n;
  const i = Math.floor(x);
  const f = x - i;
  const a = c[i % n];
  const b = c[(i + 1) % n];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function palColor(pal, t, alpha = 1) {
  const c = palRgb(pal, t);
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}
