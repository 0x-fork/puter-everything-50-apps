/**
 * People retouch on video and image clips, in three parts:
 *
 * clip.retouch (Skin), each 0..100. Applied in the layer shader to skin
 * tones on people (the person matte from engine/cutout.js keeps it off
 * skin-colored backgrounds such as sand or wood):
 *  - smooth:   edge-preserving smoothing of skin texture
 *  - even:     evens out blotchy color across the skin
 *  - brighten: lifts the light on skin
 *  - sharpen:  crisper detail everywhere except skin (eyes, hair, brows)
 * and fixes placed by the face landmarks (engine/face-render.js), stored only
 * when set:
 *  - blemishes:   fills small dark or red spots on the face
 *  - darkCircles: lifts the shadow under the eyes
 *  - teeth:       whitens teeth (less yellow, a little brighter)
 *  - lips:        tints the lips toward lipColor
 *
 * clip.faceShape (Face): slim, eyes, nose, smile, chin, each -100..100, a
 * gentle warp around the face landmarks; faces: 'all' or 'largest'.
 *
 * clip.hairColor (Hair): { color, strength 0..100 }, recolors hair found by
 * the hair matte around each face while keeping its light and dark strands.
 */
export const RETOUCH_KEYS = ['smooth', 'even', 'brighten', 'sharpen'];
export const SKIN_FIX_KEYS = ['blemishes', 'darkCircles', 'teeth', 'lips'];
export const RETOUCH_DEFAULT = Object.freeze({ smooth: 40, even: 20, brighten: 10, sharpen: 0 });
export const LIP_COLOR_DEFAULT = '#b8434e';

export const FACE_SHAPE_KEYS = ['slim', 'eyes', 'nose', 'smile', 'chin'];
export const FACE_SHAPE_DEFAULT = Object.freeze({ slim: 0, eyes: 0, nose: 0, smile: 0, chin: 0, faces: 'all' });

export const HAIR_COLOR_DEFAULT = Object.freeze({ color: '#8a3b1f', strength: 0 });
/** Starting points for hair color. */
export const HAIR_SWATCHES = Object.freeze([
  { label: 'Copper', color: '#a4471f' },
  { label: 'Honey blonde', color: '#c8a064' },
  { label: 'Chestnut', color: '#5e3424' },
  { label: 'Jet black', color: '#1b1a1f' },
  { label: 'Silver', color: '#b8bcc4' },
  { label: 'Rose', color: '#c45a7c' },
  { label: 'Violet', color: '#6a4aa8' },
  { label: 'Teal', color: '#2f8a8c' },
]);

const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : null);

export function normalizeRetouch(r) {
  const out = {};
  for (const k of RETOUCH_KEYS) out[k] = clamp(num(r?.[k], 0), 0, 100);
  for (const k of SKIN_FIX_KEYS) {
    const v = clamp(num(r?.[k], 0), 0, 100);
    if (v > 0) out[k] = v;
  }
  const lip = hex(r?.lipColor);
  if (lip || out.lips) out.lipColor = lip || LIP_COLOR_DEFAULT;
  return out;
}

/** Shader amounts (0..1) of the skin retouch, or null when it does nothing. */
export function retouchAmounts(r) {
  if (!r) return null;
  const v = RETOUCH_KEYS.map((k) => (r[k] || 0) / 100);
  return v.some((x) => x > 0) ? v : null;
}

/** Shader amounts (0..1) of the face-placed skin fixes, or null when none is on. */
export function skinFixAmounts(r) {
  if (!r) return null;
  const v = SKIN_FIX_KEYS.map((k) => clamp((r[k] || 0) / 100, 0, 1));
  return v.some((x) => x > 0) ? v : null;
}

export function normalizeFaceShape(f) {
  const out = {};
  for (const k of FACE_SHAPE_KEYS) out[k] = clamp(num(f?.[k], 0), -100, 100);
  out.faces = f?.faces === 'largest' ? 'largest' : 'all';
  return out;
}

/** Warp amounts (-1..1) by key, or null when the face is left as it is. */
export function faceShapeAmounts(f) {
  if (!f) return null;
  const out = {};
  let any = false;
  for (const k of FACE_SHAPE_KEYS) {
    out[k] = clamp((f[k] || 0) / 100, -1, 1);
    any ||= out[k] !== 0;
  }
  return any ? out : null;
}

export function normalizeHairColor(hc) {
  return { color: hex(hc?.color) || HAIR_COLOR_DEFAULT.color, strength: clamp(num(hc?.strength, 0), 0, 100) };
}

export const hairColorOn = (hc) => Boolean(hc && hc.strength > 0 && hex(hc.color));

/** Which landmark and hair models a clip needs (besides the person matte). Hair is looked for around faces. */
export function faceModelsFor(clip) {
  if (!clip || clip.disabled) return { face: false, hair: false };
  const hair = hairColorOn(clip.hairColor);
  return {
    face: Boolean(hair || skinFixAmounts(clip.retouch) || faceShapeAmounts(clip.faceShape)),
    hair,
  };
}
