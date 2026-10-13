// Effect definitions: Stereo Imagery (WASM kinds 110..112, wasm/dsp/src/fx/stereo).

import { registerEffect } from '../registry.js';
import { num, db, hz, pct, choice, preset, packCurve, dataId } from './util.js';
import { fftSize } from './filter-math.js';

const GROUP = 'Stereo Imagery';
const sizes = (list) => list.map((v) => ({ value: v, label: String(v) }));

registerEffect({
  id: 'stereoExpander',
  name: 'Stereo Expander',
  group: GROUP,
  kind: 110,
  params: [
    num('centerPan', 'Center Channel Pan', -100, 100, 0, '', { step: 1 }),
    pct('width', 'Stereo Width', 100, { max: 300 }),
    db('gain', 'Output Gain', -24, 12, 0),
  ],
  presets: [
    preset('Neutral', {}),
    preset('Wider Image', { width: 160 }),
    preset('Very Wide', { width: 240, gain: -2 }),
    preset('Narrower Image', { width: 60 }),
    preset('Fold to Mono', { width: 0 }),
    preset('Shift Center Left', { centerPan: -35 }),
    preset('Shift Center Right', { centerPan: 35 }),
  ],
});

registerEffect({
  id: 'centerChannelExtractor',
  name: 'Center Channel Extractor',
  group: GROUP,
  kind: 111,
  params: [
    choice('target', 'Extract Audio From', ['Center', 'Left', 'Right', 'Surround'], 0),
    choice('range', 'Frequency Range', ['Full Spectrum', 'Male Voice', 'Female Voice', 'Bass', 'Custom'], 0),
    hz('lowFreq', 'Custom Low', 20, 20000, 100),
    hz('highFreq', 'Custom High', 20, 20000, 8000),
    db('centerLevel', 'Center Channel Level', -48, 12, 0, { section: 'Levels' }),
    db('sideLevel', 'Side Channel Levels', -48, 12, 0, { section: 'Levels' }),
    pct('bleed', 'Crossover Bleed', 20, { section: 'Discrimination' }),
    num('phaseDisc', 'Phase Discrimination', 0, 180, 10, 'deg', { step: 0.5, section: 'Discrimination' }),
    db('ampDisc', 'Amplitude Discrimination', 0, 20, 3, { section: 'Discrimination' }),
    pct('decay', 'Spectral Decay Rate', 70, { max: 99, section: 'Discrimination' }),
    choice('fftSize', 'FFT Size', sizes([1024, 2048, 4096, 8192, 16384]), 4096, { section: 'Advanced' }),
  ],
  latency: (v) => fftSize(v.fftSize, 512, 16384),
  presets: [
    preset('Remove Lead Vocal', { centerLevel: -48, range: 4, lowFreq: 120, highFreq: 9000 }),
    preset('Isolate Lead Vocal', { sideLevel: -48, range: 4, lowFreq: 100, highFreq: 10000 }),
    preset('Karaoke Male Voice', { centerLevel: -48, range: 1 }),
    preset('Karaoke Female Voice', { centerLevel: -48, range: 2 }),
    preset('Lift the Center', { centerLevel: 4, sideLevel: -2 }),
    preset('Extract Out of Phase', { target: 3, sideLevel: -48, phaseDisc: 20 }),
    preset('Keep Bass Center Only', { range: 3, sideLevel: -48 }),
  ],
});

const curve = (pts) => pts.map(([f, g]) => ({ f, g }));

registerEffect({
  id: 'graphicPhaseShifter',
  name: 'Graphic Phase Shifter',
  group: GROUP,
  kind: 112,
  params: [
    choice('channel', 'Channel', ['Left', 'Right', 'Both'], 0),
    choice('fftSize', 'FFT Size', sizes([256, 512, 1024, 2048, 4096, 8192, 16384]), 2048),
    choice('scale', 'Scale', ['Logarithmic', 'Linear'], 0),
    { id: 'curve', label: 'Phase Shift', type: 'curve', default: curve([[20, 0], [20000, 0]]), min: -180, max: 180, unit: 'deg' },
  ],
  latency: (v) => fftSize(v.fftSize, 256, 16384),
  data: (v) => [{ slot: 0, id: dataId(v.curve), values: packCurve(v.curve) }],
  presets: [
    preset('No Shift', {}),
    preset('Quarter Turn Left', { curve: curve([[20, 90], [20000, 90]]) }),
    preset('Invert Lows on Right', { channel: 1, curve: curve([[20, 180], [150, 180], [300, 0], [20000, 0]]) }),
    preset('Gentle Phase Tilt', { channel: 2, curve: curve([[20, 0], [20000, 90]]) }),
    preset('Wide Phase Spread', { curve: curve([[20, 0], [500, 60], [2000, -60], [8000, 60], [20000, 0]]) }),
  ],
});
