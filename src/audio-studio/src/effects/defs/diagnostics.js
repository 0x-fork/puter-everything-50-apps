// Effect definitions: Diagnostics, restoration side (DeClicker and
// DeClipper), and the Click/Pop Eliminator in Noise Reduction / Restoration.
// All are offline processes running WASM kernels from wasm/dsp/src/fx/restore
// (rs_declick, rs_declip) in the effect worker. The Click/Pop Eliminator
// command opens a scan-and-choose dialog (diagnostics/click-pop.js); applied
// with stored settings (a favorite, a batch) it repairs every click it finds.

import { registerEffect } from '../registry.js';
import { offloaded } from '../offline-fx.js';
import { num, db, pct, bool, choice, preset, pause, checkAbort } from './util.js';

const GROUP = 'Diagnostics';

/**
 * Runs an in-place WASM kernel over a channel in overlapping chunks, so
 * memory stays bounded and progress and cancellation work on long files.
 * `fn(ptr, length)` processes one chunk and returns a count.
 */
async function chunked(dsp, samples, fn, { chunk = 1 << 19, context = 4096, signal, onProgress } = {}) {
  const n = samples.length;
  const out = new Float32Array(n);
  let count = 0;
  for (let a = 0; a < n; a += chunk) {
    const lo = Math.max(0, a - context);
    const hi = Math.min(n, a + chunk + context);
    const buf = dsp.copyIn(samples.subarray(lo, hi));
    count += fn(buf.ptr, hi - lo);
    out.set(buf.view().subarray(a - lo, a - lo + Math.min(chunk, n - a)), a);
    buf.free();
    onProgress?.(Math.min(1, (a + chunk) / n));
    checkAbort(signal);
    if (n > chunk) await pause();
  }
  return { out, count };
}

/** DeClicker kernel over every channel (also the Click/Pop Eliminator's process). */
export async function runDeclick({ channels, values, dsp, onProgress, signal }) {
  const k = 2 + (100 - values.sensitivity) * 0.15;
  const disc = k * (1 + values.discrimination / 100);
  const maxRun = Math.round(values.runSize * (values.bigPops ? 4 : 1));
  const out = [];
  for (let c = 0; c < channels.length; c++) {
    const { out: ch } = await chunked(
      dsp,
      channels[c],
      (ptr, len) => dsp.x.rs_declick(ptr, len, k, disc, maxRun, values.oversample / 100, values.passes),
      { signal, onProgress: (f) => onProgress?.((c + f) / channels.length) },
    );
    out.push(ch);
  }
  return out;
}

const clickParams = () => [
  num('sensitivity', 'Detection Sensitivity', 1, 100, 60, '', { step: 1 }),
  num('discrimination', 'Discrimination', 0, 100, 30, '', { step: 1 }),
  num('runSize', 'Maximum Run Size', 2, 250, 32, 'samples', { step: 1 }),
  pct('oversample', 'Pop Oversamples', 50, { max: 300 }),
  num('passes', 'Passes', 1, 5, 2, '', { step: 1 }),
  bool('bigPops', 'Repair Big Pops', false),
];

registerEffect({
  id: 'declicker',
  name: 'DeClicker',
  group: GROUP,
  kind: null,
  params: clickParams(),
  presets: [
    preset('Light Crackle', { sensitivity: 70, discrimination: 20, runSize: 16, oversample: 30, passes: 2, bigPops: false }),
    preset('Old Record', { sensitivity: 60, discrimination: 30, runSize: 48, oversample: 60, passes: 3, bigPops: true }),
    preset('Isolated Pops Only', { sensitivity: 40, discrimination: 70, runSize: 64, oversample: 50, passes: 1, bigPops: true }),
    preset('Digital Clicks', { sensitivity: 55, discrimination: 40, runSize: 8, oversample: 25, passes: 1, bigPops: false }),
  ],
  run: runDeclick,
  process: offloaded('declicker'),
});

// The Click/Pop Eliminator shares the DeClicker's detector and repair; its
// dialog lists what a scan finds so you choose what to repair. Discrimination
// is the repair threshold drawn on the dialog's detection graph.
registerEffect({
  id: 'clickPopEliminator',
  name: 'Click/Pop Eliminator (process)',
  group: 'Noise Reduction / Restoration',
  kind: null,
  // Discrimination reaches 400 here: a repair threshold up to 5x the detection level.
  params: clickParams().map((p) => (p.id === 'discrimination' ? { ...p, max: 400 } : p)),
  presets: [
    preset('Default', {}),
    preset('Light Crackle', { sensitivity: 70, discrimination: 20, runSize: 16, oversample: 30, passes: 2, bigPops: false }),
    preset('Vinyl Clicks and Pops', { sensitivity: 60, discrimination: 30, runSize: 48, oversample: 60, passes: 3, bigPops: true }),
    preset('Isolated Pops Only', { sensitivity: 40, discrimination: 70, runSize: 64, oversample: 50, passes: 1, bigPops: true }),
    preset('Digital Clicks', { sensitivity: 55, discrimination: 40, runSize: 8, oversample: 25, passes: 1, bigPops: false }),
  ],
  run: runDeclick,
  process: offloaded('clickPopEliminator'),
});

registerEffect({
  id: 'declipper',
  name: 'DeClipper',
  group: GROUP,
  kind: null,
  params: [
    db('gain', 'Gain', -24, 0, -3),
    num('tolerance', 'Tolerance', 0, 20, 1, '%', { step: 0.1 }),
    num('minRun', 'Minimum Clip Size', 1, 50, 3, 'samples', { step: 1 }),
    choice('method', 'Interpolation', ['Cubic Spline', 'Linear Prediction'], 0),
  ],
  presets: [
    preset('Restore Light Clipping', { gain: -3, tolerance: 1, minRun: 3, method: 0 }),
    preset('Restore Heavy Clipping', { gain: -6, tolerance: 2, minRun: 2, method: 1 }),
    preset('Hot Digital Master', { gain: -4, tolerance: 0.5, minRun: 4, method: 1 }),
    preset('Overdriven Recorder', { gain: -8, tolerance: 5, minRun: 3, method: 0 }),
  ],
  run: async ({ channels, values, dsp, onProgress, signal }) => {
    // The clip level is found from the loudest sample across every channel.
    let peak = 0;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const g = 10 ** (values.gain / 20);
    if (peak <= 0) return channels.map((c) => c.slice());
    const level = peak * (1 - values.tolerance / 100) * 0.99999;
    const out = [];
    for (let c = 0; c < channels.length; c++) {
      const { out: ch } = await chunked(dsp, channels[c], (ptr, len) => dsp.x.rs_declip(ptr, len, level, values.minRun, values.method), {
        signal,
        context: 2048,
        onProgress: (f) => onProgress?.((c + f) / channels.length),
      });
      for (let i = 0; i < ch.length; i++) ch[i] *= g;
      out.push(ch);
    }
    return out;
  },
  process: offloaded('declipper'),
});
