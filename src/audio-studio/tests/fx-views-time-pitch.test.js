import { describe, it, expect } from 'vitest';
import './fx-wasm.js';
import '../src/effects/catalog.js';
import '../src/effects/views/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { getEffect, slotSpec } from '../src/effects/registry.js';
import { openEffectDialog } from '../src/effects/dialog.js';
import { normalizeValues } from '../src/effects/params.js';
import { bendRange } from '../src/effects/defs/time-pitch.js';
import { clockText, parseClock, noteName } from '../src/effects/views/time-pitch.js';
import { dsp } from '../src/audio/dsp.js';
import { fakeApp, filled } from './fx-helpers.js';

function setup(seconds = 2) {
  const app = fakeApp();
  const doc = new AudioFile({ name: 'a.wav', sampleRate: 8000, channels: [Channel.fromSamples(filled(8000 * seconds, 0.1))] });
  app.active = doc;
  return { app, doc };
}

describe('time and pitch helpers', () => {
  it('formats and reads clock times', () => {
    expect(clockText(12)).toBe('0:12.000');
    expect(clockText(3725.5)).toBe('1:02:05.500');
    expect(parseClock('1:02.5')).toBeCloseTo(62.5);
    expect(parseClock('90s')).toBe(90);
    expect(parseClock('abc')).toBeNaN();
  });
  it('turns a tempo change into a pitch bend range', () => {
    expect(bendRange({ rangeMode: 0, range: 7 })).toBe(7);
    expect(bendRange({ rangeMode: 1, bpmRange: 90, tempo: 90 })).toBeCloseTo(12);
    expect(noteName(69)).toBe('A4');
    expect(noteName(60)).toBe('C4');
  });
  it('bends further with a spline envelope only where the curve eases', async () => {
    const d = await dsp();
    const def = getEffect('pitchBender');
    const x = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 5));
    const env = [{ t: 0, v: 0 }, { t: 0.5, v: 12 }, { t: 1, v: 12 }];
    const [lin] = await def.run({ channels: [x], rate: 8000, values: normalizeValues(def, { envelope: env, range: 12 }), dsp: d });
    const [spl] = await def.run({ channels: [x], rate: 8000, values: normalizeValues(def, { envelope: env, range: 12, spline: true }), dsp: d });
    // Varispeed: the higher the pitch, the shorter the result. Both end shorter than the input, and differ.
    expect(lin.length).toBeLessThan(16000);
    expect(spl.length).toBeLessThan(16000);
    expect(Math.abs(lin.length - spl.length)).toBeGreaterThan(10);
  });
});

describe('time and pitch views', () => {
  it('stretch and pitch sets the stretch from a typed new duration', async () => {
    const { app, doc } = setup(2);
    const p = openEffectDialog(app, getEffect('stretchPitch'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.querySelector('.sp-durations').textContent).toContain('0:02.000');
    const hot = dlg.querySelector('.sp-durations .hot');
    hot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const input = dlg.querySelector('.sp-durations .hot-edit');
    input.value = '0:03';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const resample = [...dlg.querySelectorAll('.fx-check input')].find((i) => i.closest('label').textContent.includes('Resample'));
    resample.checked = true;
    resample.dispatchEvent(new Event('change'));
    dlg.querySelector('.btn.primary').click();
    const v = await p;
    expect(v.stretch).toBeCloseTo(150, 1);
    expect(v.algorithm).toBe(2);
  });
  it('pitch shifter shows the ratio', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('pitchShifter'), { doc, values: { semitones: 12 } });
    const dlg = document.querySelector('.fx-dialog');
    expect(dlg.querySelector('.sp-ratio').textContent).toContain('2.0000');
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
  it('pitch bender scales its graph to the tempo range', async () => {
    const { app, doc } = setup();
    const p = openEffectDialog(app, getEffect('pitchBender'), { doc, values: { range: 2 } });
    const dlg = document.querySelector('.fx-dialog');
    const tempo = [...dlg.querySelectorAll('.fx-radio input')].find((i) => i.value === '1');
    tempo.checked = true;
    tempo.dispatchEvent(new Event('change'));
    expect(dlg.querySelector('.pb-range:not([hidden])').textContent).toMatch(/semitones/);
    dlg.querySelector('.btn.primary').click();
    expect((await p).rangeMode).toBe(1);
  });
  it('automatic pitch correction meters the live correction', async () => {
    const { app, doc } = setup();
    expect(slotSpec(getEffect('automaticPitchCorrection'), {}).readout).toBe(true);
    const p = openEffectDialog(app, getEffect('automaticPitchCorrection'), { doc });
    const dlg = document.querySelector('.fx-dialog');
    app.engine.emit('fx-readout', [['preview:automaticPitchCorrection', Float32Array.from([-47, 452, 69])]]);
    expect(dlg.querySelector('.apc-text').textContent).toBe('Correction: -47.0 cents, A4 (452.0 Hz in)');
    expect(dlg.querySelector('.apc-meter').getAttribute('aria-valuenow')).toBe('-47');
    dlg.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});
