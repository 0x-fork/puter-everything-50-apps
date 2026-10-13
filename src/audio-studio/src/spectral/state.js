// Spectral display settings (preferences) and per-document spectral view
// state: the visible frequency band and the current spectral selection.

import { selectionBounds } from './mask.js';
import { DEFAULT_COLORMAP } from './colormaps.js';

export const SPECTRAL_TOOLS = ['marquee', 'lasso', 'brush', 'heal'];

export const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192];
export const WINDOWS = [
  { value: 0, label: 'Hann' },
  { value: 1, label: 'Hamming' },
  { value: 2, label: 'Blackman' },
  { value: 3, label: 'Blackman-Harris' },
  { value: 4, label: 'Rectangular' },
];
export const FLOORS = [-60, -80, -100, -120, -140];
export const CEILINGS = [0, -10, -20, -30];

const DEFAULTS = {
  fft: 2048,
  window: 3,
  minDb: -120,
  maxDb: 0,
  map: DEFAULT_COLORMAP,
  share: 0.55,
  brushSize: 24,
  brushOpacity: 1,
};

/** Spectral display settings merged over defaults. */
export function settings(app) {
  return { ...DEFAULTS, ...(app.prefs.get('spectralSettings') || {}) };
}

export function setSettings(app, patch) {
  app.prefs.set('spectralSettings', { ...settings(app), ...patch });
}

export function displayOn(app) {
  return app.prefs.get('spectralDisplay') === true;
}

export function pitchOn(app) {
  return app.prefs.get('spectralPitch') === true;
}

export function logScale(app) {
  return app.prefs.get('spectralLog') !== false;
}

const states = new WeakMap();

/** Per-document spectral state: { lo, hi (null = Nyquist), selection, timeKey }. */
export function docState(doc) {
  let s = states.get(doc);
  if (!s) {
    s = { lo: 0, hi: null, selection: null, timeKey: '' };
    states.set(doc, s);
  }
  return s;
}

export function visibleBand(doc) {
  const s = docState(doc);
  const nyq = doc.sampleRate / 2;
  return { lo: Math.min(s.lo, nyq - 20), hi: Math.min(nyq, s.hi ?? nyq) };
}

/**
 * Sets (or clears, with null) the spectral selection. The document's time
 * selection follows its time bounds, so playback and the
 * Selection/View panel reflect it.
 */
export function setSpectralSelection(app, doc, selection) {
  const s = docState(doc);
  const b = selection ? selectionBounds(selection) : null;
  s.selection = b ? selection : null;
  if (b) {
    const a = Math.max(0, Math.floor(b.t0));
    const e = Math.min(doc.length, Math.ceil(b.t1));
    s.timeKey = `${a}:${e}`;
    doc.setSelection(a, e, { channels: selection.channels });
  } else s.timeKey = '';
  app.emit('spectral-selection', doc);
}

/** The active spectral selection of a document, or null. */
export function spectralSelection(app, doc) {
  if (!doc || doc.kind !== 'audio' || !displayOn(app)) return null;
  return docState(doc).selection;
}

/** Clears the spectral selection when the time selection is changed by other means. */
export function syncWithTimeSelection(app, doc) {
  const s = docState(doc);
  if (!s.selection) return;
  if (`${doc.selection.start}:${doc.selection.end}` !== s.timeKey) {
    s.selection = null;
    s.timeKey = '';
    app.emit('spectral-selection', doc);
  }
}
