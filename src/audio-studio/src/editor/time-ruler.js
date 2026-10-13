// Time ruler with tick labels in the chosen time format, markers, and the
// playhead handle. Click or drag to move the playhead; drag a marker to move
// it; double-click a marker to rename it. Shared by the waveform and
// multitrack editors through a small host interface:
//   host.timeline() -> { rate, length, view: {start, end}, cursor, selection, markers }
//   host.seek(frame), host.moveMarker(id, start), host.renameMarker(id), host.snap(frame)

import { h } from '../lib/dom.js';
import { rulerStep, rulerLabel, formatTime, musicalStep } from '../lib/time.js';
import { cssVar, CANVAS_FONT } from '../ui/theme.js';
import { markerColor } from '../ui/appearance.js';

export class TimeRuler {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.canvas = h('canvas.time-ruler-canvas', { 'aria-hidden': 'true' });
    this.el = h('div.time-ruler', { role: 'slider', tabindex: '-1', 'aria-label': 'Time ruler, playhead position' }, this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.drag = null;
    this.el.addEventListener('pointerdown', (e) => this.#down(e));
    this.el.addEventListener('pointermove', (e) => this.#move(e));
    this.el.addEventListener('pointerup', (e) => this.#up(e));
    this.el.addEventListener('pointercancel', (e) => this.#up(e));
    this.el.addEventListener('dblclick', (e) => {
      const m = this.#markerAt(e.offsetX);
      if (m) host.renameMarker?.(m.id);
    });
  }

  resize(w, hgt) {
    const dpr = window.devicePixelRatio || 1;
    this.width = w;
    this.height = hgt;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(hgt * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
    this.dpr = dpr;
  }

  xOf(frame) {
    const { view } = this.host.timeline();
    return ((frame - view.start) / (view.end - view.start)) * this.width;
  }

  frameAt(x) {
    const { view } = this.host.timeline();
    return view.start + (x / this.width) * (view.end - view.start);
  }

  #markerAt(x) {
    const t = this.host.timeline();
    for (const m of t.markers || []) {
      const mx = this.xOf(m.start);
      if (Math.abs(x - mx) <= 5) return m;
    }
    return null;
  }

  #down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const m = e.offsetY > this.height * 0.45 ? this.#markerAt(e.offsetX) : null;
    if (m && this.host.moveMarker) {
      this.drag = { kind: 'marker', id: m.id, dx: e.offsetX - this.xOf(m.start), moved: false };
      this.host.selectMarker?.(m.id);
      return;
    }
    this.drag = { kind: 'seek' };
    const f0 = this.host.snap ? this.host.snap(this.frameAt(e.offsetX)) : this.frameAt(e.offsetX);
    this.host.seek(f0);
    this.app.scrub?.(f0);
  }

  #move(e) {
    if (!this.drag) {
      this.el.style.cursor = this.#markerAt(e.offsetX) && e.offsetY > this.height * 0.45 ? 'ew-resize' : '';
      return;
    }
    const f = this.frameAt(e.offsetX - (this.drag.dx || 0));
    if (this.drag.kind === 'seek') {
      const at = this.host.snap ? this.host.snap(f) : f;
      this.host.seek(at);
      this.app.scrub?.(at);
    }
    else if (this.drag.kind === 'marker') {
      this.drag.moved = true;
      this.host.moveMarker(this.drag.id, Math.max(0, this.host.snap ? this.host.snap(f, { exclude: this.drag.id }) : f), { preview: true });
    }
  }

  #up(e) {
    if (!this.drag) return;
    if (this.drag.kind === 'marker' && this.drag.moved) {
      const f = this.frameAt(e.offsetX - (this.drag.dx || 0));
      this.host.moveMarker(this.drag.id, Math.max(0, this.host.snap ? this.host.snap(f, { exclude: this.drag.id }) : f), { preview: false });
    }
    this.drag = null;
  }

  /** Bars-and-beats ruler: ticks on the beat grid (Time Display tempo, meter and subdivisions). */
  #drawMusical(t, W, H, textColor, tickColor) {
    const ctx = this.ctx;
    const rate = t.rate;
    const fpp = (t.view.end - t.view.start) / W;
    const music = this.app.timeOptions?.() || {};
    const xOf = (f) => (f - t.view.start) / fpp;
    const major = musicalStep(fpp, rate, music, 70);
    const minor = musicalStep(fpp, rate, music, 10);
    ctx.fillStyle = tickColor;
    for (let f = Math.ceil(t.view.start / minor - 1e-9) * minor; f <= t.view.end; f += minor) ctx.fillRect(Math.round(xOf(f)) + 0.5, H - 4, 1, 4);
    for (let f = Math.ceil(t.view.start / major - 1e-9) * major; f <= t.view.end + 1e-6; f += major) {
      const x = Math.round(xOf(f)) + 0.5;
      ctx.fillStyle = tickColor;
      ctx.fillRect(x, H - 9, 1, 9);
      ctx.fillStyle = textColor;
      ctx.fillText(formatTime(Math.round(f), rate, 'bars', music), x + 3, 3);
    }
  }

