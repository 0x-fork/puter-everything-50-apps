// Phase Meter panel: a goniometer (mid on the vertical axis, side on the
// horizontal, so mono is a vertical line and out-of-phase audio spreads
// sideways) drawn as dots, connected lines or a density map that builds up
// over time, or an X/Y Lissajous plot, plus a correlation meter from -1
// (out of phase) through 0 (unrelated) to +1 (mono), during playback. The
// sample count sets how much audio each frame shows; Normalize scales quiet
// material up to fill the scope.

import { h } from '../lib/dom.js';
import { select } from '../ui/controls.js';
import { cssVar, CANVAS_FONT } from '../ui/theme.js';
import { fitCanvas, masterTap } from './common.js';

/** Pearson correlation of two blocks (0 for silence). */
export function correlation(L, R) {
  let lr = 0;
  let ll = 0;
  let rr = 0;
  for (let i = 0; i < L.length; i++) {
    lr += L[i] * R[i];
    ll += L[i] * L[i];
    rr += R[i] * R[i];
  }
  const den = Math.sqrt(ll * rr);
  return den > 1e-12 ? lr / den : 0;
}

export function phasePanel(app) {
  const modeSel = select({
    label: 'Display',
    value: app.prefs.get('phaseMode') || 'gonio',
    options: [
      { value: 'gonio', label: 'Goniometer' },
      { value: 'lines', label: 'Goniometer (Lines)' },
      { value: 'density', label: 'Density' },
      { value: 'xy', label: 'Lissajous (X/Y)' },
    ],
    onChange: (v) => app.prefs.set('phaseMode', v),
  });
  const samplesSel = select({
    label: 'Samples per frame',
    value: String(app.prefs.get('phaseSamples') || 2048),
    options: [256, 512, 1024, 2048, 4096].map((n) => ({ value: String(n), label: `${n} samples` })),
    onChange: (v) => app.prefs.set('phaseSamples', Number(v)),
  });
  const normBox = h('input', { type: 'checkbox', checked: Boolean(app.prefs.get('phaseNormalize')), onchange: (e) => app.prefs.set('phaseNormalize', e.target.checked) });
  const toolbar = h('div.panel-toolbar.analysis-toolbar', modeSel, samplesSel, h('label.check', { title: 'Scale quiet audio up to fill the scope' }, normBox, 'Normalize'));
  // Density mode accumulates points into a grid that fades a little every frame.
  const GRID = 160;
  const density = new Float32Array(GRID * GRID);
  const scope = h('canvas', { 'aria-hidden': 'true' });
  const scopeWrap = h('div.phase-scope', scope);
  const meterCanvas = h('canvas', { 'aria-hidden': 'true' });
  const meter = h('div.phase-meter', { role: 'meter', 'aria-label': 'Phase correlation', 'aria-valuemin': '-1', 'aria-valuemax': '1', 'aria-valuenow': '0' }, meterCanvas);
  const value = h('div.phase-value', '0.00');
  const el = h('div.analysis-panel.phase-panel', toolbar, scopeWrap, h('div.phase-bottom', meter, value));

  let visible = false;
  let raf = 0;
  let block = null;
  let corr = 0;
  let clearTrail = true;
  let lastSpoken = 0;
  let seen = false;

  const tap = masterTap(app, (m) => {
    if (!visible) return;
    block = m;
    seen = true;
    const c = correlation(m.L.subarray(m.L.length - 4096), m.R.subarray(m.R.length - 4096));
    corr = corr * 0.7 + c * 0.3;
    schedule();
  });

  const schedule = () => {
    if (!raf && visible) raf = requestAnimationFrame(draw);
  };

  const draw = () => {
    raf = 0;
    drawScope();
    drawMeter();
    value.textContent = (corr >= 0 ? '+' : '') + corr.toFixed(2);
    const now = performance.now();
    if (now - lastSpoken > 1000) {
      meter.setAttribute('aria-valuenow', corr.toFixed(2));
      meter.setAttribute('aria-valuetext', `${corr.toFixed(2)}, ${corr > 0.5 ? 'mostly mono' : corr > 0 ? 'wide stereo' : corr > -0.3 ? 'very wide, check mono compatibility' : 'out of phase'}`);
      lastSpoken = now;
    }
    if (!app.engine.playing && block) {
      // Let the trail fade out after playback stops.
      block = null;
      corr *= 0.5;
      schedule();
    }
  };

  const drawScope = () => {
    const W = scopeWrap.clientWidth;
    const H = scopeWrap.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (scope.width !== Math.round(W * dpr) || scope.height !== Math.round(H * dpr)) {
      scope.width = Math.round(W * dpr);
      scope.height = Math.round(H * dpr);
      scope.style.width = `${W}px`;
      scope.style.height = `${H}px`;
      clearTrail = true;
    }
    const ctx = scope.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = cssVar('--bg-editor');
    // Persistence: fade the previous frame rather than clearing it.
    ctx.globalAlpha = clearTrail ? 1 : 0.35;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    clearTrail = false;
    const size = Math.min(W, H) - 16;
    const cx = W / 2;
    const cy = H / 2;
    const r = size / 2;
    const mode = app.prefs.get('phaseMode') || 'gonio';
    const xy = mode === 'xy';
    // Axes.
    ctx.strokeStyle = cssVar('--grid-strong');
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (xy) {
      ctx.rect(cx - r, cy - r, size, size);
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
    } else {
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
    }
    ctx.stroke();
    ctx.font = CANVAS_FONT;
    ctx.fillStyle = cssVar('--text-faint');
    ctx.textAlign = 'center';
    if (xy) {
      ctx.fillText('L', cx + r - 6, cy - 4);
      ctx.fillText('R', cx + 6, cy - r + 10);
    } else {
      ctx.fillText('M', cx + 8, cy - r + 10);
      ctx.fillText('L', cx - r / 2 - 6, cy - r / 2 - 2);
      ctx.fillText('R', cx + r / 2 + 6, cy - r / 2 - 2);
      ctx.fillText('S', cx + r - 6, cy - 4);
    }
    if (!block) {
      if (!app.engine.playing && !seen) {
        ctx.fillStyle = cssVar('--text-dim');
        ctx.fillText('Play audio to see the stereo image', cx, cy + r * 0.55);
      }
      return;
    }
    const { L, R } = block;
    const color = cssVar('--wave');
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const n = Math.min(L.length, app.prefs.get('phaseSamples') || 2048);
    const off = L.length - n;
    // Normalize: scale so the loudest sample of this frame reaches the edge.
    let gain = 1;
    if (app.prefs.get('phaseNormalize')) {
      let peak = 0;
      for (let i = off; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      if (peak > 1e-4) gain = Math.min(30, 1 / peak);
    }
    const k = r * 0.95;
    const point = (i, out) => {
      const l = L[off + i] * gain;
      const rr = R[off + i] * gain;
      // X/Y plots left against right; the goniometer rotates 45 degrees (side right, mid up).
      const x = xy ? l : (rr - l) * Math.SQRT1_2;
      const y = xy ? rr : (l + rr) * Math.SQRT1_2;
      out[0] = Math.max(-1, Math.min(1, x));
      out[1] = Math.max(-1, Math.min(1, y));
      return out;
    };
    const p = [0, 0];
    if (mode === 'density') {
      for (let i = 0; i < density.length; i++) density[i] *= 0.9;
      for (let i = 0; i < n; i++) {
        point(i, p);
        const gx = Math.min(GRID - 1, Math.floor(((p[0] + 1) / 2) * GRID));
        const gy = Math.min(GRID - 1, Math.floor(((1 - p[1]) / 2) * GRID));
        density[gy * GRID + gx] += 1;
      }
      drawDensity(ctx, cx - k, cy - k, 2 * k, color);
    } else if (mode === 'lines') {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        point(i, p);
        const px = cx + p[0] * k;
        const py = cy - p[1] * k;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      for (let i = 0; i < n; i++) {
        point(i, p);
        ctx.fillRect(cx + p[0] * k, cy - p[1] * k, 1.2, 1.2);
      }
    }
  };

  /** Density map: log-scaled counts as the opacity of the waveform color. */
  const drawDensity = (ctx, x0, y0, size, color) => {
    let max = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > max) max = density[i];
    if (max <= 0) return;
    const img = new ImageData(GRID, GRID);
    const [r, g, b] = color.startsWith('#') ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : [63, 224, 165];
    const lmax = Math.log1p(max);
    for (let i = 0; i < density.length; i++) {
      const a = density[i] > 0 ? Math.log1p(density[i]) / lmax : 0;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = Math.round(a * 255);
    }
    const tmp = (drawDensity.canvas ||= document.createElement('canvas'));
    tmp.width = GRID;
    tmp.height = GRID;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, x0, y0, size, size);
  };

  const drawMeter = () => {
    const fit = fitCanvas(meterCanvas, meter);
    if (!fit) return;
    const { ctx, W, H } = fit;
    const pad = 8;
    const w = W - pad * 2;
    const y = 4;
    const bh = Math.max(6, H - 18);
    ctx.fillStyle = cssVar('--meter-bg');
    ctx.fillRect(pad, y, w, bh);
    const xOf = (v) => pad + ((v + 1) / 2) * w;
    // Red zone below zero, green above.
    ctx.fillStyle = corr < 0 ? cssVar('--meter-red') : cssVar('--meter-green');
    const a = xOf(0);
    const b = xOf(corr);
    ctx.fillRect(Math.min(a, b), y, Math.abs(b - a), bh);
    ctx.fillStyle = cssVar('--text-strong');
    ctx.fillRect(Math.round(b) - 1, y - 2, 2, bh + 4);
    ctx.font = CANVAS_FONT;
    ctx.fillStyle = cssVar('--text-dim');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const x = xOf(v);
      ctx.fillRect(Math.round(x), y + bh, 1, 3);
      ctx.fillText(v === 0 ? '0' : v > 0 ? `+${v}` : String(v), x, y + bh + 3);
    }
  };

  const ro = new ResizeObserver(() => {
    clearTrail = true;
    schedule();
  });
  ro.observe(scopeWrap);
  ro.observe(meter);
  app.on('transport', () => schedule());
  // Keep the toolbar in step with the preferences (another window or a script may change them).
  app.prefs.on('change', (key) => {
    if (key === 'phaseMode') {
      modeSel.value = app.prefs.get('phaseMode') || 'gonio';
      density.fill(0);
      clearTrail = true;
    } else if (key === 'phaseSamples') samplesSel.value = String(app.prefs.get('phaseSamples') || 2048);
    else if (key === 'phaseNormalize') normBox.checked = Boolean(app.prefs.get('phaseNormalize'));
    else return;
    schedule();
  });
  window.addEventListener('themechange', () => {
    clearTrail = true;
    schedule();
  });

  return {
    el,
    show() {
      visible = true;
      clearTrail = true;
      tap.start();
      schedule();
    },
    hide() {
      visible = false;
      tap.stop();
    },
  };
}
