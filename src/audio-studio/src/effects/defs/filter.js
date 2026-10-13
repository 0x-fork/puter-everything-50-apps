// Effect definitions: Filter and EQ (WASM kinds 10..16, wasm/dsp/src/fx/filter).

import { registerEffect } from '../registry.js';
import { num, db, hz, bool, choice, section, preset, packCurve, dataId } from './util.js';
import * as F from './filter-math.js';

const GROUP = 'Filter and EQ';

const SLOPES = [
  { value: 1, label: '6 dB/oct' },
  { value: 2, label: '12 dB/oct' },
  { value: 3, label: '18 dB/oct' },
  { value: 4, label: '24 dB/oct' },
  { value: 6, label: '36 dB/oct' },
  { value: 8, label: '48 dB/oct' },
];

const qParam = (def, max = 100) => num('q', 'Q', 0.1, max, def, '', { step: 0.01, scale: 'log' });

// ------------------------------------------------------------ Parametric EQ

const BAND_FREQS = [120, 400, 1000, 3000, 8000];

const parametricParams = [
  db('gain', 'Master Gain', -24, 24, 0),
  choice('qMode', 'Band Shape', ['Constant Q', 'Proportional Q'], 0),
  ...section('High Pass', 'hp', [bool('on', 'On', false), hz('freq', 'Frequency', 10, 20000, 60), choice('slope', 'Slope', SLOPES, 2)]),
  ...section('Low Shelf', 'ls', [bool('on', 'On', false), hz('freq', 'Frequency', 10, 20000, 100), db('gain', 'Gain', -30, 30, 0), qParam(0.7071, 4)]),
  ...BAND_FREQS.flatMap((f, i) => section(`Band ${i + 1}`, `band${i + 1}`, [bool('on', 'On', true), hz('freq', 'Frequency', 10, 20000, f), db('gain', 'Gain', -30, 30, 0), qParam(1)])),
  ...section('High Shelf', 'hs', [bool('on', 'On', false), hz('freq', 'Frequency', 10, 20000, 8000), db('gain', 'Gain', -30, 30, 0), qParam(0.7071, 4)]),
  ...section('Low Pass', 'lp', [bool('on', 'On', false), hz('freq', 'Frequency', 10, 20000, 18000), choice('slope', 'Slope', SLOPES, 2)]),
];

function parametricSections(v, rate) {
  const s = [];
  if (v.hpOn) s.push(...F.butterworth(rate, v.hpFreq, v.hpSlope, true));
  if (v.lsOn) s.push(F.lowShelf(rate, v.lsFreq, v.lsQ, v.lsGain));
  for (let b = 1; b <= 5; b++) {
    if (!v[`band${b}On`]) continue;
    const args = [rate, v[`band${b}Freq`], v[`band${b}Q`], v[`band${b}Gain`]];
    s.push(v.qMode === 1 ? F.peaking(...args) : F.peakingCq(...args));
  }
  if (v.hsOn) s.push(F.highShelf(rate, v.hsFreq, v.hsQ, v.hsGain));
  if (v.lpOn) s.push(...F.butterworth(rate, v.lpFreq, v.lpSlope, false));
  return s;
}

const bands = (list) => Object.fromEntries(list.flatMap(([b, freq, gain, q = 1]) => [[`band${b}Freq`, freq], [`band${b}Gain`, gain], [`band${b}Q`, q]]));

registerEffect({
  id: 'parametricEq',
  name: 'Parametric Equalizer',
  group: GROUP,
  kind: 10,
  params: parametricParams,
  response: (v, freqs, rate) => F.cascadeDb(parametricSections(v, rate), freqs, rate, v.gain),
  presets: [
    preset('Flat', {}),
    preset('Rumble Guard', { hpOn: true, hpFreq: 70, hpSlope: 4 }),
    preset('Clear Voice', { hpOn: true, hpFreq: 90, hpSlope: 3, ...bands([[2, 280, -3, 1.2], [3, 1200, 0], [4, 3500, 3, 0.9]]), hsOn: true, hsFreq: 10000, hsGain: 2 }),
    preset('Mud Cleanup', { ...bands([[2, 300, -5, 1.4]]) }),
    preset('Warm Lift', { lsOn: true, lsFreq: 150, lsGain: 3, hsOn: true, hsFreq: 9000, hsGain: -2 }),
    preset('Air and Sparkle', { hsOn: true, hsFreq: 12000, hsGain: 4, hsQ: 0.6 }),
    preset('Telephone Band', { hpOn: true, hpFreq: 400, hpSlope: 4, lpOn: true, lpFreq: 3400, lpSlope: 4, ...bands([[3, 1500, 4, 0.8]]) }),
    preset('Bass Boost', { lsOn: true, lsFreq: 90, lsGain: 6, ...bands([[2, 250, -1.5, 1]]) }),
    preset('Gentle Smile', { lsOn: true, lsFreq: 120, lsGain: 3, ...bands([[3, 1000, -2, 0.5]]), hsOn: true, hsFreq: 8000, hsGain: 3 }),
  ],
});