  draw() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const W = this.width;
    const H = this.height;
    const t = this.host.timeline();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = cssVar('--bg-ruler');
    ctx.fillRect(0, 0, W, H);
    const rate = t.rate;
    const span = t.view.end - t.view.start;
    if (span <= 0 || W <= 0) return;
    const secPerPx = span / rate / W;
    const step = rulerStep(secPerPx, 70);
    const minor = step / (step >= 1 && step % 3 === 0 ? 3 : step >= 60 ? 4 : 5);
    const textColor = cssVar('--text-dim');
    const tickColor = cssVar('--text-faint');
    ctx.font = CANVAS_FONT;
    ctx.textBaseline = 'top';
    const t0 = t.view.start / rate;
    const t1 = t.view.end / rate;
    const format = this.app.prefs.get('timeFormat');
    if (format === 'bars') {
      this.#drawMusical(t, W, H, textColor, tickColor);
    } else {
      ctx.fillStyle = tickColor;
      for (let s = Math.ceil(t0 / minor) * minor; s <= t1; s += minor) {
        const x = Math.round(((s - t0) / (t1 - t0)) * W) + 0.5;
        ctx.fillRect(x, H - 4, 1, 4);
      }
    }
    for (let s = Math.ceil(t0 / step - 1e-9) * step; format !== 'bars' && s <= t1 + 1e-9; s += step) {
      const x = Math.round(((s - t0) / (t1 - t0)) * W) + 0.5;
      ctx.fillStyle = tickColor;
      ctx.fillRect(x, H - 9, 1, 9);
      ctx.fillStyle = textColor;
      const label =
        format === 'decimal' || format === 'compact'
          ? rulerLabel(Math.max(0, s), step)
          : formatTime(Math.round(s * rate), rate, format, this.app.timeOptions?.() || {});
      ctx.fillText(label, x + 3, 3);
    }
    // Selection band.
    const sel = t.selection;
    if (sel && sel.end > sel.start) {
      const x0 = Math.max(0, this.xOf(sel.start));
      const x1 = Math.min(W, this.xOf(sel.end));
      if (x1 > x0) {
        ctx.fillStyle = cssVar('--accent-soft');
        ctx.fillRect(x0, H - 6, x1 - x0, 6);
      }
    }
    // Markers.
    for (const m of t.markers || []) {
      const x = Math.round(this.xOf(m.start)) + 0.5;
      const x2 = m.duration ? this.xOf(m.start + m.duration) : x;
      if (x2 < -10 || x > W + 10) continue;
      ctx.fillStyle = m.selected ? cssVar('--text-strong') : markerColor(m.type);
      if (m.duration) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, H - 12, x2 - x, 5);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(x2, H - 12);
        ctx.lineTo(x2 - 5, H - 7);
        ctx.lineTo(x2, H - 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(x, H - 12);
      ctx.lineTo(x + 5, H - 7);
      ctx.lineTo(x, H - 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Draws the playhead handle (a small pentagon) as a DOM element over a ruler. */
export function playheadHandle() {
  return h('div.playhead-handle', { 'aria-hidden': 'true' });
}
