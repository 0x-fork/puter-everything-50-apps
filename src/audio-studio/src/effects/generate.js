// Signal generators for Effects > Generate: tones (with frequency modulation,
// harmonic components and band-limited waveforms) and coloured noise. Pure
// functions over Float32Arrays so they are testable and can move to a Worker.

export const WAVEFORMS = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'square', label: 'Square' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'inverseSawtooth', label: 'Inverse Sawtooth' },
];

export const NOISE_COLORS = [
  { value: 'white', label: 'White' },
  { value: 'pink', label: 'Pink' },
  { value: 'brown', label: 'Brown' },
  { value: 'grey', label: 'Grey' },
];

export const NOISE_STYLES = [
  { value: 'independent', label: 'Independent Channels' },
  { value: 'mono', label: 'Mono (Same on All Channels)' },
  { value: 'inverse', label: 'Inverse (Right Is Inverted Left)' },
];

export const dbToGain = (db) => (db <= -200 ? 0 : Math.pow(10, db / 20));

/** PolyBLEP residual that removes the aliasing of a hard step at phase 0. */
function polyBlep(p, dt) {
  if (dt <= 0) return 0;
  if (p < dt) {
    const x = p / dt;
    return x + x - x * x - 1;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** One sample of a waveform at phase p in [0, 1), band-limited for frequency step dt (cycles per sample). */
export function waveSample(waveform, p, dt = 0) {
  switch (waveform) {
    case 'triangle':
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case 'square': {
      let v = p < 0.5 ? 1 : -1;
      v += polyBlep(p, dt);
      v -= polyBlep((p + 0.5) % 1, dt);
      return v;
    }
    case 'sawtooth':
      return 2 * p - 1 - polyBlep(p, dt);
    case 'inverseSawtooth':
      return -(2 * p - 1 - polyBlep(p, dt));
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/**
 * Tone generator.
 *  base         fundamental frequency (Hz)
 *  components   relative amplitudes (0..1) of harmonics 1, 2, 3...; the sum is
 *               scaled so the combined peak never exceeds the volume
 *  modulateBy   FM deviation in Hz (0 = none), modFreq the modulation rate in Hz
 *  volumeDb     peak level
 */
export function generateTones({ rate, frames, base = 440, components = [1], waveform = 'sine', modulateBy = 0, modFreq = 1, volumeDb = -6, startPhase = 0 }) {
  const out = new Float32Array(Math.max(0, frames | 0));
  const amps = components.map((a) => Math.max(0, Number(a) || 0));
  const sum = amps.reduce((s, a) => s + a, 0);
  if (!sum || !out.length) return out;
  const gain = dbToGain(volumeDb) / sum;
  const nyquist = rate / 2;
  const phases = amps.map(() => ((startPhase % 360) + 360) % 360 / 360);
  for (let i = 0; i < out.length; i++) {
    const inst = base + (modulateBy ? modulateBy * Math.sin((2 * Math.PI * modFreq * i) / rate) : 0);
    let v = 0;
    for (let k = 0; k < amps.length; k++) {
      const f = inst * (k + 1);
      const dt = Math.abs(f) / rate;
      if (amps[k] > 0 && Math.abs(f) < nyquist) v += amps[k] * waveSample(waveform, phases[k], dt);
      let p = phases[k] + f / rate;
      p -= Math.floor(p);
      phases[k] = p;
    }
    out[i] = v * gain;
  }
  return out;
}

/** Small, fast, seedable PRNG (mulberry32) returning [0, 1). */
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coloured noise filter state; next(white) returns the coloured sample (about unit peak). */
function colorFilter(color) {
  if (color === 'pink') {
    // Paul Kellet's refined pink filter (within 0.05 dB above 9.2 Hz at 44.1 kHz).
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return (w) => {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return v * 0.11;
    };
  }
  if (color === 'brown') {
    let last = 0;
    return (w) => {
      last = (last + 0.02 * w) / 1.02;
      return last * 3.5;
    };
  }
  if (color === 'grey') {
    // Approximates equal perceived loudness across the band: more energy in
    // the lows and highs than pink noise, less in the 2 to 5 kHz region.
    const pink = colorFilter('pink');
    const brown = colorFilter('brown');
    let hp = 0;
    let prev = 0;
    return (w) => {
      hp = 0.6 * (hp + w - prev);
      prev = w;
      return 0.55 * brown(w) + 0.25 * pink(w) + 0.35 * hp;
    };
  }
  return (w) => w;
}

/**
 * Noise generator. Returns one Float32Array per channel, peak-normalised to volumeDb.
 *  intensity  0..1 blend from white (0) to the full colour (1)
 *  style      'independent' | 'mono' | 'inverse'
 */
export function generateNoise({ frames, channels = 1, color = 'white', intensity = 1, volumeDb = -6, style = 'independent', seed = 12345 }) {
  frames = Math.max(0, frames | 0);
  const random = rng(seed);
  const make = () => {
    const f = colorFilter(color);
    const out = new Float32Array(frames);
    const mix = color === 'white' ? 0 : Math.min(1, Math.max(0, intensity));
    for (let i = 0; i < frames; i++) {
      const w = random() * 2 - 1;
      out[i] = mix * f(w) + (1 - mix) * w;
    }
    return out;
  };
  const outs = [];
  const first = make();
  outs.push(first);
  for (let c = 1; c < channels; c++) {
    if (style === 'mono') outs.push(first.slice());
    else if (style === 'inverse') outs.push(first.map((v) => -v));
    else outs.push(make());
  }
  let peak = 0;
  for (const o of outs) for (let i = 0; i < o.length; i++) peak = Math.max(peak, Math.abs(o[i]));
  const g = peak > 0 ? dbToGain(volumeDb) / peak : 0;
  for (const o of outs) for (let i = 0; i < o.length; i++) o[i] *= g;
  return outs;
}
