import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import '../src/effects/catalog.js';
import '../src/effects/views/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, slotSpec } from '../src/effects/registry.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { packNoisePrint, curveGainAt, serializeNoisePrint, parseNoisePrint, FLAT_CURVE } from '../src/effects/defs/restoration.js';
import { printLevels } from '../src/effects/views/noise-print.js';
import { fakeApp, filled } from './fx-helpers.js';

const print = () => ({ id: 77, rate: 48000, fftSize: 512, frames: 10, seconds: 1, channels: [new Float32Array(257).fill(1e-6), new Float32Array(257).fill(4e-6)] });

describe('noise print threshold curve', () => {
  it('interpolates the adjustment on a log-frequency axis', () => {
    const c = [{ f: 100, g: 0 }, { f: 1000, g: 10 }];
    expect(curveGainAt(c, 50)).toBe(0);
    expect(curveGainAt(c, Math.sqrt(100 * 1000))).toBeCloseTo(5);
    expect(curveGainAt(c, 5000)).toBe(10);
    expect(curveGainAt([], 300)).toBe(0);
  });
  it('scales the packed print power per bin and caches by curve', () => {
    const p = print();
    const flat = packNoisePrint(p);
    expect(packNoisePrint(p, FLAT_CURVE)).toBe(flat);
    const up = packNoisePrint(p, [{ f: 20, g: 10 }, { f: 20000, g: 10 }]);
    expect(up).not.toBe(flat);
    expect(up[4 + 100] / p.channels[0][100]).toBeCloseTo(10, 4);
    expect(up[4 + 257 + 100] / p.channels[1][100]).toBeCloseTo(10, 4);
    expect(up.slice(0, 4)).toEqual(flat.slice(0, 4));
  });
  it('changes the data id only when the curve bends', () => {
    const def = getEffect('noiseReduction');
    const doc = { noisePrint: print(), sampleRate: 48000 };
    const a = slotSpec(def, { curve: FLAT_CURVE }, { doc }).data[0].id;
    const b = slotSpec(def, { curve: [{ f: 20, g: 0 }, { f: 2000, g: -6 }, { f: 20000, g: 0 }] }, { doc }).data[0].id;
    expect(a).toBe('np77');
    expect(b).not.toBe(a);
  });
  it('saves and loads a print, and rejects other files', () => {
    const p = print();
    const back = parseNoisePrint(JSON.stringify(serializeNoisePrint(p)));
    expect(back.fftSize).toBe(512);
    expect(back.channels[1][3]).toBeCloseTo(4e-6, 10);
    expect(back.id).not.toBe(p.id);
    expect(() => parseNoisePrint('{"type":"other"}')).toThrow(/not a noise print/);
    expect(() => parseNoisePrint({ ...serializeNoisePrint(p), channels: [[1, 2]] })).toThrow();
  });
  it('smooths the print levels the threshold follows', () => {
    const p = print();
    p.channels[0][50] = 1e-2;
    const { raw, smooth } = printLevels(p, 0);
    expect(raw[50]).toBeCloseTo(-20);
    expect(smooth[50]).toBeLessThan(raw[50]);
    expect(smooth[200]).toBeCloseTo(-60, 0);
  });
});

