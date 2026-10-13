/**
 * Video > Retouch, for people in the shot (model/retouch.js):
 *  - Skin: smoothing, even tone, brighten and detail sharpening, plus
 *    blemish, dark circle, teeth and lip fixes placed by face landmarks
 *  - Face: a gentle reshape of the face, eyes, nose, smile and chin
 *  - Hair: a new hair color that keeps the hair's own light and shade
 * Each part is stored once a slider moves; its Reset removes it.
 */
import { h, announce } from '../../lib/dom.js';
import { slider, color, propSection } from './common.js';
import { segmented } from '../controls.js';
import {
  RETOUCH_DEFAULT, LIP_COLOR_DEFAULT, FACE_SHAPE_DEFAULT, HAIR_COLOR_DEFAULT, HAIR_SWATCHES,
  normalizeRetouch, retouchAmounts, skinFixAmounts, normalizeFaceShape, faceShapeAmounts, normalizeHairColor, hairColorOn,
} from '../../model/retouch.js';
import { ready, segmenterState, segmenterError, onSegmenterChange } from '../../media/segmenter.js';
import { faceModelReady, faceModelState, faceModelError, onFaceModelChange } from '../../media/face-landmarks.js';
import { hairModelReady, hairModelState, hairModelError, onHairModelChange } from '../../media/hair-segmenter.js';

const SKIN = [
  { key: 'smooth', label: 'Smooth skin' },
  { key: 'even', label: 'Even tone' },
  { key: 'brighten', label: 'Brighten' },
  { key: 'sharpen', label: 'Sharpen' },
];
const FIXES = [
  { key: 'blemishes', label: 'Blemishes' },
  { key: 'darkCircles', label: 'Dark circles' },
  { key: 'teeth', label: 'Whiten teeth' },
  { key: 'lips', label: 'Lip color' },
];
const SHAPE = [
  { key: 'slim', label: 'Slimmer face' },
  { key: 'eyes', label: 'Eye size' },
  { key: 'nose', label: 'Slimmer nose' },
  { key: 'smile', label: 'Smile' },
  { key: 'chin', label: 'Chin length' },
];

/** Status line for a model: loading text while it loads, its error if it fails. */
const modelStatus = (state, error, loading) => (state === 'loading' ? loading : state === 'failed' ? error : '');

/** Keep a panel in step with a model; the listener drops itself once the panel is gone. */
function follow(el, subscribe, render) {
  const off = subscribe(() => {
    if (!el.isConnected) off();
    else render();
  });
}

function skinSection(view) {
  const edit = (label, key, patch, final) => view.edit(label, (c) => {
    c.retouch = normalizeRetouch({ ...c.retouch, ...patch });
  }, { key: `retouch-${key}`, final });
  const field = (f, needsFace) => slider(view, {
    label: f.label,
    min: 0,
    max: 100,
    get: (c) => Math.round(c.retouch?.[f.key] || 0),
    set: (v, final) => {
      edit('Retouch', f.key, { [f.key]: v }, final);
      if (v > 0) (needsFace ? faceModelReady : ready)();
    },
  });
  const sliders = SKIN.map((f) => field(f, false));
  const fixes = FIXES.map((f) => field(f, true));
  const lipColor = color(view, {
    label: 'Lip shade',
    get: (c) => c.retouch?.lipColor || LIP_COLOR_DEFAULT,
    set: (v, final) => {
      // Picking a shade turns the tint on.
      edit('Lip color', 'lipColor', { lipColor: v, lips: view.clip?.retouch?.lips || 50 }, final);
      faceModelReady();
    },
  });
  const auto = h('button.btn.small', { type: 'button', 'data-tip': 'A natural starting point' }, 'Natural look');
  auto.addEventListener('click', () => {
    view.edit('Retouch', (c) => {
      c.retouch = normalizeRetouch({ ...c.retouch, ...RETOUCH_DEFAULT });
    });
    ready();
    announce('Retouch applied');
  });
  const status = h('p.asset-hint.cutout-status', { role: 'status' });
  const tip = h('p.asset-hint', 'Works on the skin of people in the shot; the background is left alone. The fixes below the line find faces first.');
  const render = () => {
    const c = view.clip;
    if (!c) return;
    const basic = retouchAmounts(c.retouch) ? modelStatus(segmenterState(), segmenterError(), 'Finding people in the shot...') : '';
    const face = skinFixAmounts(c.retouch) ? modelStatus(faceModelState(), faceModelError(), 'Finding faces...') : '';
    status.textContent = basic || face;
    status.hidden = !status.textContent;
  };
  render();
  view.bind(render);
  const el = propSection('Skin', [
    h('div.retouch-actions', auto),
    ...sliders.map((s) => s.el),
    h('hr.retouch-rule', { 'aria-hidden': 'true' }),
    ...fixes.map((s) => s.el),
    lipColor.el,
    status,
    tip,
  ], {
    onReset: () => {
      view.edit('Reset skin retouch', (c) => {
        if (!c.retouch) return false;
        delete c.retouch;
      });
      announce('Skin retouch reset');
    },
  });
  follow(el, onSegmenterChange, render);
  follow(el, onFaceModelChange, render);
  return el;
}

