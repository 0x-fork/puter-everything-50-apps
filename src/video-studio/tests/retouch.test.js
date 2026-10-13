import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/media/segmenter.js', () => ({
  SEG_SIZE: 256,
  segment: () => null,
  ready: vi.fn(() => Promise.resolve(false)),
  segmenterState: () => 'idle',
  segmenterError: () => '',
  onSegmenterChange: () => () => {},
}));
vi.mock('../src/media/face-landmarks.js', () => ({
  MAX_FACES: 3,
  FACE_POINTS: 478,
  detectFaces: () => null,
  faceModelReady: vi.fn(() => Promise.resolve(false)),
  faceModelState: () => 'idle',
  faceModelError: () => '',
  onFaceModelChange: () => () => {},
}));
vi.mock('../src/media/hair-segmenter.js', () => ({
  HAIR_SIZE: 512,
  segmentHair: () => null,
  hairModelReady: vi.fn(() => Promise.resolve(false)),
  hairModelState: () => 'idle',
  hairModelError: () => '',
  onHairModelChange: () => () => {},
}));

import {
  RETOUCH_DEFAULT, LIP_COLOR_DEFAULT, normalizeRetouch, retouchAmounts, skinFixAmounts, normalizeFaceShape, faceShapeAmounts,
  normalizeHairColor, hairColorOn, faceModelsFor, HAIR_SWATCHES,
} from '../src/model/retouch.js';
import { faceModelReady } from '../src/media/face-landmarks.js';
import { hairModelReady } from '../src/media/hair-segmenter.js';
import { normalizeClip, makeClip, createProject } from '../src/model/project.js';
import { usesCutout, ensureCutout } from '../src/engine/cutout.js';
import { evaluate } from '../src/engine/scene.js';
import { LAYER_FS } from '../src/engine/shaders.js';
import { attributeGroupsFor, captureAttributes, applyAttributes } from '../src/ui/organize-actions.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

