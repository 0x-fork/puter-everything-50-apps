// Parameter schema helpers shared by effect dialogs, the Effects Rack and
// favorites: value sanitising, slider position mapping (linear and log),
// display formatting and parsing, and linked parameters.
//
// Param types (see registry.js): 'number' (default), 'bool', 'choice', plus
// the data types 'envelope' ([{ t: 0..1, v }], fade/gain envelopes, pitch
// bend), 'curve' ([{ f: Hz, g: dB }], FFT filter) and 'transfer' ([{ x, y }],
// input to output level in dB, Dynamics Processing), edited graphically.
//
// Linked sliders: a bool param with id 'linked' (or 'link') ties together the
// number params before it that share its group's unit and range (Amplify's
// left and right gain). While it is on, moving one moves the others by the
// same amount.

const typeOf = (p) => p.type || (p.options ? 'choice' : 'number');

export function paramType(p) {
  return typeOf(p);
}

function decimalsFor(step) {
  if (!step || step >= 1) return 0;
  return Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

export function roundToStep(v, step, min = 0) {
  if (!step) return v;
  const base = Number.isFinite(min) ? min : 0;
  const r = base + Math.round((v - base) / step) * step;
  return Number(r.toFixed(decimalsFor(step)));
}

/** Clamps and rounds one value to its param's range, type and step. */
export function coerce(p, v) {
  const t = typeOf(p);
  if (t === 'bool') return typeof v === 'string' ? v === 'true' || v === '1' : Boolean(v);
  if (t === 'choice') {
    const opts = p.options || [];
    const hit = opts.find((o) => String(o.value) === String(v));
    return hit ? hit.value : (p.default ?? opts[0]?.value);
  }
  if (t === 'envelope') {
    if (!Array.isArray(v) || v.length < 2) return structuredClone(p.default);
    return v.map((pt) => ({ t: Math.min(1, Math.max(0, Number(pt.t) || 0)), v: Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, Number(pt.v) || 0)) })).sort((a, b) => a.t - b.t);
  }
  if (t === 'curve') {
    if (!Array.isArray(v) || !v.length) return structuredClone(p.default);
    return v.map((pt) => ({ f: Math.max(1, Number(pt.f) || 1), g: Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, Number(pt.g) || 0)) })).sort((a, b) => a.f - b.f);
  }
  if (t === 'transfer') {
    if (!Array.isArray(v) || v.length < 2) return structuredClone(p.default);
    const lo = p.min ?? -100;
    const hi = p.max ?? 0;
    const pts = v.map((pt) => ({ x: Math.min(hi, Math.max(lo, Number(pt.x) || 0)), y: Math.min(hi, Math.max(lo, Number(pt.y) || 0)) })).sort((a, b) => a.x - b.x);
    // The ends span the whole input range so the curve is defined everywhere.
    pts[0] = { ...pts[0], x: lo };
    pts[pts.length - 1] = { ...pts[pts.length - 1], x: hi };
    return pts;
  }
  let n = Number(v);
  if (!Number.isFinite(n)) n = Number(p.default) || 0;
  const min = p.min ?? -Infinity;
  const max = p.max ?? Infinity;
  n = Math.min(max, Math.max(min, n));
  return roundToStep(n, p.step, Number.isFinite(min) ? min : 0);
}

/** Full, valid values for a definition from partial (or stale) values. Unknown keys are dropped. */
export function normalizeValues(def, values = {}) {
  const out = {};
  for (const p of def.params) out[p.id] = coerce(p, values?.[p.id] !== undefined ? values[p.id] : p.default);
  return out;
}

export function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --------------------------------------------------------- slider mapping

const isLog = (p) => p.scale === 'log' && p.min > 0 && p.max > p.min;

/** Slider position in [0, 1] for value v. */
export function toPosition(p, v) {
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  if (max === min) return 0;
  v = Math.min(max, Math.max(min, v));
  if (isLog(p)) return Math.log(v / min) / Math.log(max / min);
  return (v - min) / (max - min);
}