describe('noise reduction dialog', () => {
  function setup() {
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(48000, 0.1)), Channel.fromSamples(filled(48000, 0.1))] });
    app.active = doc;
    app.commands.register({ id: 'fx.captureNoisePrint', label: 'Capture', run: () => {
      doc.noisePrint = print();
      doc.emit('change', { kind: 'noisePrint' });
    } });
    return { app, doc };
  }
  it('captures a print from the dialog and adjusts the threshold with the keyboard', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('noiseReduction'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.querySelector('.nr-status').textContent).toBe('Noise print: none');
    [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Capture Noise Print').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(dlg.querySelector('.nr-status').textContent).toMatch(/1\.00 s, 2 channels, FFT 512/);
    const handle = dlg.querySelector('.nr-graph .fx-point');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
    // Advanced settings sit in a collapsed section; the main controls are visible.
    expect(dlg.querySelector('details.fx-disclosure').textContent).toMatch(/FFT Size/);
    dlg.querySelector('.btn.primary').click();
    const values = await p;
    expect(values.curve[0].g).toBe(5);
  });
  it('selects the entire file', async () => {
    const { app, doc } = setup();
    doc.setSelection(100, 200);
    const p = openEffectDialog(app, getEffect('noiseReduction'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Select Entire File').click();
    expect(doc.selection).toMatchObject({ start: 0, end: 48000 });
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});

describe('dehummer view', () => {
  it('draws a handle on the base notch that moves the frequency', async () => {
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(4800, 0.1))] });
    app.active = doc;
    const p = openEffectDialog(app, getEffect('dehummer'), { doc, values: { frequency: 60 } });
    const dlg = document.querySelector('.fx-dialog');
    const handle = dlg.querySelector('.fx-response .fx-handle');
    expect(handle.getAttribute('aria-valuetext')).toMatch(/60 Hz/);
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    dlg.querySelector('.btn.primary').click();
    expect((await p).frequency).toBeLessThan(60);
  });
});

describe('automatic phase correction', () => {
  it('shifts a channel by hand while the automatic shift is off', async () => {
    await import('./fx-wasm.js');
    const { dsp } = await import('../src/audio/dsp.js');
    const { paramArray } = await import('../src/effects/registry.js');
    const { normalizeValues } = await import('../src/effects/params.js');
    const d = await dsp();
    const def = getEffect('autoPhaseCorrection');
    const n = 24000;
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.05) + 0.5 * Math.sin(i * 0.31));
    const v = normalizeValues(def, { globalShift: false, rightShift: 10 / 48000 * 1e6 });
    const [l, r] = d.runEffect(def.kind, 48000, [x, x], paramArray(def, v));
    // The right channel now trails the left by 10 frames.
    let err = 0;
    for (let i = 12000; i < 20000; i++) err = Math.max(err, Math.abs(r[i] - l[i - 10]));
    expect(err).toBeLessThan(0.05);
  });
  it('greys out the manual shifts while the automatic shift is on', async () => {
    const app = fakeApp();
    const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(4800, 0.1)), Channel.fromSamples(filled(4800, 0.1))] });
    app.active = doc;
    const p = openEffectDialog(app, getEffect('autoPhaseCorrection'), { doc, values: { globalShift: true } });
    const dlg = document.querySelector('.fx-dialog');
    const left = [...dlg.querySelectorAll('input[type=range]')].find((s) => s.getAttribute('aria-label') === 'Left Channel Shift');
    expect(left.disabled).toBe(true);
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});

describe('denoise and dereverb', () => {
  it('denoise can output what it removes, dereverb can make up its level', async () => {
    await import('./fx-wasm.js');
    const { dsp } = await import('../src/audio/dsp.js');
    const { paramArray } = await import('../src/effects/registry.js');
    const { normalizeValues } = await import('../src/effects/params.js');
    const d = await dsp();
    const x = Float32Array.from({ length: 24000 }, (_, i) => 0.2 * Math.sin(i * 1.7) * Math.sin(i * 0.013) + 0.05 * Math.sin(i * 2.9));
    const dn = getEffect('denoise');
    const run = (def, v) => d.runEffect(def.kind, 48000, [x], paramArray(def, normalizeValues(def, v)))[0];
    const kept = run(dn, { amount: 80 });
    const removed = run(dn, { amount: 80, noiseOnly: true });
    let err = 0;
    for (let i = 12000; i < 24000; i++) err = Math.max(err, Math.abs(kept[i] + removed[i] - x[i]));
    expect(err).toBeLessThan(1e-3);
    const dr = getEffect('dereverb');
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(run(dr, { amount: 100, decay: 3000, autoGain: true }).subarray(12000))).toBeGreaterThan(rms(run(dr, { amount: 100, decay: 3000 }).subarray(12000)));
  });
});