describe('retouch model', () => {
  it('normalizes values to 0..100', () => {
    expect(normalizeRetouch({ smooth: 140, even: -3, brighten: '20', sharpen: null })).toEqual({ smooth: 100, even: 0, brighten: 20, sharpen: 0 });
    const v = normalizeClip({ ...makeClip('video', { assetId: 'a', duration: US }), retouch: { smooth: 30 } });
    expect(v.retouch).toEqual({ smooth: 30, even: 0, brighten: 0, sharpen: 0 });
  });

  it('only turns the shader on when something is set', () => {
    expect(retouchAmounts(null)).toBeNull();
    expect(retouchAmounts({ smooth: 0, even: 0, brighten: 0, sharpen: 0 })).toBeNull();
    expect(retouchAmounts(RETOUCH_DEFAULT)).toEqual([0.4, 0.2, 0.1, 0]);
  });

  it('needs the person matte, reaches the layer, and is its own attribute group', () => {
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true };
    const c = makeClip('video', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(c);
    c.retouch = { smooth: 0, even: 0, brighten: 0, sharpen: 0 };
    expect(usesCutout(p)).toBe(false);
    c.retouch.smooth = 50;
    expect(usesCutout(p)).toBe(true);
    expect(evaluate(p, US / 2).find((l) => l.clip?.id === c.id).retouch).toEqual(c.retouch);
    expect(attributeGroupsFor(c).map((g) => g.id)).toContain('retouch');
    expect(LAYER_FS).toMatch(/if \(u_retouchOn == 1\) c\.rgb = retouch\(uv, c\.rgb\)/);
  });

  it('keeps skin fixes only when set, with a lip color once lips are tinted', () => {
    expect(normalizeRetouch({ smooth: 10, blemishes: 30, darkCircles: 0, teeth: 120, lips: -5 })).toEqual({ smooth: 10, even: 0, brighten: 0, sharpen: 0, blemishes: 30, teeth: 100 });
    expect(normalizeRetouch({ lips: 40 })).toMatchObject({ lips: 40, lipColor: LIP_COLOR_DEFAULT });
    expect(normalizeRetouch({ lips: 40, lipColor: '#AA0011' }).lipColor).toBe('#aa0011');
    // A picked shade survives turning the tint down to nothing; junk does not.
    expect(normalizeRetouch({ lips: 0, lipColor: '#123456' })).toMatchObject({ lipColor: '#123456' });
    expect(normalizeRetouch({ lipColor: 'red' }).lipColor).toBeUndefined();
    expect(skinFixAmounts({ smooth: 50 })).toBeNull();
    expect(skinFixAmounts({ blemishes: 50, lips: 100 })).toEqual([0.5, 0, 0, 1]);
    // Skin fixes alone do not need the person matte.
    expect(retouchAmounts({ smooth: 0, even: 0, brighten: 0, sharpen: 0, teeth: 40 })).toBeNull();
  });

  it('normalizes face shape and hair color', () => {
    expect(normalizeFaceShape({ slim: 150, eyes: -30, nose: 'x', smile: '12', faces: 'everyone' })).toEqual({ slim: 100, eyes: -30, nose: 0, smile: 12, chin: 0, faces: 'all' });
    expect(normalizeFaceShape({ chin: -200, faces: 'largest' })).toEqual({ slim: 0, eyes: 0, nose: 0, smile: 0, chin: -100, faces: 'largest' });
    expect(faceShapeAmounts(normalizeFaceShape({}))).toBeNull();
    expect(faceShapeAmounts({ slim: 50, eyes: -100 })).toEqual({ slim: 0.5, eyes: -1, nose: 0, smile: 0, chin: 0 });
    expect(normalizeHairColor({ color: '#ABCDEF', strength: 140 })).toEqual({ color: '#abcdef', strength: 100 });
    expect(normalizeHairColor({ color: 'blue' }).strength).toBe(0);
    expect(hairColorOn({ color: '#abcdef', strength: 0 })).toBe(false);
    expect(hairColorOn({ color: '#abcdef', strength: 5 })).toBe(true);
    expect(HAIR_SWATCHES.every((s) => /^#[0-9a-f]{6}$/.test(s.color) && s.label)).toBe(true);
    const v = normalizeClip({ ...makeClip('video', { assetId: 'a', duration: US }), faceShape: { eyes: 20 }, hairColor: { color: '#112233', strength: 50 } });
    expect(v.faceShape).toEqual({ slim: 0, eyes: 20, nose: 0, smile: 0, chin: 0, faces: 'all' });
    expect(v.hairColor).toEqual({ color: '#112233', strength: 50 });
  });

  it('asks for the face model for face tools and hair, and the hair model for hair', () => {
    expect(faceModelsFor({ retouch: { smooth: 40 } })).toEqual({ face: false, hair: false });
    expect(faceModelsFor({ retouch: { teeth: 40 } })).toEqual({ face: true, hair: false });
    expect(faceModelsFor({ faceShape: { slim: -10 } })).toEqual({ face: true, hair: false });
    expect(faceModelsFor({ hairColor: { color: '#112233', strength: 50 } })).toEqual({ face: true, hair: true });
    expect(faceModelsFor({ disabled: true, faceShape: { slim: 10 } })).toEqual({ face: false, hair: false });
  });

  it('reaches the layer, tells the exporter to load the models, and is pasted with the retouch group', async () => {
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true };
    const c = makeClip('video', { assetId: 'a', duration: 2 * US });
    const d = makeClip('video', { assetId: 'a', duration: 2 * US, start: 2 * US });
    T.mainTrack(p).clips.push(c, d);
    expect(usesCutout(p)).toBe(false);
    c.faceShape = normalizeFaceShape({ slim: 30 });
    expect(usesCutout(p)).toBe(true);
    c.hairColor = { color: '#5e3424', strength: 70 };
    const layer = evaluate(p, US / 2).find((l) => l.clip?.id === c.id);
    expect(layer.faceShape).toEqual(c.faceShape);
    expect(layer.hairColor).toEqual(c.hairColor);
    faceModelReady.mockClear();
    hairModelReady.mockClear();
    expect(await ensureCutout(p)).toBe(false);
    expect(faceModelReady).toHaveBeenCalled();
    expect(hairModelReady).toHaveBeenCalled();
    const got = captureAttributes(c);
    expect(Object.keys(got.groups.retouch.values)).toEqual(['faceShape', 'hairColor']);
    applyAttributes(d, got, ['retouch'], c.duration);
    expect(d.faceShape).toEqual(c.faceShape);
    expect(d.hairColor).toEqual(c.hairColor);
    expect(LAYER_FS).toMatch(/vec2 uv = u_warpFaces > 0 \? warpUv\(v_uv\) : v_uv;/);
    expect(LAYER_FS).toMatch(/if \(u_faceFixOn == 1\) c\.rgb = faceFix\(uv, c\.rgb\)/);
    expect(LAYER_FS).toMatch(/if \(u_hairOn == 1\) c\.rgb = hairRecolor\(uv, c\.rgb\)/);
  });
});

describe('retouch panel', () => {
  let env;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'image', name: 'p.jpg', duration: 0, width: 800, height: 1000, fps: 0, hasVideo: false, hasAudio: false };
    const c = makeClip('image', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(c);
    const store = new EditorStore(p);
    const ctx = { store };
    ctx.actions = createActions(ctx);
    const insp = createInspector(ctx);
    document.body.append(insp.el);
    store.select(c.id);
    insp.showVideoSub('retouch');
    env = { store, el: insp.el, id: c.id };
  });
  afterEach(() => env.el.remove());
  const clip = () => T.findClip(env.store.project, env.id).clip;

  it('applies the natural look, edits one slider, and resets', () => {
    [...env.el.querySelectorAll('button')].find((b) => b.textContent === 'Natural look').click();
    expect(clip().retouch).toEqual(RETOUCH_DEFAULT);
    const input = [...env.el.querySelectorAll('.field')].find((f) => f.querySelector('.field-label')?.textContent === 'Sharpen').querySelector('input[type=range]');
    input.value = '35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(clip().retouch.sharpen).toBe(35);
    env.el.querySelector('[aria-label="Reset Skin"]').click();
    expect(clip().retouch).toBeUndefined();
    env.store.undo();
    expect(clip().retouch.sharpen).toBe(35);
  });

  const field = (label) => [...env.el.querySelectorAll('.field')].find((f) => f.querySelector('.field-label')?.textContent === label);
  const drag = (label, v) => {
    const input = field(label).querySelector('input[type=range]');
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('has Skin, Face and Hair sections', () => {
    const titles = [...env.el.querySelectorAll('.section-title')].map((t) => t.textContent);
    expect(titles).toEqual(expect.arrayContaining(['Skin', 'Face', 'Hair']));
  });

  it('sets skin fixes, and picking a lip shade turns the tint on', () => {
    faceModelReady.mockClear();
    drag('Blemishes', 60);
    expect(clip().retouch).toMatchObject({ blemishes: 60 });
    expect(faceModelReady).toHaveBeenCalled();
    const hex = field('Lip shade').querySelector('.hex-input');
    hex.value = '#7a2f4a';
    hex.dispatchEvent(new Event('change', { bubbles: true }));
    expect(clip().retouch).toMatchObject({ blemishes: 60, lips: 50, lipColor: '#7a2f4a' });
  });

  it('reshapes faces, picks which faces, and resets', () => {
    drag('Slimmer face', -40);
    expect(clip().faceShape).toEqual({ slim: -40, eyes: 0, nose: 0, smile: 0, chin: 0, faces: 'all' });
    [...env.el.querySelectorAll('[role=radio]')].find((b) => b.textContent === 'Largest face').click();
    expect(clip().faceShape.faces).toBe('largest');
    drag('Eye size', 25);
    expect(clip().faceShape).toMatchObject({ slim: -40, eyes: 25, faces: 'largest' });
    env.el.querySelector('[aria-label="Reset Face"]').click();
    expect(clip().faceShape).toBeUndefined();
    env.store.undo();
    expect(clip().faceShape.eyes).toBe(25);
  });

  it('picks a hair swatch at a medium strength, edits the strength, and resets', () => {
    hairModelReady.mockClear();
    const sw = env.el.querySelector(`[aria-label="${HAIR_SWATCHES[1].label}"]`);
    sw.click();
    expect(clip().hairColor).toEqual({ color: HAIR_SWATCHES[1].color, strength: 60 });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(hairModelReady).toHaveBeenCalled();
    drag('Strength', 85);
    expect(clip().hairColor.strength).toBe(85);
    env.el.querySelector('[aria-label="Reset Hair"]').click();
    expect(clip().hairColor).toBeUndefined();
  });
});
