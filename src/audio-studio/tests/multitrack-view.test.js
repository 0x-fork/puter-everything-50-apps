import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { App } from '../src/app.js';
import { installCore } from '../src/features/core.js';
import { installMultitrack } from '../src/features/multitrack.js';
import { Session } from '../src/model/session.js';
import { Channel } from '../src/audio/channel.js';
import * as S from '../src/model/session-edits.js';
import { mixerPanel, fader } from '../src/panels/mixer.js';
import { sessionPropertySection } from '../src/multitrack/properties.js';

beforeAll(() => {
  // jsdom has no canvas; the view draws nothing without a context.
  HTMLCanvasElement.prototype.getContext = () => null;
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

const RATE = 48000;

function setup() {
  localStorage.clear();
  const app = new App();
  installCore(app);
  installMultitrack(app);
  app.syncGraph = () => {};
  const doc = new Session({ name: 'Test.asesx', sampleRate: RATE, tracks: 3 });
  const src = doc.addSource({ name: 'tone.wav', channels: [Channel.fromSamples(new Float32Array(RATE * 4).fill(0.25))] });
  const clip = S.createClip({ trackId: doc.state.tracks[0].id, sourceId: src, name: 'tone', start: RATE, length: RATE * 2 });
  doc.apply('Insert File', S.addClips(doc.state, [clip]));
  app.addDocument(doc);
  const view = app.documentKinds.get('session').view(app, doc);
  document.body.replaceChildren(view.el);
  // jsdom has no layout: give the lanes a size.
  view.width = 1000;
  view.height = 600;
  view.computeRows();
  doc.setView(0, RATE * 10);
  app.currentView = () => view;
  return { app, doc, view, clip };
}

describe('multitrack view', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('builds a header per track plus the master, in order', () => {
    const { view, doc } = ctx;
    const names = [...view.el.querySelectorAll('.mt-th-name')].map((i) => i.value);
    expect(names).toEqual([...doc.state.tracks.map((t) => t.name), 'Mix']);
    expect(view.el.querySelector('.mt-th.master .mt-tb-arm')).toBeNull();
  });

  it('toggles mute from the header as one undo step and updates the button', () => {
    const { view, doc } = ctx;
    const btn = view.el.querySelector('.mt-th .mt-tb-mute');
    btn.click();
    expect(doc.state.tracks[0].mute).toBe(true);
    expect(doc.history.undoLabel).toBe('Mute On');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    doc.history.undo();
    expect(view.el.querySelector('.mt-th .mt-tb-mute').getAttribute('aria-pressed')).toBe('false');
  });

  it('changes track volume from the keyboard on the readout', () => {
    const { view, doc } = ctx;
    const hot = view.el.querySelector('.mt-th .hot');
    hot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    hot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(doc.state.tracks[0].volume).toBeCloseTo(0.2);
    expect(doc.history.entries.filter((e) => e.label === 'Track Volume')).toHaveLength(2);
  });

  it('renames a track from its name field', () => {
    const { view, doc } = ctx;
    const input = view.el.querySelector('.mt-th-name');
    input.value = 'Vocals';
    input.dispatchEvent(new Event('change'));
    expect(doc.state.tracks[0].name).toBe('Vocals');
  });

  it('hit-tests clip regions and empty lanes', () => {
    const { view, clip } = ctx;
    const r = view.clipRects().find((q) => q.clip.id === clip.id);
    expect(r.x0).toBeCloseTo(100);
    expect(r.x1).toBeCloseTo(300);
    expect(view.hitTest(150, r.y + 8).part).toBe('header');
    expect(view.hitTest(r.x0 + 1, r.y + 60).part).toBe('edgeIn');
    expect(view.hitTest(r.x1 - 1, r.y + 60).part).toBe('edgeOut');
    expect(view.hitTest(r.x0 + 4, r.y + 7).part).toBe('fadeIn');
    expect(view.hitTest(200, r.y + 90).part).toBe('body');
    expect(view.hitTest(600, r.y + 60).part).toBe('empty');
    const envY = r.wy + 2 + 0.5 * (r.wh - 4);
    expect(view.hitTest(200, envY)).toMatchObject({ part: 'line', param: 'volume' });
  });

  it('snaps to clip edges and the playhead within eight pixels', () => {
    const { view, app } = ctx;
    app.prefs.set('snap', { ruler: false, markers: true, clips: true });
    expect(view.snap(RATE + view.fpp * 5)).toBe(RATE);
    expect(view.snap(RATE + view.fpp * 20)).toBe(Math.round(RATE + view.fpp * 20));
    app.prefs.set('snapping', false);
    expect(view.snap(RATE + 3)).toBe(RATE + 3);
  });

  it('runs clip commands: split at the playhead, nudge, delete and undo', async () => {
    const { app, doc, clip } = ctx;
    doc.selectClips([clip.id]);
    doc.setCursor(RATE * 2);
    await app.commands.run('clip.split');
    expect(doc.state.clips).toHaveLength(2);
    await app.commands.run('edit.selectAll');
    await app.commands.run('edit.delete');
    expect(doc.state.clips).toHaveLength(0);
    await app.commands.run('edit.undo');
    expect(doc.state.clips).toHaveLength(2);
    doc.selectClips([doc.state.clips[1].id]);
    const before = doc.state.clips[1].start;
    await app.commands.run('clip.nudgeRight');
    expect(doc.state.clips.find((c) => c.start > before)).toBeTruthy();
  });

  it('copies and pastes clips at the playhead on the selected track', async () => {
    const { app, doc, clip } = ctx;
    doc.selectClips([clip.id]);
    await app.commands.run('edit.copy');
    doc.selectTrack(doc.state.tracks[2].id);
    doc.setCursor(RATE * 5);
    await app.commands.run('edit.paste');
    const pasted = doc.state.clips.find((c) => c.id !== clip.id);
    expect(pasted).toMatchObject({ trackId: doc.state.tracks[2].id, start: RATE * 5, length: RATE * 2 });
  });

  it('ripple deletes the time selection across all tracks', async () => {
    const { app, doc } = ctx;
    doc.setSelection(0, RATE / 2);
    await app.commands.run('edit.rippleTimeAll');
    expect(doc.state.clips[0].start).toBe(RATE / 2);
  });

  it('adds tracks and buses after the selected track and routes to buses', async () => {
    const { app, doc } = ctx;
    doc.selectTrack(doc.state.tracks[0].id);
    await app.commands.run('mt.addBus');
    expect(doc.state.tracks[1].type).toBe('bus');
    await app.commands.run('mt.setTrackOutput', { id: doc.state.tracks[0].id, output: doc.state.tracks[1].id });
    expect(doc.state.tracks[0].output).toBe(doc.state.tracks[1].id);
    const sel = document.querySelector('.mt-th select[aria-label="Track output"]');
    expect([...sel.options].map((o) => o.textContent)).toContain('Bus A');
  });

  it('switches tools per editor and reports available tools', () => {
    const { app } = ctx;
    expect(app.toolAvailable('razor')).toBe(true);
    expect(app.toolAvailable('heal')).toBe(false);
    expect(app.commands.isEnabled('tool.slip')).toBe(true);
  });
});

describe('mixer panel', () => {
  it('shows a strip per track and the master, with a keyboard fader', () => {
    const { app, doc } = setup();
    const panel = mixerPanel(app);
    document.body.append(panel.el);
    panel.show();
    const strips = panel.el.querySelectorAll('.mx-strip');
    expect(strips).toHaveLength(doc.state.tracks.length + 1);
    expect(panel.el.querySelector('.mx-master .mx-strip')).toBeTruthy();
    const f = strips[0].querySelector('.mx-fader');
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(doc.state.tracks[0].volume).toBe(-3);
    expect(f.getAttribute('aria-valuetext')).toBe('-3.0 dB');
    strips[1].querySelector('.mt-tb-solo').click();
    expect(doc.state.tracks[1].solo).toBe(true);
  });

  it('fader keys reach silence and back', () => {
    const changes = [];
    const el = fader({ value: -59, label: 'Test', onChange: (v) => changes.push(v) });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    expect(changes.pop()).toBe(S.SILENT_DB);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(changes.pop()).toBe(-60);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    expect(changes.pop()).toBe(0);
  });
});

describe('session properties', () => {
  it('edits the selected clip and track', () => {
    const { app, doc, clip } = setup();
    doc.selectClips([clip.id]);
    const el = sessionPropertySection(app, doc);
    const gain = el.querySelector('input[aria-label="Clip gain in dB"]');
    gain.value = '-6';
    gain.dispatchEvent(new Event('change'));
    expect(S.findClip(doc.state, clip.id).gain).toBe(-6);
    const loop = [...el.querySelectorAll('label.check')].find((l) => l.textContent === 'Loop').querySelector('input');
    loop.checked = true;
    loop.dispatchEvent(new Event('change'));
    expect(S.findClip(doc.state, clip.id).loop).toBe(true);
    expect(el.textContent).toContain('Stretch');
    const name = el.querySelector('input[aria-label="Track name"]');
    name.value = 'Lead';
    name.dispatchEvent(new Event('change'));
    expect(doc.state.tracks[0].name).toBe('Lead');
  });
});

describe('automation writing', () => {
  it('records knob moves during playback in Touch mode as one undo step', () => {
    const { app, doc } = setup();
    const id = doc.state.tracks[0].id;
    doc.apply('Mode', S.updateTrack(doc.state, id, { mode: 'touch' }));
    let pos = 0;
    Object.defineProperty(app.engine, 'playing', { get: () => true, configurable: true });
    Object.defineProperty(app, 'playhead', { get: () => pos, configurable: true });
    const c = doc.controls;
    const steps = doc.history.entries.length;
    pos = 1000;
    c.set(id, 'volume', -3, 'input');
    pos = 20000;
    c.set(id, 'volume', -9, 'input');
    pos = 30000;
    c.set(id, 'volume', -9, 'change');
    expect(doc.overrides[id]?.volume).toBeUndefined();
    c.commit(40000);
    delete app.engine.playing;
    const lane = S.findTrack(doc.state, id).automation.volume;
    expect(doc.history.entries.length).toBe(steps + 1);
    expect(doc.history.undoLabel).toBe('Write Automation');
    expect(lane[0]).toEqual({ t: 1000, v: -3 });
    expect(lane[lane.length - 1]).toEqual({ t: 30000, v: -9 });
    expect(S.findTrack(doc.state, id).volume).toBe(0);
  });

  it('sets a keyframe at the playhead when stopped with automation', () => {
    const { doc } = setup();
    const id = doc.state.tracks[0].id;
    doc.apply('Auto', S.setAutomation(doc.state, id, 'volume', [{ t: 0, v: 0 }]));
    doc.setCursor(RATE);
    doc.controls.set(id, 'volume', -6, 'change');
    expect(S.findTrack(doc.state, id).automation.volume).toEqual([{ t: 0, v: 0 }, { t: RATE, v: -6 }]);
    expect(doc.controls.value(S.findTrack(doc.state, id), 'volume', RATE / 2)).toBe(-3);
  });
});
