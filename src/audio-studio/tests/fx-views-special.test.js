import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import '../src/effects/catalog.js';
import '../src/effects/views/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, paramArray, slotSpec, defaults } from '../src/effects/registry.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { autoEditor } from '../src/effects/editors.js';
import { normalizeValues } from '../src/effects/params.js';
import { dsp } from '../src/audio/dsp.js';
import { drawnCurveTable, DRAWN } from '../src/effects/defs/special.js';
import { presetCurve, presetPoints } from '../src/effects/views/distortion.js';
import { dopplerPosition, dopplerRatio } from '../src/effects/views/special.js';
import { fakeApp, filled } from './fx-helpers.js';

function setup() {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 48000, channels: [Channel.fromSamples(filled(48000, 0.1)), Channel.fromSamples(filled(48000, 0.1))] });
  app.active = doc;
  return { app, doc };
}

const sine = (f, rate, n, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / rate));
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('drawn distortion curves', () => {
  it('tables a unity curve as the identity and holds the end', () => {
    const t = drawnCurveTable([{ x: -60, y: -60 }, { x: 0, y: 0 }], 101);
    expect(t[0]).toBe(0);
    expect(t[50]).toBeCloseTo(0.5, 5);
    expect(t[100]).toBeCloseTo(1, 5);
  });
  it('follows the points in dB and keeps the first gain below them', () => {
    const t = drawnCurveTable([{ x: -60, y: -66 }, { x: -6, y: -12 }, { x: 0, y: -12 }], 2049);
    const at = (a) => t[Math.round(a * 2048)];
    expect(20 * Math.log10(at(0.5))).toBeCloseTo(-12, 0); // -6 dB in
    expect(20 * Math.log10(at(1))).toBeCloseTo(-12, 1);
    expect(20 * Math.log10(at(0.0005))).toBeCloseTo(20 * Math.log10(0.0005) - 6, 0);
  });
  it('applies a drawn curve in the WASM distortion', async () => {
    const d = await dsp();
    const def = getEffect('distortion');
    // Halve everything: -6 dB across the range, symmetric, no drive.
    const v = normalizeValues(def, { drive: 0, positive: DRAWN, symmetric: true, posCurve: [{ x: -60, y: -66 }, { x: 0, y: -6 }] });
    const x = sine(1000, 48000, 24000);
    const spec = slotSpec(def, v, { rate: 48000 });
    const [y] = d.runEffect(def.kind, 48000, [x], paramArray(def, v), { data: spec.data });
    expect(rms(y.subarray(12000)) / rms(x.subarray(12000))).toBeCloseTo(0.5, 1);
  });
  it('samples preset curves including the drive', () => {
    const hard = presetPoints(2, 12);
    // Hard clip driven 12 dB: everything above -12 dB in sits at 0 dB out.
    expect(hard.find((p) => p.x === -6).y).toBe(0);
    expect(hard.find((p) => p.x === -24).y).toBeCloseTo(-12, 1);
    expect(presetCurve(1, 0.001)).toBeCloseTo(0.001, 5);
    expect(presetCurve(6, 0.5)).toBe(0);
  });
  it('dragging a preset curve point turns that half into a drawn curve', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('distortion'), { doc, values: { drive: 12, positive: 1, symmetric: true } });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.querySelectorAll('.dist-graph')).toHaveLength(2);
    // The generated grid is empty: the view lays out every parameter.
    expect(dlg.querySelector('.fx-dialog-body > .fx-params').children).toHaveLength(0);
    const handle = dlg.querySelector('.dist-graph .fx-point');
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    dlg.querySelector('.btn.primary').click();
    const values = await p;
    expect(values.positive).toBe(DRAWN);
    expect(values.drive).toBe(0);
    expect(values.posCurve.length).toBeGreaterThan(5);
  });
});