/** Value for slider position x in [0, 1], rounded to the param step. */
export function fromPosition(p, x) {
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  x = Math.min(1, Math.max(0, x));
  const v = isLog(p) ? min * Math.pow(max / min, x) : min + (max - min) * x;
  return coerce(p, isLog(p) ? roundLog(v, p.step) : v);
}

// Log-scaled values keep about three significant digits instead of snapping to the step.
function roundLog(v, step) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 2);
  const r = Math.round(v / mag) * mag;
  return step ? Math.max(step, r) : r;
}

// ------------------------------------------------------ format and parse

/** Display text for a value with its unit: "-3.0 dB", "1.25 kHz", "40 %", "4:1". */
export function formatValue(p, v) {
  const t = typeOf(p);
  if (t === 'bool') return v ? 'On' : 'Off';
  if (t === 'choice') return (p.options || []).find((o) => String(o.value) === String(v))?.label ?? String(v);
  if (t === 'envelope' || t === 'curve' || t === 'transfer') return `${v?.length || 0} points`;
  if (!Number.isFinite(v)) return v === -Infinity ? '-inf' : String(v);
  const unit = p.unit || '';
  const d = decimalsFor(p.step);
  if (unit === 'Hz' && Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${k.toFixed(k >= 10 ? 1 : 2).replace(/\.?0+$/, '')} kHz`;
  }
  if (unit === 'ms' && Math.abs(v) >= 1000 && !p.keepUnit) return `${(v / 1000).toFixed(2)} s`;
  if (unit === ':1') return `${v.toFixed(d)}:1`;
  const text = isLog(p) && !p.step ? String(Number(v.toPrecision(3))) : v.toFixed(d);
  return unit ? `${text} ${unit}` : text;
}

/** Parses typed text ("2k", "2.5 kHz", "-3", "150ms", "1.5 s", "4:1") into a value in the param's unit. */
export function parseValue(p, text) {
  const s = String(text).trim().toLowerCase().replace(',', '.');
  if (s === '-inf' || s === '-infinity') return p.min ?? -Infinity;
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-z%:]*)/);
  if (!m) return NaN;
  let v = Number(m[1]);
  const suffix = m[2] || '';
  const unit = (p.unit || '').toLowerCase();
  if (unit === 'hz' && (suffix === 'k' || suffix === 'khz')) v *= 1000;
  else if (unit === 'ms' && suffix === 's') v *= 1000;
  else if (unit === 's' && suffix === 'ms') v /= 1000;
  return v;
}

// --------------------------------------------------------- linked params

/** Ids of the params linked by `linked`/`link` bool params: [[id, id], ...]. */
export function linkGroups(def) {
  const groups = [];
  def.params.forEach((p, i) => {
    if (typeOf(p) !== 'bool' || !/^link(ed)?$/i.test(p.id)) return;
    const before = def.params.slice(0, i).filter((q) => typeOf(q) === 'number');
    const last = before[before.length - 1];
    if (!last) return;
    const ids = before.filter((q) => q.unit === last.unit && q.min === last.min && q.max === last.max).map((q) => q.id);
    if (ids.length > 1) groups.push({ link: p.id, ids });
  });
  return groups;
}

/**
 * Sets values[id] = v and moves linked params by the same delta while their
 * link is on. Returns a new values object.
 */
export function setLinked(def, values, id, v, groups = linkGroups(def)) {
  const p = def.params.find((q) => q.id === id);
  if (!p) return values;
  const next = { ...values, [id]: coerce(p, v) };
  const delta = next[id] - values[id];
  for (const g of groups) {
    if (!values[g.link] || !g.ids.includes(id) || !Number.isFinite(delta)) continue;
    for (const other of g.ids) {
      if (other === id) continue;
      const q = def.params.find((x) => x.id === other);
      next[other] = coerce(q, values[other] + delta);
    }
  }
  return next;
}
