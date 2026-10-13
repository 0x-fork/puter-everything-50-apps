// Docked panels: Phase Analysis and Phase Meter, Frequency Analysis holds and
// display, Amplitude Statistics tabs, Metadata tabs, Properties sections,
// Level Meters orientation and the Files panel columns.
import { describe, it, expect, beforeAll } from 'vitest';
import { App } from '../src/app.js';
import { installCore } from '../src/features/core.js';
import { installAnalysis } from '../src/analysis/install.js';
import { AudioFile } from '../src/model/audio-file.js';
import { Channel } from '../src/audio/channel.js';
import { correlationLabelStep, meterIsVertical, correlationText } from '../src/analysis/phase.js';
import { MENUS } from '../src/ui/menus.js';
import { HOLD_COLORS, spectrumBars } from '../src/analysis/frequency.js';
import { WORKSPACES } from '../src/ui/workspaces.js';

const RATE = 1000;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = () => null;
});

function makeApp() {
  localStorage.clear();
  const app = new App();
  installCore(app);
  installAnalysis(app);
  return app;
}

function audioDoc(seconds = 2, channels = 2) {
  return new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: Array.from({ length: channels }, () => Channel.fromSamples(new Float32Array(RATE * seconds))) });
}

const create = (app, id) => app.panels.get(id).create(app);

describe('Phase Analysis and Phase Meter', () => {
  it('registers both panels and lists them in the Window menu', () => {
    const app = makeApp();
    expect(app.panels.get('phaseAnalysis').title).toBe('Phase Analysis');
    expect(app.panels.get('phase').title).toBe('Phase Meter');
    const win = MENUS.find((m) => m.label === 'Window').submenu;
    expect(win.indexOf('window.phaseAnalysis')).toBeGreaterThan(-1);
    expect(win.indexOf('window.phaseAnalysis')).toBeLessThan(win.indexOf('window.phase'));
    expect(app.commands.label('window.phaseAnalysis')).toBe('Phase Analysis');
  });

  it('keeps the scope in the analysis workspaces next to the meter', () => {
    const ids = (n, out = []) => (n.t === 'group' ? out.push(...n.tabs) : n.c.forEach((c) => ids(c, out)), out);
    for (const name of ['Mastering and Analysis', 'Loudness']) {
      const tabs = ids(WORKSPACES[name]());
      expect(tabs, name).toContain('phaseAnalysis');
      expect(tabs, name).toContain('phase');
    }
  });

  it('builds the meter and scope panels', () => {
    const app = makeApp();
    const meter = create(app, 'phase');
    expect(meter.el.querySelector('[role=meter]').getAttribute('aria-valuemin')).toBe('-1');
    const scope = create(app, 'phaseAnalysis');
    expect(scope.el.querySelector('.phase-scope')).toBeTruthy();
    expect(scope.el.querySelector('[role=meter]')).toBeNull();
  });

  it('spaces correlation labels by the room available', () => {
    expect(correlationLabelStep(2000)).toBe(0.05);
    expect(correlationLabelStep(700)).toBe(0.1);
    expect(correlationLabelStep(300)).toBe(0.25);
    expect(correlationLabelStep(150)).toBe(0.5);
    expect(correlationLabelStep(40)).toBe(1);
    expect(meterIsVertical(60, 300)).toBe(true);
    expect(meterIsVertical(600, 80)).toBe(false);
    expect(correlationText(-0.8)).toMatch(/out of phase/);
    expect(correlationText(0.9)).toMatch(/mono/);
  });
});


describe('Frequency Analysis', () => {
  it('has eight colored hold slots and an Advanced section', () => {
    const app = makeApp();
    const p = create(app, 'frequency');
    const slots = p.el.querySelectorAll('.freq-hold');
    expect(slots.length).toBe(HOLD_COLORS.length);
    expect(slots.length).toBe(8);
    expect(new Set(HOLD_COLORS).size).toBe(8);
    // Nothing to hold yet: the slots stay empty.
    slots[0].click();
    expect(slots[0].getAttribute('aria-pressed')).toBe('false');
    const adv = p.el.querySelector('.freq-adv-toggle');
    expect(p.el.querySelector('.freq-advanced').hidden).toBe(true);
    adv.click();
    expect(app.prefs.get('frequencyAnalysis').advanced).toBe(true);
    expect(p.el.querySelector('.freq-advanced').hidden).toBe(false);
    expect(adv.getAttribute('aria-expanded')).toBe('true');
  });

  it('switches display and enables Scan for audio files', () => {
    const app = makeApp();
    const p = create(app, 'frequency');
    const scan = [...p.el.querySelectorAll('button')].find((b) => b.textContent === 'Scan');
    expect(scan.disabled).toBe(true);
    app.addDocument(audioDoc());
    expect(scan.disabled).toBe(false);
    const display = p.el.querySelector('select[aria-label=Display]');
    display.value = 'bars';
    display.dispatchEvent(new Event('change'));
    expect(app.prefs.get('frequencyAnalysis').display).toBe('bars');
  });

  it('reduces a spectrum to bars of the loudest bin', () => {
    const db = Float32Array.from({ length: 513 }, (_, k) => (k === 100 ? -10 : -80));
    const bars = spectrumBars(db, 1024, 1024, (f) => f * 512, 8);
    expect(bars.length).toBe(8);
    expect(bars[1]).toBe(-10); // bin 100 (100 Hz) falls in the second slice of 0..512 Hz
    expect(bars[0]).toBe(-80);
    expect(bars[7]).toBe(-80);
  });
});
