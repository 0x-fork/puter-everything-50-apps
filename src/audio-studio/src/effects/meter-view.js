// Live display of the Loudness Meter effect: momentary, short-term and
// integrated loudness as bars around the target, the loudness range, true
// peak and maxima as numbers, and a scrolling history of the last minute.
// It is fed by the effect's readout (wasm/dsp/src/fx/special/meter.rs) while
// audio plays through the effect: a dialog preview, the Effects Rack or a
// track's effects. "Measure Selection" measures the selection offline with
// the same BS.1770-4 meter (analysis/loudness.js) without playing it.

import { h, announce } from '../lib/dom.js';
import { cssVar } from '../ui/theme.js';
import { plot, gridLines, labelText } from './editors.js';
import { measureLoudness } from '../analysis/loudness.js';

const HISTORY_SECONDS = 60;
const STALE_MS = 700;

/** Readout array to named readings (see meter.rs). */
export function readLoudness(v) {
  const tp = Math.max(v[4] || 0, v[5] || 0);
  return {
    momentary: v[0],
    shortTerm: v[1],
    integrated: v[2],
    range: v[3],
    truePeakDb: tp > 0 ? 20 * Math.log10(tp) : -Infinity,
    maxMomentary: v[6],
    maxShortTerm: v[7],
    seconds: v[8],
  };
}

/** Display range of the bars in LUFS: target -18/+9 LU or -36/+18 LU. */
export function meterRange(values) {
  const wide = Number(values.scale) === 1;
  return { lo: values.target - (wide ? 36 : 18), hi: values.target + (wide ? 18 : 9) };
}

const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '-∞');

function formatTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Editor factory for definitions with display: 'loudness'. */
export function loudnessMeterEditor() {
  return (ctx) => {
    let reading = null;
    let staleTimer = 0;
    // Short-term and momentary history: [{ t (s), m, s }].
    const history = [];

    const bar = (key, label) => {
      const fill = h('div.lm-fill');
      const target = h('div.lm-target', { title: 'Target' });
      const value = h('span.lm-value.tabular', '-∞');
      const track = h('div.lm-track', { role: 'meter', 'aria-label': `${label} loudness`, 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill, target);
      return { key, el: h('div.lm-row', h('span.lm-label', label), track, value), fill, target, value, track };
    };
    const bars = [bar('momentary', 'Momentary'), bar('shortTerm', 'Short-term'), bar('integrated', 'Integrated')];
    const stat = (label, unit) => {
      const value = h('span.lm-stat-value.tabular', '-');
      return { el: h('div.lm-stat', h('span.lm-stat-label', label), h('span.lm-stat-line', value, h('span.lm-unit', unit))), value };
    };
    const stats = {
      range: stat('Loudness Range', 'LU'),
      truePeak: stat('True Peak', 'dBTP'),
      maxMomentary: stat('Max Momentary', 'LUFS'),
      maxShortTerm: stat('Max Short-term', 'LUFS'),
      time: stat('Measured', ''),
    };

    const graph = plot('lm-history', 'Loudness history', (g, W, H) => {
      const { lo, hi } = meterRange(ctx.values);
      const yOf = (v) => H - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H;
      const ticks = [];
      for (let v = Math.ceil(lo / 6) * 6; v <= hi; v += 6) ticks.push(v);
      gridLines(g, W, H, [], ticks.map(yOf));
      ticks.forEach((v) => labelText(g, String(v), 3, yOf(v) + 1));
      g.strokeStyle = cssVar('--accent');
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(0, Math.round(yOf(ctx.values.target)) + 0.5);
      g.lineTo(W, Math.round(yOf(ctx.values.target)) + 0.5);
      g.stroke();
      g.setLineDash([]);
      if (history.length < 2) return;
      const end = history[history.length - 1].t;
      const xOf = (t) => W - ((end - t) / HISTORY_SECONDS) * W;
      const line = (key, color, width) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        let on = false;
        for (const p of history) {
          if (!Number.isFinite(p[key])) {
            on = false;
            continue;
          }
          const x = xOf(p.t);
          const y = yOf(p[key]);
          if (on) g.lineTo(x, y);
          else g.moveTo(x, y);
          on = true;
        }
        g.stroke();
      };
      line('m', cssVar('--wave-dim'), 1);
      line('s', cssVar('--wave'), 2);
    });

    const hint = h('div.lm-hint.faint');
    const offlineBtn = h('button.btn', { type: 'button', disabled: !ctx.doc }, 'Measure Selection');
    const offlineText = h('span.lm-offline-text.faint', { 'aria-live': 'polite' });
    offlineBtn.addEventListener('click', () => measureOffline());

    const el = h(
      'div.lm-view',
      h('div.lm-bars', bars.map((b) => b.el)),
      h('div.lm-stats', Object.values(stats).map((s) => s.el)),
      graph.el,
      hint,
      h('div.lm-offline', offlineBtn, offlineText),
    );

    function render() {
      const { lo, hi } = meterRange(ctx.values);
      const frac = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0);
      for (const b of bars) {
        const v = reading ? reading[b.key] : -Infinity;
        b.fill.style.transform = `scaleX(${frac(v)})`;
        b.fill.classList.toggle('over', Number.isFinite(v) && v > ctx.values.target + 1);
        b.target.style.left = `${frac(ctx.values.target) * 100}%`;
        b.value.textContent = `${fmt(v)} LUFS`;
        b.track.setAttribute('aria-valuenow', String(Math.round(frac(v) * 100)));
        b.track.setAttribute('aria-valuetext', `${fmt(v)} LUFS`);
      }
      const r = reading;
      stats.range.value.textContent = r ? fmt(r.range) : '-';
      stats.truePeak.value.textContent = r ? fmt(r.truePeakDb) : '-';
      stats.truePeak.el.classList.toggle('over', Boolean(r && r.truePeakDb > ctx.values.peakCeiling));
      stats.maxMomentary.value.textContent = r ? fmt(r.maxMomentary) : '-';
      stats.maxShortTerm.value.textContent = r ? fmt(r.maxShortTerm) : '-';
      stats.time.value.textContent = r ? formatTime(r.seconds) : '-';
      hint.textContent = reading
        ? `Measuring since playback started. Integrated loudness is ${Number.isFinite(r.integrated) ? `${fmt(Math.abs(r.integrated - ctx.values.target))} LU ${r.integrated > ctx.values.target ? 'above' : 'below'} the target` : 'not available yet'}.`
        : 'Play audio through the effect (Preview, the Effects Rack or a track) to measure it. Measurement restarts when playback starts.';
      graph.redraw();
    }

    ctx.onReadout?.((v) => {
      if (v.length < 9) return;
      reading = readLoudness(v);
      if (history.length && reading.seconds < history[history.length - 1].t) history.length = 0; // restarted
      history.push({ t: reading.seconds, m: reading.momentary, s: reading.shortTerm });
      while (history.length && history[0].t < reading.seconds - HISTORY_SECONDS) history.shift();
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        // Playback stopped: keep the last values, only the hint changes.
        hint.textContent = 'Stopped. Start playback to measure again.';
      }, STALE_MS);
      render();
    });
    ctx.onClose?.(() => clearTimeout(staleTimer));
    ctx.subscribe?.(() => render());

    async function measureOffline() {
      const doc = ctx.doc;
      if (!doc) return;
      const [start, end] = doc.editRange();
      if (end <= start) return;
      offlineBtn.disabled = true;
      offlineText.textContent = 'Measuring...';
      try {
        const state = { sampleRate: doc.sampleRate, channels: doc.state.channels.map((c) => c.slice(start, end)) };
        const m = await measureLoudness(state);
        const where = doc.hasSelection ? 'Selection' : 'File';
        offlineText.textContent = `${where}: ${fmt(m.integrated)} LUFS integrated, ${fmt(m.range)} LU range, ${fmt(m.truePeakDb)} dBTP true peak.`;
        announce(offlineText.textContent);
      } catch (err) {
        offlineText.textContent = `Could not measure: ${err?.message || err}`;
      } finally {
        offlineBtn.disabled = false;
      }
    }

    render();
    return el;
  };
}
