// Appearance preferences beyond the light/dark theme: the accent color and the
// waveform colors (waveform, selection, background). Both are applied as
// inline custom properties on <html>, over the theme tokens in tokens.css, and
// re-applied when the resolved theme changes. Canvas and WebGL drawing reads
// the same properties through cssVar(), so a 'themechange' event repaints.

import { resolvedTheme, parseColor } from './theme.js';

/** Accent presets: [dark theme, light theme] colors. 'blue' is the default look. */
export const ACCENTS = [
  { id: 'blue', label: 'Blue', dark: '#2d8ceb', light: '#1473e6' },
  { id: 'violet', label: 'Violet', dark: '#8f6cf0', light: '#6d48d8' },
  { id: 'teal', label: 'Teal', dark: '#1fb5a5', light: '#0d8478' },
  { id: 'amber', label: 'Amber', dark: '#e0962b', light: '#b06a0b' },
  { id: 'rose', label: 'Rose', dark: '#e2577f', light: '#c0335c' },
  { id: 'graphite', label: 'Graphite', dark: '#8a96a8', light: '#55606f' },
];

/** Built-in waveform color sets; `null` colors follow the theme. */
export const WAVE_PRESETS = [
  { name: 'Theme Colors', wave: null, selection: null, background: null },
  { name: 'Phosphor', wave: '#46e8a8', selection: '#ffffff', background: '#030806' },
  { name: 'Deep Sea', wave: '#5cb8ff', selection: '#d6ecff', background: '#06111d' },
  { name: 'Ember', wave: '#ffae4a', selection: '#fff1d9', background: '#120a02' },
  { name: 'Orchid', wave: '#e28cf5', selection: '#fbe8ff', background: '#120716' },
  { name: 'Ink on Paper', wave: '#24303f', selection: '#2f6fe0', background: '#fbfaf5' },
];

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** '#rrggbb' from a CSS color string. */
export function toHex(color) {
  const [r, g, b] = parseColor(color);
  return `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;
}

function rgba(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

/** Mixes two colors: t = 0 gives `a`, 1 gives `b`. */
export function mixColors(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  return `#${hex2((x[0] + (y[0] - x[0]) * t) * 255)}${hex2((x[1] + (y[1] - x[1]) * t) * 255)}${hex2((x[2] + (y[2] - x[2]) * t) * 255)}`;
}

/** Valid '#rgb' / '#rrggbb' string or null. */
export function cleanColor(v) {
  return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/**
 * Custom properties for the current preferences and theme: { name: value }
 * (an empty object means the theme tokens apply unchanged).
 */
export function appearanceVars(prefs, theme = resolvedTheme()) {
  const vars = {};
  const accent = ACCENTS.find((a) => a.id === prefs.get('accentColor'));
  if (accent && accent.id !== 'blue') {
    const base = theme === 'light' ? accent.light : accent.dark;
    const strong = theme === 'light' ? mixColors(base, '#000000', 0.15) : mixColors(base, '#ffffff', 0.18);
    Object.assign(vars, {
      '--accent': base,
      '--accent-strong': strong,
      '--accent-soft': rgba(base, theme === 'light' ? 0.16 : 0.22),
      '--hot': strong,
      '--focus': theme === 'light' ? base : mixColors(base, '#ffffff', 0.25),
      '--cti': base,
    });
  }
  const w = prefs.get('waveColors');
  const wave = cleanColor(w?.wave);
  const sel = cleanColor(w?.selection);
  const bg = cleanColor(w?.background);
  if (bg) vars['--bg-editor'] = bg;
  if (wave) {
    vars['--wave'] = wave;
    vars['--wave-dim'] = mixColors(wave, bg || (theme === 'light' ? '#fbfbfb' : '#050505'), 0.55);
  }
  if (sel) {
    vars['--wave-sel'] = sel;
    vars['--sel-bg'] = rgba(sel, 0.24);
    vars['--sel-edge'] = rgba(sel, 0.6);
  }
  return vars;
}

const APPLIED = ['--accent', '--accent-strong', '--accent-soft', '--hot', '--focus', '--cti', '--bg-editor', '--wave', '--wave-dim', '--wave-sel', '--sel-bg', '--sel-edge'];
let lastKey = '';

/** Writes the appearance properties onto <html>; repaints (via 'themechange') when they changed. */
export function applyAppearance(prefs) {
  if (typeof document === 'undefined') return;
  const vars = appearanceVars(prefs);
  const key = JSON.stringify(vars);
  if (key === lastKey) return;
  lastKey = key;
  const style = document.documentElement.style;
  for (const name of APPLIED) style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
  window.dispatchEvent(new CustomEvent('themechange'));
}

/** Keeps the appearance applied as preferences and the resolved theme change. */
export function installAppearance(app) {
  applyAppearance(app.prefs);
  app.prefs.on('change', (key) => {
    if (key === 'accentColor' || key === 'waveColors' || key === 'theme') applyAppearance(app.prefs);
  });
  // A system light/dark switch changes which accent shade applies.
  window.addEventListener('themechange', () => applyAppearance(app.prefs));
}
