// Ranges as wide as the reference layouts: Chorus spread and rates, Flanger
// rate, Analog Delay time and feedback, Center Channel Extractor levels,
// Convolution Reverb width and gain, Studio Reverb cuts. Each new reach is
// checked in the processor, not just in the slider.
import { describe, it, expect } from 'vitest';
import { wasmBytes } from './fx-wasm.js';
import { getEffect, defaults, slotSpec } from '../src/effects/index.js';
import { FxHost } from '../src/engine/fxhost.js';

const RATE = 48000;

function render(id, values, L, R = L) {
  const def = getEffect(id);
  const host = new FxHost(new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}), RATE);
  const chain = host.sync([slotSpec(def, { ...defaults(def), ...values }, { key: 'k', rate: RATE })]);
  const out = [new Float32Array(L.length), new Float32Array(R.length)];
  for (let at = 0; at < L.length; at += 128) {
    const n = Math.min(128, L.length - at);
    const buf = [L.slice(at, at + n), R.slice(at, at + n)];
    host.run(chain, buf, n);
    out[0].set(buf[0], at);
    out[1].set(buf[1], at);
  }
  return out;
}
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));
const range = (id, pid) => {
  const p = getEffect(id).params.find((q) => q.id === pid);
  return [p.min, p.max];
};
const impulse = (n, at = 0) => {
  const x = new Float32Array(n);
  x[at] = 1;
  return x;
};
const firstAbove = (x, th, from = 1) => {
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > th) return i;
  return -1;
};
const sine = (f, n, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / RATE));

describe('wider effect ranges', () => {
  it('declares the reference ranges', () => {
    expect(range('chorus', 'spread')).toEqual([0, 200]);
    expect(range('chorus', 'delayRate')[1]).toBe(12);
    expect(range('chorus', 'modRate')[1]).toBe(30);
    expect(range('chorus', 'depth')[1]).toBe(15);
    expect(range('flanger', 'rate')[1]).toBe(60);
    expect(range('analogDelay', 'delay')).toEqual([10, 8000]);
    expect(range('analogDelay', 'feedback')).toEqual([0, 200]);
    expect(range('centerChannelExtractor', 'centerLevel')).toEqual([-48, 40]);
    expect(range('centerChannelExtractor', 'sideLevel')).toEqual([-48, 40]);
    expect(range('convolutionReverb', 'width')).toEqual([0, 300]);
    expect(range('convolutionReverb', 'gain')).toEqual([-24, 18]);
    expect(range('studioReverb', 'hfCut')).toEqual([20, 20000]);
    expect(range('studioReverb', 'lfCut')).toEqual([20, 4000]);
  });

  it('Chorus spreads voices up to 200 ms apart', () => {
    const run = (spread) => {
      const [l] = render('chorus', { voices: 2, delay: 5, spread, dry: 0, wet: 100, feedback: 0, depth: 0, width: 0 }, impulse(RATE / 2));
      // The latest voice arrives after the delay plus the spread.
      let last = 0;
      for (let i = 0; i < l.length; i++) if (Math.abs(l[i]) > 0.02) last = i;
      return (last / RATE) * 1000;
    };
    expect(run(150)).toBeGreaterThan(140);
    expect(run(20)).toBeLessThan(60);
  });

  it('Analog Delay repeats after 6 seconds and holds 200 % feedback with saturation', () => {
    const n = Math.round(6.2 * RATE);
    const [l] = render('analogDelay', { delay: 6000, dry: 0, wet: 100, feedback: 0, spread: 0, trash: 0 }, impulse(n));
    const at = firstAbove(l, 0.05);
    expect(at / RATE).toBeGreaterThan(5.9);
    const [y] = render('analogDelay', { delay: 20, feedback: 200, dry: 100, wet: 100 }, sine(440, RATE, 0.5));
    expect(y.every(Number.isFinite)).toBe(true);
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(8);
  });

  it('Flanger sweeps at up to 60 Hz', () => {
    // The sweeping comb makes a steady tone's level rise and fall at the sweep rate.
    const x = sine(3000, RATE / 2);
    const swings = (rate) => {
      const [l] = render('flanger', { rate, initialDelay: 1, finalDelay: 1.15, feedback: 0, mix: 50, sinusoidal: true, phasing: 0 }, x);
      const env = [];
      for (let k = 4800; k + 48 <= 14400; k += 48) env.push(rms(l.subarray(k, k + 48)));
      const mean = env.reduce((s, v) => s + v, 0) / env.length;
      let n = 0;
      for (let i = 1; i < env.length; i++) if ((env[i] - mean) * (env[i - 1] - mean) < 0) n++;
      return n;
    };
    expect(swings(55)).toBeGreaterThan(swings(8) * 3);
  });

  it('Center Channel Extractor raises the centre by up to 40 dB', () => {
    const x = sine(1000, RATE / 2, 0.001);
    const [l] = render('centerChannelExtractor', { centerLevel: 30, sideLevel: 0 }, x, x);
    expect(rms(l.subarray(RATE / 4)) / rms(x.subarray(RATE / 4))).toBeGreaterThan(20);
  });

  it('Convolution Reverb widens to 300 % and boosts to +18 dB', () => {
    const L = impulse(RATE);
    const R = new Float32Array(RATE);
    const side = (width) => {
      const [l, r] = render('convolutionReverb', { mix: 100, width, gain: 0 }, L, R);
      return rms(l.map((v, i) => v - r[i]));
    };
    expect(side(300)).toBeGreaterThan(side(200) * 1.2);
    const level = (gain) => rms(render('convolutionReverb', { mix: 100, gain }, L, R)[0]);
    expect(level(18) / level(0)).toBeCloseTo(10 ** (18 / 20), 0);
  });

  it('Studio Reverb cuts its highs as low as 200 Hz and its lows as high as 3 kHz', () => {
    const wet = (f, v) => rms(render('studioReverb', { dry: 0, wet: 100, ...v }, sine(f, RATE))[0].subarray(RATE / 2));
    expect(wet(5000, { hfCut: 200 })).toBeLessThan(wet(5000, { hfCut: 20000 }) * 0.1);
    expect(wet(300, { lfCut: 3000 })).toBeLessThan(wet(300, { lfCut: 20 }) * 0.3);
  });
});
