// Frequency Analysis panel: the spectrum at the playhead while playing (from
// the mixer's output tap), or of the selection (averaged) / at the playhead
// when stopped. Log or linear frequency axis, FFT size, window, channel view,
// held traces for comparison and a cursor readout of frequency, note and level.

import { h, debounce, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { select } from '../ui/controls.js';
import { cssVar, CANVAS_FONT } from '../ui/theme.js';
import { dsp } from '../audio/dsp.js';
import { makeScale, frequencyTicks, formatHzLong, noteName, formatHz } from '../spectral/freq-scale.js';
import { analysisPool } from './pool.js';
import { fitCanvas, masterTap } from './common.js';

const FFTS = [1024, 2048, 4096, 8192, 16384];
const WINDOWS = [
  [0, 'Hann'],
  [1, 'Hamming'],
  [2, 'Blackman'],
  [3, 'Blackman-Harris'],
  [4, 'Rectangular'],
];
const MAX_HOLDS = 5;
const DB_TOP = 0;
const DB_BOTTOM = -120;
const HOLD_COLORS = ['--marker', '--envelope-pan', '--warning', '--danger', '--text-dim'];

const DEFAULTS = { log: true, fft: 4096, window: 0, channel: 'both' };

export function frequencyPanel(app) {
  const prefs = () => ({ ...DEFAULTS, ...(app.prefs.get('frequencyAnalysis') || {}) });
  const setPref = (patch) => {
    app.prefs.set('frequencyAnalysis', { ...prefs(), ...patch });
    recompute();
  };
  const p0 = prefs();
  const scaleSel = select({ label: 'Frequency scale', value: p0.log ? 'log' : 'lin', options: [{ value: 'log', label: 'Logarithmic' }, { value: 'lin', label: 'Linear' }], onChange: (v) => setPref({ log: v === 'log' }) });
  const fftSel = select({ label: 'FFT size', value: p0.fft, options: FFTS.map((n) => ({ value: n, label: `${n}` })), onChange: (v) => setPref({ fft: Number(v) }) });
  const winSel = select({ label: 'Window', value: p0.window, options: WINDOWS.map(([value, label]) => ({ value, label })), onChange: (v) => setPref({ window: Number(v) }) });
  const chSel = select({ label: 'Channels', value: p0.channel, options: [{ value: 'both', label: 'Left and Right' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'mid', label: 'Mid (L+R)' }], onChange: (v) => setPref({ channel: v }) });
  const holdBtn = h('button.btn.sm', { type: 'button', title: 'Hold the current trace for comparison (up to 5)', onclick: () => hold() }, icon('pause', 13), 'Hold');
  const clearBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Clear held traces', title: 'Clear held traces', onclick: () => clearHolds() }, icon('trash-2', 14));
  const toolbar = h('div.panel-toolbar.analysis-toolbar', scaleSel, fftSel, winSel, chSel, holdBtn, clearBtn);
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const plot = h('div.freq-plot', { tabindex: '0', role: 'img', 'aria-label': 'Frequency spectrum' }, canvas);
  const readout = h('div.analysis-readout', { 'aria-live': 'polite' }, 'Play, or select audio, to see its spectrum.');
  const legend = h('div.freq-legend');
  const el = h('div.analysis-panel.frequency-panel', toolbar, plot, h('div.analysis-foot', readout, legend));

  let visible = false;
  let raf = 0;
  let live = null; // { L: dB[], R: dB[], rate, fft }
  let still = null; // computed from the document when stopped
  let holds = [];
  let hoverX = null;
  let gen = 0;
  let d = null;
  let analyzers = new Map();
  dsp().then((x) => (d = x)).catch(() => {});

  const analyzer = (fft, window) => {
    const key = `${fft}/${window}`;
    let a = analyzers.get(key);
    if (!a && d) {
      a = d.analyzer(fft, window);
      analyzers.set(key, a);
    }
    return a;
  };

  // Live: spectra of the latest output block, smoothed in power.
  const tap = masterTap(app, (m) => {
    if (!visible || !d) return;
    const { fft, window } = prefs();
    const a = analyzer(fft, window);
    if (!a) return;
    const n = Math.min(fft, m.L.length);
    const frame = (x) => a.frame(x.subarray(x.length - n));
    const L = frame(m.L);
    const R = frame(m.R);
    if (live && live.fft === fft) {
      for (const [prev, next] of [[live.L, L], [live.R, R]]) {
        for (let k = 0; k < next.length; k++) {
          // Fast attack, slower release.
          next[k] = next[k] > prev[k] ? next[k] : prev[k] * 0.6 + next[k] * 0.4;
        }
      }
    }
    live = { L, R, rate: m.rate, fft };
    schedule();
  });

  const recompute = debounce(async () => {
    const doc = app.active;
    const my = ++gen;
    if (!doc || doc.kind !== 'audio' || !doc.length || app.engine.playing) {
      if (!app.engine.playing) still = null;
      schedule();
      return;
    }
    const { fft, window } = prefs();
    const sel = doc.selection;
    const hasSel = sel.end - sel.start >= fft;
    let positions;
    if (hasSel) {
      const frames = Math.max(1, Math.min(128, Math.floor((sel.end - sel.start - fft) / (fft / 2)) + 1));
      const step = frames > 1 ? (sel.end - sel.start - fft) / (frames - 1) : 0;
      positions = Array.from({ length: frames }, (_, i) => Math.round(sel.start + i * step));
    } else positions = [Math.round(doc.cursor - fft / 2)];
    const channels = doc.state.channels;
    try {
      const results = await Promise.all(
        channels.slice(0, 2).map((ch) => {
          const samples = new Float32Array(positions.length * fft);
          positions.forEach((p, i) => ch.read(p, samples, i * fft, fft));
          return analysisPool().call({ op: 'average', size: fft, window, hop: fft, frames: positions.length, samples }, [samples.buffer]);
        }),
      );
      if (my !== gen) return;
      still = { L: results[0], R: results[1] || results[0], rate: doc.sampleRate, fft, label: hasSel ? 'Selection' : 'Playhead' };
      schedule();
    } catch (err) {
      console.warn('[frequency]', err);
    }
  }, 150);

  const current = () => (app.engine.playing && live ? live : still);

  /** The displayed trace for the channel option: { L?, R?, M? } dB arrays. */
  const traces = (data, channel) => {
    if (!data) return [];
    if (channel === 'left') return [['L', data.L]];
    if (channel === 'right') return [['R', data.R]];
    if (channel === 'mid') {
      const M = data.L.map((v, k) => 10 * Math.log10((Math.pow(10, v / 10) + Math.pow(10, data.R[k] / 10)) / 2));
      return [['M', M]];
    }
    return data.L === data.R ? [['L', data.L]] : [['L', data.L], ['R', data.R]];
  };

  const hold = () => {
    const data = current();
    if (!data) return;
    const t = traces(data, prefs().channel);
    holds.push({ traces: t.map(([n, a]) => [n, a.slice()]), rate: data.rate, fft: data.fft, n: holds.length + 1 });
    if (holds.length > MAX_HOLDS) holds.shift();
    announce(`Trace ${holds.length} held`);
    schedule();
  };
  const clearHolds = () => {
    holds = [];
    schedule();
  };

  const schedule = () => {
    if (!raf && visible) raf = requestAnimationFrame(draw);
  };

  const geometry = (W, H) => ({ left: 34, right: W - 8, top: 8, bottom: H - 18 });

  const draw = () => {
    raf = 0;
    const fit = fitCanvas(canvas, plot);
    if (!fit) return;
    const { ctx, W, H } = fit;
    const g = geometry(W, H);
    const data = current();
    const rate = data?.rate || app.active?.sampleRate || 48000;
    const nyq = rate / 2;
    const { log, channel } = prefs();
    const scale = makeScale({ log, lo: log ? 20 : 0, hi: nyq });
    const xOf = (f) => g.left + scale.toFrac(f) * (g.right - g.left);
    const yOf = (db) => g.top + ((DB_TOP - db) / (DB_TOP - DB_BOTTOM)) * (g.bottom - g.top);
    ctx.fillStyle = cssVar('--bg-editor');
    ctx.fillRect(g.left, g.top, g.right - g.left, g.bottom - g.top);
    ctx.font = CANVAS_FONT;
    ctx.textBaseline = 'middle';
    // Grid.
    for (let db = DB_TOP; db >= DB_BOTTOM; db -= 10) {
      const y = Math.round(yOf(db)) + 0.5;
      ctx.fillStyle = db % 20 === 0 ? cssVar('--grid-strong') : cssVar('--grid');
      ctx.fillRect(g.left, y, g.right - g.left, 1);
      if (db % 20 === 0) {
        ctx.fillStyle = cssVar('--text-dim');
        ctx.textAlign = 'right';
        ctx.fillText(String(db), g.left - 4, y);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ticks = frequencyTicks({ ...scale, toFrac: (f) => 1 - scale.toFrac(f) }, g.right - g.left, 40);
    for (const t of ticks) {
      const x = Math.round(xOf(t.f)) + 0.5;
      ctx.fillStyle = cssVar('--grid');
      ctx.fillRect(x, g.top, 1, g.bottom - g.top);
      ctx.fillStyle = cssVar('--text-dim');
      ctx.fillText(formatHz(t.f), x, g.bottom + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillText('dB', 4, g.top - 2);
    // Curves.
    const curve = (db, fft, color, width = 1.25, dash = null) => {
      const df = rate / fft;
      const bins = db.length;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      const cols = Math.max(1, Math.round(g.right - g.left));
      for (let i = 0; i <= cols; i++) {
        const fa = scale.toHz(i / cols);
        const fb = scale.toHz((i + 1) / cols);
        const ka = fa / df;
        const kb = fb / df;
        let v;
        if (kb - ka < 1) {
          const k = (ka + kb) / 2;
          const k0 = Math.min(bins - 1, Math.floor(k));
          const k1 = Math.min(bins - 1, k0 + 1);
          v = db[k0] + (db[k1] - db[k0]) * (k - k0);
        } else {
          v = -Infinity;
          for (let k = Math.floor(ka); k <= Math.min(bins - 1, Math.ceil(kb)); k++) if (db[k] > v) v = db[k];
        }
        const y = Math.min(g.bottom, Math.max(g.top, yOf(Math.max(DB_BOTTOM - 10, v))));
        const x = g.left + i;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.left, g.top, g.right - g.left, g.bottom - g.top);
    ctx.clip();
    holds.forEach((hd, i) => {
      for (const [, db] of hd.traces) curve(db, hd.fft, cssVar(HOLD_COLORS[i % HOLD_COLORS.length]), 1, [4, 3]);
    });
    const colors = { L: cssVar('--wave'), M: cssVar('--wave'), R: cssVar('--accent-strong') };
    for (const [name, db] of traces(data, channel)) curve(db, data.fft, colors[name], 1.5);
    // Cursor.
    if (hoverX !== null && hoverX >= g.left && hoverX <= g.right) {
      ctx.fillStyle = cssVar('--text-strong');
      ctx.fillRect(Math.round(hoverX), g.top, 1, g.bottom - g.top);
    }
    ctx.restore();
    // Legend and readout.
    legend.replaceChildren(
      ...traces(data, channel).map(([name]) => h('span.legend-item', h('span.swatch', { style: { background: colors[name] } }), name === 'M' ? 'Mid' : name === 'L' ? 'Left' : 'Right')),
      ...holds.map((hd, i) => h('span.legend-item', h('span.swatch.dashed', { style: { borderColor: cssVar(HOLD_COLORS[i % HOLD_COLORS.length]) } }), `Hold ${hd.n}`)),
    );
    if (hoverX !== null && data) {
      const f = scale.toHz((hoverX - g.left) / (g.right - g.left));
      const k = Math.round(f / (rate / data.fft));
      const note = noteName(f);
      const levels = traces(data, channel).map(([name, db]) => `${name} ${Number.isFinite(db[k]) ? db[k].toFixed(1) : '-∞'} dB`);
      readout.textContent = `${formatHzLong(f)}${note ? `  ${note.name} ${note.cents >= 0 ? '+' : ''}${note.cents} ct` : ''}  ${levels.join('  ')}`;
    } else if (data) {
      // Summary: the strongest bin of the first trace.
      const [, db] = traces(data, channel)[0];
      let best = 1;
      for (let k = 2; k < db.length; k++) if (db[k] > db[best]) best = k;
      const f = (best * rate) / data.fft;
      const note = noteName(f);
      readout.textContent = `${app.engine.playing ? 'Playing' : data.label}: peak ${formatHzLong(f)}${note ? ` (${note.name})` : ''} at ${db[best].toFixed(1)} dB`;
      plot.setAttribute('aria-label', `Frequency spectrum. ${readout.textContent}`);
    } else readout.textContent = app.active ? 'Play, or select audio, to see its spectrum.' : 'Open a file to analyze its spectrum.';
    if (app.engine.playing) schedule();
  };

  plot.addEventListener('pointermove', (e) => {
    const r = plot.getBoundingClientRect();
    hoverX = e.clientX - r.left;
    schedule();
  });
  plot.addEventListener('pointerleave', () => {
    hoverX = null;
    schedule();
  });
  plot.addEventListener('keydown', (e) => {
    const W = plot.clientWidth;
    const g = geometry(W, plot.clientHeight);
    const step = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft') hoverX = Math.max(g.left, (hoverX ?? (g.left + g.right) / 2) - step);
    else if (e.key === 'ArrowRight') hoverX = Math.min(g.right, (hoverX ?? (g.left + g.right) / 2) + step);
    else if (e.key === 'Escape') hoverX = null;
    else return;
    e.preventDefault();
    e.stopPropagation();
    schedule();
  });

  const offs = [
    app.on('active', () => recompute()),
    app.on('doc-change', (doc, e) => doc === app.active && e.kind !== 'view' && recompute()),
    app.on('transport', (s) => {
      if (s === 'stopped') {
        live = null;
        recompute();
      }
      schedule();
    }),
  ];
  const ro = new ResizeObserver(() => schedule());
  ro.observe(plot);
  void offs;

  return {
    el,
    show() {
      visible = true;
      tap.start();
      recompute();
      schedule();
    },
    hide() {
      visible = false;
      tap.stop();
    },
    focus() {
      plot.focus();
    },
    scan: () => recompute(),
  };
}