// ------------------------------------------------------------ Graphic EQ

function freqLabel(f) {
  return f >= 1000 ? `${Number((f / 1000).toFixed(2))} kHz` : `${f} Hz`;
}

function graphicDef(id, name, kind, centres, octaves) {
  const q = F.bandQ(octaves);
  const params = [
    db('gain', 'Master Gain', -24, 24, 0),
    choice('accuracy', 'Accuracy', ['Standard', 'High'], 1),
    ...centres.map((f, i) => db(`band${i + 1}`, freqLabel(f), -24, 24, 0, { section: 'Bands' })),
  ];
  const shape = (fn) => Object.fromEntries(centres.map((f, i) => [`band${i + 1}`, Math.round(fn(f) * 10) / 10]));
  const lg = (f) => Math.log2(f / 1000);
  registerEffect({
    id,
    name,
    group: GROUP,
    kind,
    params,
    bands: centres,
    response: (v, freqs, rate) => {
      const want = centres.map((_, i) => v[`band${i + 1}`] ?? 0);
      const gains = v.accuracy === 1 ? F.correctGraphic(want, centres, q, rate) : want.map((g, i) => (centres[i] <= F.MAX_CENTRE * rate ? g : 0));
      const secs = gains.map((g, i) => (centres[i] <= F.MAX_CENTRE * rate ? F.peakingCq(rate, centres[i], q, g) : F.IDENTITY));
      return F.cascadeDb(secs, freqs, rate, v.gain);
    },
    presets: [
      preset('Flat', {}),
      preset('Smile Curve', shape((f) => 5 * Math.min(1, (lg(f) / 4) ** 2))),
      preset('Low Volume Fullness', shape((f) => (f < 200 ? 6 * Math.min(1, Math.log2(200 / f) / 2.5) : f > 6000 ? 3 * Math.min(1, Math.log2(f / 6000) / 1.5) : 0))),
      preset('Speech Clarity', shape((f) => (f < 100 ? -8 : f < 250 ? -2 : f >= 1800 && f <= 5000 ? 3 : 0))),
      preset('Bass Cut', shape((f) => (f <= 125 ? -12 * Math.min(1, Math.log2(250 / f) / 2) : 0))),
      preset('Treble Cut', shape((f) => (f >= 6000 ? -10 * Math.min(1, Math.log2(f / 4000) / 2) : 0))),
    ],
  });
}

graphicDef('graphicEq10', 'Graphic Equalizer (10 Bands)', 11, F.ISO_OCTAVE, 1);
graphicDef('graphicEq20', 'Graphic Equalizer (20 Bands)', 12, F.ISO_HALF_OCTAVE, 0.5);
graphicDef('graphicEq30', 'Graphic Equalizer (30 Bands)', 13, F.ISO_THIRD_OCTAVE, 1 / 3);

// ------------------------------------------------------------ Notch Filter

const NOTCH_Q = [60, 20, 8, 3];
const notchParams = [
  db('gain', 'Master Gain', -24, 24, 0),
  choice('width', 'Notch Width', ['Super Narrow', 'Narrow', 'Medium', 'Wide'], 1),
  bool('fixGains', 'Fix Gains', false),
  ...[60, 120, 180, 240, 300, 360].flatMap((f, i) => section(`Notch ${i + 1}`, `band${i + 1}`, [bool('on', 'On', i === 0), hz('freq', 'Frequency', 10, 20000, f), db('gain', 'Gain', -90, 0, -30)])),
];

const notchSet = (freqs, gain, width = 1) => ({
  width,
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((i) => [[`band${i + 1}On`, i < freqs.length], [`band${i + 1}Freq`, freqs[i] ?? 1000], [`band${i + 1}Gain`, gain]])),
});