function faceSection(view) {
  const cur = (c) => c.faceShape || FACE_SHAPE_DEFAULT;
  const edit = (label, key, patch, final) => view.edit(label, (c) => {
    c.faceShape = normalizeFaceShape({ ...cur(c), ...patch });
  }, { key: `face-${key}`, final });
  const which = segmented({
    label: 'Which faces',
    options: [{ value: 'all', label: 'All faces' }, { value: 'largest', label: 'Largest face' }],
    value: cur(view.clip || {}).faces,
    onChange: (v) => edit('Which faces', 'faces', { faces: v }, true),
  });
  view.bind(() => {
    const c = view.clip;
    if (c) which.set(cur(c).faces);
  });
  const sliders = SHAPE.map((f) => slider(view, {
    label: f.label,
    min: -100,
    max: 100,
    get: (c) => Math.round(c.faceShape?.[f.key] || 0),
    set: (v, final) => {
      edit('Face shape', f.key, { [f.key]: v }, final);
      if (v) faceModelReady();
    },
  }));
  const status = h('p.asset-hint.cutout-status', { role: 'status' });
  const tip = h('p.asset-hint', 'Small amounts look most natural. Negative values go the other way (fuller face, smaller eyes, a frown).');
  const render = () => {
    const c = view.clip;
    if (!c) return;
    status.textContent = faceShapeAmounts(c.faceShape) ? modelStatus(faceModelState(), faceModelError(), 'Finding faces...') : '';
    status.hidden = !status.textContent;
  };
  render();
  view.bind(render);
  const el = propSection('Face', [h('div.field', h('span.field-label', 'Which faces'), which.el), ...sliders.map((s) => s.el), status, tip], {
    onReset: () => {
      view.edit('Reset face shape', (c) => {
        if (!c.faceShape) return false;
        delete c.faceShape;
      });
      announce('Face shape reset');
    },
  });
  follow(el, onFaceModelChange, render);
  return el;
}

function hairSection(view) {
  const cur = (c) => c.hairColor || HAIR_COLOR_DEFAULT;
  const edit = (label, key, patch, final) => {
    view.edit(label, (c) => {
      c.hairColor = normalizeHairColor({ ...cur(c), ...patch });
    }, { key: `hair-${key}`, final });
    if (hairColorOn(view.clip?.hairColor)) {
      faceModelReady();
      hairModelReady();
    }
  };
  // A color without strength would do nothing, so picking one starts at a medium strength.
  const pick = (hex, final) => edit('Hair color', 'color', { color: hex, strength: cur(view.clip).strength || 60 }, final);
  const swatches = h('div.marker-swatches.hair-swatches', { role: 'radiogroup', 'aria-label': 'Hair color presets' }, HAIR_SWATCHES.map((s) => {
    const b = h('button.marker-swatch', { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': s.label, 'data-tip': s.label, style: { '--swatch': s.color } });
    b.addEventListener('click', () => {
      pick(s.color, true);
      announce(`Hair color ${s.label}`);
    });
    return b;
  }));
  const picker = color(view, { label: 'Hair color', get: (c) => cur(c).color, set: (v, final) => pick(v, final) });
  const strength = slider(view, {
    label: 'Strength',
    min: 0,
    max: 100,
    get: (c) => Math.round(cur(c).strength),
    set: (v, final) => edit('Hair color strength', 'strength', { strength: v }, final),
  });
  const status = h('p.asset-hint.cutout-status', { role: 'status' });
  const render = () => {
    const c = view.clip;
    if (!c) return;
    const col = cur(c).color;
    swatches.querySelectorAll('.marker-swatch').forEach((b, i) => b.setAttribute('aria-checked', String(HAIR_SWATCHES[i].color === col && hairColorOn(c.hairColor))));
    status.textContent = hairColorOn(c.hairColor) ? modelStatus(faceModelState(), faceModelError(), 'Finding faces...') || modelStatus(hairModelState(), hairModelError(), 'Finding hair...') : '';
    status.hidden = !status.textContent;
  };
  render();
  view.bind(render);
  const tip = h('p.asset-hint', 'Recolors the hair around each face in the shot.');
  const el = propSection('Hair', [h('div.field', h('span.field-label', 'Presets'), swatches), picker.el, strength.el, status, tip], {
    onReset: () => {
      view.edit('Reset hair color', (c) => {
        if (!c.hairColor) return false;
        delete c.hairColor;
      });
      announce('Hair color reset');
    },
  });
  follow(el, onHairModelChange, render);
  follow(el, onFaceModelChange, render);
  return el;
}

export function retouchTab(view) {
  return h('div', skinSection(view), faceSection(view), hairSection(view));
}
