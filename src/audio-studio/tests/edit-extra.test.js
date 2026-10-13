import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { findZeroCrossing, splitBands, defaultCrossovers, crossoverProblem } from '../src/commands/edit-extra.js';

const sine = (n, period, phase = 0) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * (i + phase)) / period));
const state = (...chans) => ({ sampleRate: 1000, channels: chans.map((c) => Channel.fromSamples(c)), markers: [] });
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('zero crossings', () => {
  it('finds the nearest crossing in each direction', () => {
    // Crossings of a 100-sample sine sit at 0, 50, 100, ...
    const s = state(sine(400, 100, 0.5));
    expect(findZeroCrossing(s, 120, -1)).toBe(100);
    expect(findZeroCrossing(s, 120, 1)).toBe(150);
  });

  it('uses the sum of the enabled channels only', () => {
    const left = sine(400, 100, 0.5);
    const right = sine(400, 80, 0.5);
    const s = state(left, right);
    expect(findZeroCrossing(s, 125, 1, [false, true])).toBe(160);
    expect(findZeroCrossing(s, 125, 1, [true, false])).toBe(150);
  });

  it('returns the frame unchanged when there is no crossing', () => {
    const s = state(new Float32Array(100).fill(0.5));
    expect(findZeroCrossing(s, 40, 1)).toBe(40);
    expect(findZeroCrossing(s, 40, -1)).toBe(40);
  });
});

describe('frequency band splitter', () => {
  it('separates low and high tones into their bands', () => {
    const rate = 48000;
    const low = sine(rate, rate / 100);
    const high = sine(rate, rate / 8000);
    const mix = low.map((v, i) => v + high[i]);
    const [lo, hi] = splitBands(mix, [1000], rate);
    // Skip the filter warm-up.
    const tail = (x) => x.subarray(4800);
    expect(rms(tail(lo))).toBeGreaterThan(0.69);
    expect(rms(tail(lo))).toBeLessThan(0.72);
    expect(rms(tail(hi))).toBeGreaterThan(0.69);
    expect(rms(tail(hi))).toBeLessThan(0.72);
  });

  it('bands add back up with a flat magnitude', () => {
    const rate = 48000;
    let seed = 7;
    const noise = Float32Array.from({ length: rate }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5));
    const bands = splitBands(noise, [200, 1500, 6000], rate);
    expect(bands).toHaveLength(4);
    const sum = new Float32Array(noise.length);
    for (const b of bands) for (let i = 0; i < b.length; i++) sum[i] += b[i];
    expect(rms(sum.subarray(4800)) / rms(noise.subarray(4800))).toBeCloseTo(1, 1);
  });

  it('suggests ascending crossovers and validates them', () => {
    const f = defaultCrossovers(5, 48000);
    expect(f).toHaveLength(4);
    expect(f.every((v, i) => !i || v > f[i - 1])).toBe(true);
    expect(crossoverProblem(f, 48000)).toBe('');
    expect(crossoverProblem([500, 510], 48000)).toMatch(/apart/);
    expect(crossoverProblem([10], 48000)).toMatch(/between/);
  });
});
