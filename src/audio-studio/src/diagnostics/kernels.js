// Diagnostics kernels: detection-only and windowed repair operations on one
// block of samples, run in the diagnostics worker (or in place in tests).
// Click detection and repair, and declipping, are the Rust kernels behind
// the DeClicker and DeClipper effects (wasm/dsp/src/fx/restore); window
// peaks are the kernel behind Delete Silence and Mark Audio.

const MAX_CLICKS = 1 << 16;

/** DeClicker parameters (effect values) to kernel settings, as the effect maps them. */
export function clickSettings(v) {
  const k = 2 + (100 - v.sensitivity) * 0.15;
  return { k, disc: k * (1 + v.discrimination / 100), maxRun: Math.round(v.runSize * (v.bigPops ? 4 : 1)), oversample: v.oversample / 100, passes: Math.max(1, Math.round(v.passes)) };
}

export const ops = {
  /** Click runs in `samples`: Float32Array of (start, length, peak) triples. */
  clicks(d, { samples, k, disc, maxRun, oversample }) {
    const buf = d.copyIn(samples);
    const out = d.floats(MAX_CLICKS * 3);
    const n = d.x.rs_click_detect(buf.ptr, samples.length, k, disc, maxRun, oversample, out.ptr, MAX_CLICKS);
    const result = out.view().slice(0, Math.min(n, MAX_CLICKS) * 3);
    buf.free();
    out.free();
    return result;
  },

  /**
   * Clipped runs: at least `minRun` samples at or beyond `level` (same sign)
   * that also sit flat, as a clipped waveform does. Rounded peaks (a loud sine
   * near the file's maximum) vary from sample to sample and are not clipping.
   * Float32Array of (start, length) pairs.
   */
  clips(d, { samples, level, minRun }) {
    const flat = Math.max(level * 0.002, 1 / 32768);
    const out = [];
    const n = samples.length;
    let i = 0;
    while (i < n) {
      const v = samples[i];
      if ((v < 0 ? -v : v) < level) {
        i++;
        continue;
      }
      const sign = v < 0 ? -1 : 1;
      const s = i;
      let lo = v;
      let hi = v;
      while (i < n && Math.abs(samples[i]) >= level && Math.sign(samples[i]) === sign) {
        if (samples[i] < lo) lo = samples[i];
        if (samples[i] > hi) hi = samples[i];
        i++;
      }
      if (i - s >= minRun && hi - lo <= flat) out.push(s, i - s);
    }
    return Float32Array.from(out);
  },

  /** Largest absolute sample. */
  peak(d, { samples }) {
    let m = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] < 0 ? -samples[i] : samples[i];
      if (v > m) m = v;
    }
    return m;
  },

  /** Peak per window of `win` samples. */
  peaks(d, { samples, win }) {
    const n = Math.ceil(samples.length / win);
    const src = d.copyIn(samples);
    const out = d.floats(n);
    d.x.special_peaks(src.ptr, samples.length, win, out.ptr);
    const result = out.view().slice();
    src.free();
    out.free();
    return result;
  },

  /** Click repair over a window (DeClicker kernel); returns the repaired samples. */
  declick(d, { samples, k, disc, maxRun, oversample, passes }) {
    const buf = d.copyIn(samples);
    d.x.rs_declick(buf.ptr, samples.length, k, disc, maxRun, oversample, passes);
    const result = buf.view().slice();
    buf.free();
    return result;
  },

  /** Declipping over a window (DeClipper kernel); returns the repaired samples. */
  declip(d, { samples, level, minRun, method }) {
    const buf = d.copyIn(samples);
    d.x.rs_declip(buf.ptr, samples.length, level, minRun, method);
    const result = buf.view().slice();
    buf.free();
    return result;
  },
};