registerEffect({
  id: 'notchFilter',
  name: 'Notch Filter',
  group: GROUP,
  kind: 14,
  params: notchParams,
  response: (v, freqs, rate) => {
    const q = NOTCH_Q[v.width] ?? 20;
    const secs = [];
    for (let i = 1; i <= 6; i++) if (v[`band${i}On`]) secs.push(F.notchBell(rate, v[`band${i}Freq`], q, v.fixGains ? v.band1Gain : v[`band${i}Gain`]));
    return F.cascadeDb(secs, freqs, rate, v.gain);
  },
  presets: [
    preset('Mains Hum 60 Hz', notchSet([60, 120, 180, 240, 300, 360], -30)),
    preset('Mains Hum 50 Hz', notchSet([50, 100, 150, 200, 250, 300], -30)),
    preset('Single 60 Hz Cut', notchSet([60], -40, 0)),
    preset('Whistle at 1 kHz', notchSet([1000, 2000, 3000], -36, 0)),
    preset('Broadcast Tone Removal', notchSet([19000, 15734], -60, 0)),
  ],
});

// ------------------------------------------------------- Scientific Filter

registerEffect({
  id: 'scientificFilter',
  name: 'Scientific Filter',
  group: GROUP,
  kind: 15,
  params: [
    choice('type', 'Type', ['Butterworth', 'Chebyshev', 'Bessel'], 0),
    choice('mode', 'Mode', ['Low Pass', 'High Pass', 'Band Pass', 'Band Stop'], 0),
    num('order', 'Order', 1, 8, 4, '', { step: 1 }),
    hz('cutoff', 'Cutoff', 10, 20000, 1000),
    hz('highCutoff', 'High Cutoff', 10, 20000, 4000),
    db('ripple', 'Passband Ripple', 0.01, 6, 1, { step: 0.01 }),
    db('gain', 'Master Gain', -24, 24, 0),
  ],
  response: (v, freqs, rate) => F.cascadeDb(F.scientificSections(v, rate), freqs, rate, v.gain),
  presets: [
    preset('Smooth Low Pass 8 kHz', { type: 2, mode: 0, order: 4, cutoff: 8000 }),
    preset('Steep Rumble Cut', { type: 0, mode: 1, order: 8, cutoff: 45 }),
    preset('Voice Band Only', { type: 1, mode: 2, order: 4, cutoff: 300, highCutoff: 3400, ripple: 0.5 }),
    preset('Remove 900 to 1100 Hz', { type: 0, mode: 3, order: 4, cutoff: 900, highCutoff: 1100 }),
    preset('Brick Wall 16 kHz', { type: 1, mode: 0, order: 8, cutoff: 16000, ripple: 0.1 }),
  ],
});

// ------------------------------------------------------------- FFT Filter

const FFT_SIZES = [512, 1024, 2048, 4096, 8192, 16384, 32768].map((v) => ({ value: v, label: String(v) }));
const curve = (pts) => pts.map(([f, g]) => ({ f, g }));

registerEffect({
  id: 'fftFilter',
  name: 'FFT Filter',
  group: GROUP,
  kind: 16,
  params: [
    choice('fftSize', 'FFT Size', FFT_SIZES, 4096),
    choice('scale', 'Scale', ['Logarithmic', 'Linear'], 0),
    db('gain', 'Master Gain', -24, 24, 0),
    { id: 'curve', label: 'Curve', type: 'curve', default: curve([[20, 0], [20000, 0]]), min: -60, max: 24, unit: 'dB' },
  ],
  latency: (v) => F.fftSize(v.fftSize, 256, 32768),
  data: (v) => [{ slot: 0, id: dataId(v.curve), values: packCurve(v.curve) }],
  response: (v, freqs) => Float32Array.from(freqs, (f) => F.curveAt(v.curve, f, v.scale !== 1) + v.gain),
  presets: [
    preset('Flat', {}),
    preset('Telephone Voice', { curve: curve([[20, -60], [250, -60], [400, 0], [3000, 0], [4000, -60], [20000, -60]]) }),
    preset('Rumble and Hiss Trim', { curve: curve([[20, -40], [60, -40], [100, 0], [9000, 0], [14000, -18], [20000, -30]]) }),
    preset('Presence Lift', { curve: curve([[20, 0], [1500, 0], [3500, 4], [6000, 2], [20000, 0]]) }),
    preset('Cut 1 kHz Band', { fftSize: 8192, curve: curve([[20, 0], [900, 0], [950, -40], [1050, -40], [1100, 0], [20000, 0]]) }),
    preset('Low Pass 5 kHz', { curve: curve([[20, 0], [5000, 0], [6000, -60], [20000, -60]]) }),
  ],
});
