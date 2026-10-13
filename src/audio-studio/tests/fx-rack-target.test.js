// Effects Rack targets: in a multitrack session the panel edits the selected
// clip's or track's effect chain (Edit Clip / Track Effects in Effects Rack).
import { describe, it, expect } from 'vitest';
import { Channel } from '../src/audio/channel.js';
import { AudioFile } from '../src/model/audio-file.js';
import { Session } from '../src/model/session.js';
import * as S from '../src/model/session-edits.js';
import { registerEffect } from '../src/effects/registry.js';
import { makeSlot } from '../src/effects/rack.js';
import { effectsRackPanel, installRackCommands, sessionRackTarget, setRackTarget, rackTargetKind } from '../src/effects/rack-panel.js';
import { MENUS } from '../src/ui/menus.js';
import { fakeApp, filled } from './fx-helpers.js';

registerEffect({ id: 'rtgA', name: 'Target A', group: 'Modulation', kind: 70, params: [{ id: 'x', min: 0, max: 1, default: 0.5 }] });

function setup() {
  const app = fakeApp();
  let opened = null;
  app.dock = { openPanel: (id) => (opened = id) };
  installRackCommands(app);
  let state = S.createSessionState({ sampleRate: 1000, tracks: 2 });
  const clip = S.createClip({ trackId: state.tracks[1].id, sourceId: 'src', name: 'Vocal', start: 0, length: 100 });
  state = S.addClips(state, [clip]);
  const doc = new Session({ name: 'S', state });
  doc.on('change', (e) => app.emit('doc-change', doc, e));
  app.active = doc;
  return { app, doc, clip, opened: () => opened };
}

describe('session rack targets', () => {
  it('adds the menu entries under Show Effects Rack', () => {
    const fx = MENUS.find((m) => m.label === 'Effects').submenu;
    expect(fx.slice(0, 3)).toEqual(['fx.showRack', 'fx.editClipEffects', 'fx.editTrackEffects']);
  });

  it('commands need a clip or track selection and open the panel on that chain', async () => {
    const { app, doc, clip, opened } = setup();
    expect(app.commands.isEnabled('fx.editClipEffects')).toBe(false);
    expect(app.commands.isEnabled('fx.editTrackEffects')).toBe(true);
    doc.selectClips([clip.id]);
    expect(app.commands.isEnabled('fx.editClipEffects')).toBe(true);
    await app.commands.run('fx.editClipEffects');
    expect(rackTargetKind(app)).toBe('clip');
    expect(opened()).toBe('effects');
    await app.commands.run('fx.editTrackEffects');
    expect(rackTargetKind(app)).toBe('track');
    // Clip selection also selects its track.
    expect(sessionRackTarget(doc, 'track').id).toBe(clip.trackId);
  });

  it('edits the selected track and clip chains as undoable session steps', () => {
    const { app, doc, clip } = setup();
    doc.selectClips([clip.id]);
    const panel = effectsRackPanel(app);
    document.body.append(panel.el);
    const radios = [...panel.el.querySelectorAll('.rack-target-btn')];
    expect(radios.map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(radios[0].disabled).toBe(true);
    expect(panel.el.querySelector('.rack-target-name').textContent).toBe(`Track: ${S.findTrack(doc.state, clip.trackId).name}`);
    expect(panel.el.querySelector('.rack-footer').hidden).toBe(true);

    // Track chain: choose an effect for slot 1, then bypass the track's effects.
    let menu = null;
    app.openMenu = (items) => (menu = items);
    panel.el.querySelector('.rack-name').click();
    menu.find((m) => m.label === 'Modulation').items.find((i) => i.label === 'Target A').run();
    const track = () => S.findTrack(doc.state, clip.trackId);
    expect(track().fx[0].effect).toBe('rtgA');
    expect(doc.history.undoLabel).toBe('Track Effects');
    panel.el.querySelector('.rack-master-power').click();
    expect(track().fxPower).toBe(false);
    expect(panel.el.querySelector('.rack-list').classList.contains('off')).toBe(true);

    // Clip chain.
    radios[1].click();
    expect(radios[1].getAttribute('aria-checked')).toBe('true');
    expect(panel.el.querySelector('.rack-target-name').textContent).toBe('Clip: Vocal');
    expect(panel.el.querySelector('.rack-master-power').hidden).toBe(true);
    expect(panel.el.querySelector('.rack-label').textContent).toBe('');
    panel.el.querySelectorAll('.rack-name')[3].click();
    menu.find((m) => m.label === 'Modulation').items.find((i) => i.label === 'Target A').run();
    // Clip chains have no holes: the effect lands first.
    expect(S.findClip(doc.state, clip.id).fx.map((s) => s.effect)).toEqual(['rtgA']);
    expect(doc.history.undoLabel).toBe('Clip Effects');
    expect(panel.el.querySelector('.rack-label').textContent).toBe('Target A');

    // Nothing selected: a hint instead of the slots.
    doc.selectClips([]);
    expect(panel.el.querySelector('.rack-missing').hidden).toBe(false);
    expect(panel.el.querySelector('.rack-missing').textContent).toMatch(/Select a clip/);
    panel.el.remove();
  });

  it('shows the file rack for audio files', () => {
    const { app } = setup();
    setRackTarget(app, 'clip');
    app.active = new AudioFile({ name: 'a.wav', sampleRate: 1000, channels: [Channel.fromSamples(filled(100, 0.1))] });
    const panel = effectsRackPanel(app);
    const radios = [...panel.el.querySelectorAll('.rack-target-btn')];
    expect(radios.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios[1].disabled).toBe(true);
    expect(panel.el.querySelector('.rack-footer').hidden).toBe(false);
    expect(panel.el.querySelector('.rack-target-name').textContent).toBe('a.wav');
    expect(makeSlot('rtgA').effect).toBe('rtgA');
  });
});
