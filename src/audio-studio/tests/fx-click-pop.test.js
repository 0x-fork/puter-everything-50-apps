// Click/Pop Eliminator: the effect (repairs every click with stored
// settings) and its scan / choose / repair dialog built on Diagnostics.
import { describe, it, expect, beforeAll } from 'vitest';
import './fx-wasm.js';
import { getEffect, defaults } from '../src/effects/index.js';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { setDiagnosticsWorker } from '../src/diagnostics/scan.js';
import { openClickPopDialog, thresholdOf, discriminationOf, chooseByThreshold } from '../src/diagnostics/click-pop.js';
import { installEffectCommands } from '../src/effects/commands.js';
import { installEffectsDsp } from '../src/features/effects-dsp.js';
import { EFFECT_GROUPS } from '../src/ui/menus.js';
import { fakeApp } from './fx-helpers.js';

const RATE = 48000;
const def = getEffect('clickPopEliminator');

function music(n) {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  return Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 330 * i) / RATE) + 0.15 * Math.sin((2 * Math.PI * 1210 * i) / RATE) + 0.02 * rnd());
}

/** Adds clicks at `at`, scaled by `amp` (weak and strong clicks). */
function withClicks(x, at, amp = 1) {
  const y = x.slice();
  for (const i of at) {
    y[i] += 0.6 * amp;
    y[i + 1] -= 0.4 * amp;
    y[i + 2] += 0.3 * amp;
  }
  return y;
}

const err = (a, b, lo = 0, hi = a.length) => {
  let s = 0;
  for (let i = lo; i < hi; i++) s += (a[i] - b[i]) ** 2;
  return s;
};

beforeAll(() => setDiagnosticsWorker(null));

function setup(samples) {
  const app = fakeApp();
  installEffectCommands(app);
  installEffectsDsp(app);
  const doc = new AudioFile({ name: 'a.wav', sampleRate: RATE, channels: [Channel.fromSamples(samples)] });
  app.active = doc;
  return { app, doc };
}

describe('Click/Pop Eliminator effect', () => {
  it('sits in Restoration with a wide repair threshold', () => {
    expect(def.group).toBe('Noise Reduction / Restoration');
    expect(EFFECT_GROUPS.find((g) => g.label === def.group).ids).toContain('clickPopEliminator');
    expect(def.params.find((p) => p.id === 'discrimination').max).toBe(400);
    expect(thresholdOf({ discrimination: 400 })).toBe(5);
    expect(discriminationOf(1.3)).toBe(30);
  });

  it('repairs every click when run with stored settings (favorites, batches)', async () => {
    const clean = music(RATE);
    const clicky = withClicks(clean, [5000, 15000, 30000]);
    const [out] = await def.process({ channels: [clicky], rate: RATE, values: defaults(def) });
    expect(err(out, clean)).toBeLessThan(err(clicky, clean) * 0.05);
  });

  it('chooses detections at or above the threshold', () => {
    const ps = [{ id: 'a', level: 1.1 }, { id: 'b', level: 3 }, { id: 'c', level: 1.3 }];
    expect([...chooseByThreshold(ps, 1.3)]).toEqual(['b', 'c']);
  });
});

describe('Click/Pop Eliminator dialog', () => {
  it('scans, lists with times, follows the threshold and repairs the chosen clicks', async () => {
    const clean = music(RATE);
    const strong = [8000, 30000];
    const weak = [18000];
    const clicky = withClicks(withClicks(clean, strong), weak, 0.08);
    const { app, doc } = setup(clicky);
    const dlg = openClickPopDialog(app, doc, { autoScan: false });
    const root = [...document.querySelectorAll('.cpe-dialog')].at(-1);
    expect(root.querySelector('.dialog-title').textContent).toBe('Click/Pop Eliminator');
    await dlg.scan();
    const { scan, chosen } = dlg.state();
    expect(scan.problems.length).toBeGreaterThanOrEqual(3);
    const rows = root.querySelectorAll('.cpe-table tbody tr');
    expect(rows).toHaveLength(scan.problems.length);
    expect(rows[0].children[2].textContent).toMatch(/0\.16|0:00/);
    // Strong clicks are far above the default threshold; the weak one is not.
    const weakP = scan.problems.find((p) => p.start <= 18000 && p.end > 18000);
    expect(weakP).toBeTruthy();
    const thr = thresholdOf(dlg.state().values);
    expect(chosen.has(weakP.id)).toBe(weakP.level >= thr);
    // Pull the threshold to the bottom: everything is chosen.
    const handle = root.querySelector('.cpe-threshold');
    for (let i = 0; i < 20; i++) handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    expect(dlg.state().values.discrimination).toBe(0);
    expect(dlg.state().chosen.size).toBe(scan.problems.length);
    const repairBtn = root.querySelector('.dialog-foot button[data-value="repair"]');
    expect(repairBtn.textContent).toBe(`Repair ${scan.problems.length} Clicks`);
    // Untick the weak click, then repair the rest.
    const weakRow = root.querySelectorAll('.cpe-table tbody tr')[scan.problems.indexOf(weakP)];
    weakRow.querySelector('input').click();
    expect(dlg.state().chosen.has(weakP.id)).toBe(false);
    await dlg.repair();
    expect(err(doc.state.channels[0].toArray(), clean, 7000, 9500)).toBeLessThan(err(clicky, clean, 7000, 9500) * 0.05);
    // The unticked one is untouched and still listed.
    expect(err(doc.state.channels[0].toArray(), clicky, 17000, 19500)).toBe(0);
    expect(dlg.state().scan.problems.map((p) => p.id)).toEqual([weakP.id]);
    expect(doc.history.undoLabel).toMatch(/Click\/Pop Eliminator: Repair/);
    root.querySelector('.dialog-head .icon-btn').click();
    await dlg;
  });

  it('asks for a new scan when the file changed', async () => {
    const clicky = withClicks(music(RATE / 2), [6000]);
    const { app, doc } = setup(clicky);
    const dlg = openClickPopDialog(app, doc, { autoScan: false });
    const root = [...document.querySelectorAll('.cpe-dialog')].at(-1);
    await dlg.scan();
    doc.apply('Other edit', { ...doc.state });
    await dlg.repair();
    expect(root.querySelector('.cpe-caption').textContent).toMatch(/Scan again/);
    root.querySelector('.dialog-head .icon-btn').click();
    await dlg;
  });

  it('is what fx.clickPopEliminator opens; with values it applies directly', async () => {
    const clean = music(RATE / 2);
    const clicky = withClicks(clean, [6000, 16000]);
    const { app, doc } = setup(clicky);
    expect(app.commands.label('fx.clickPopEliminator')).toBe('Click/Pop Eliminator (process)...');
    app.runEffect = (id, args) => (id === 'clickPopEliminator' ? import('../src/effects/commands.js').then((m) => m.runEffect(app, id, args)) : null);
    await app.commands.run('fx.clickPopEliminator', { values: defaults(def) });
    expect(err(doc.state.channels[0].toArray(), clean)).toBeLessThan(err(clicky, clean) * 0.05);
    const p = app.commands.run('fx.clickPopEliminator');
    // The dialog's code loads on first use.
    for (let i = 0; i < 50 && !document.querySelector('.cpe-dialog'); i++) await new Promise((r) => setTimeout(r, 20));
    const root = [...document.querySelectorAll('.cpe-dialog')].at(-1);
    expect(root).toBeTruthy();
    root.querySelector('.dialog-head .icon-btn').click();
    await p;
  });
});