describe('guitar suite bypass', () => {
  it('passes audio through with every module bypassed', async () => {
    const d = await dsp();
    const def = getEffect('guitarSuite');
    const v = normalizeValues(def, { compressor: 80, distType: 3, distAmount: 100, amp: 2, filterType: 1, filterFreq: 300, compBypass: true, distBypass: true, ampBypass: true, filterBypass: true });
    const x = sine(1000, 48000, 24000, 0.3);
    const [y] = d.runEffect(def.kind, 48000, [x], paramArray(def, v));
    const lat = def.latency(v, 48000);
    expect(rms(y.subarray(12000 + lat)) / rms(x.subarray(12000, 24000 - lat))).toBeCloseTo(1, 1);
    const [z] = d.runEffect(def.kind, 48000, [x], paramArray(def, { ...v, distBypass: false }));
    expect(peak(z.subarray(12000)) / rms(z.subarray(12000))).toBeLessThan(1.3); // fuzz squares the sine
  });
});

describe('mastering', () => {
  it('shelf Q shapes the drawn response', () => {
    const def = getEffect('mastering');
    const v = { ...defaults(def), lowShelfGain: 12 };
    const f = [100];
    const wide = def.response({ ...v, lowShelfQ: 0.5 }, [300], 48000)[0];
    const peaky = def.response({ ...v, lowShelfQ: 3 }, [300], 48000)[0];
    expect(wide).not.toBeCloseTo(peaky, 0);
    expect(def.response(v, f, 48000)[0]).toBeGreaterThan(5);
  });
  it('shows the EQ graph with three band handles and the module boxes', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('mastering'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.classList.contains('fx-wide')).toBe(true);
    expect(dlg.querySelectorAll('.fx-response .fx-handle')).toHaveLength(3);
    expect([...dlg.querySelectorAll('.fx-group-title')].map((l) => l.textContent)).toContain('Loudness Maximizer');
    const tube = [...dlg.querySelectorAll('.fx-radio input')].find((i) => i.value === '2');
    tube.checked = true;
    tube.dispatchEvent(new Event('change'));
    dlg.querySelector('.btn.primary').click();
    expect((await p).exciterMode).toBe(2);
  });
});

describe('doppler path', () => {
  it('passes the closest point and then recedes', () => {
    const v = { path: 0, startDistance: 30, velocity: 10, comingFrom: -90, passFront: 5, passRight: 0 };
    expect(dopplerPosition(v, 0).y).toBeCloseTo(5);
    expect(dopplerPosition(v, 0).x).toBeCloseTo(-30);
    expect(dopplerPosition(v, 3).x).toBeCloseTo(0);
    expect(dopplerRatio(v, 0.5)).toBeGreaterThan(1);
    expect(dopplerRatio(v, 5.5)).toBeLessThan(1);
  });
  it('circles at the radius', () => {
    const v = { path: 1, radius: 4, velocity: 3, startAngle: 0, centerFront: 0, centerRight: 0 };
    for (const t of [0, 1, 2.5]) {
      const p = dopplerPosition(v, t);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(4);
    }
    expect(dopplerRatio(v, 1)).toBeCloseTo(1, 5);
  });
  it('draws the path view and shows only the controls of the chosen path', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('dopplerShifter'), { doc, values: { path: 0 } });
    const dlg = document.querySelector('.fx-dialog');
    const radius = [...dlg.querySelectorAll('.fx-label')].find((l) => l.textContent === 'Radius');
    expect(radius.closest('.fx-params').hidden).toBe(true);
    const circle = [...dlg.querySelectorAll('.fx-radio input')].find((i) => i.value === '1');
    circle.checked = true;
    circle.dispatchEvent(new Event('change'));
    expect(radius.closest('.fx-params').hidden).toBe(false);
    expect(dlg.querySelector('.dp-status').textContent).toMatch(/semitones/);
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});

describe('registered views', () => {
  it('replace the automatic editor for their effects', () => {
    for (const id of ['dehummer', 'mastering', 'dopplerShifter', 'vocalEnhancer', 'guitarSuite', 'distortion']) expect(autoEditor(getEffect(id))).toBeTypeOf('function');
  });
  it('guitar suite dims a bypassed module', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('guitarSuite'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    const box = [...dlg.querySelectorAll('.fx-group')].find((g) => g.querySelector('legend').textContent === 'Distortion');
    const bypass = [...box.querySelectorAll('.fx-bypass input')][0];
    bypass.checked = true;
    bypass.dispatchEvent(new Event('change'));
    expect(box.querySelector('select').disabled).toBe(true);
    dlg.querySelector('.btn.primary').click();
    expect((await p).distBypass).toBe(true);
  });
});
