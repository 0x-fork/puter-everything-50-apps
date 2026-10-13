/**
 * Text layout for point, area, vertical and path type with per-character
 * style runs.
 *
 * Layout works in a "flow space": u runs along a line (left to right for
 * horizontal type, top to bottom for vertical type, along the path for type
 * on a path) and v is the line's baseline position across lines. The
 * layout's frame maps flow space to the node's local space (before its
 * transform). Every consumer (canvas drawing, hit testing, the caret,
 * selection highlights and outline conversion) reads the same per-character
 * positions, so what you see, what you click and what Create Outlines
 * produces agree.
 *
 * Measurement uses a shared Canvas 2D context (the same engine that draws),
 * caching per-character advances and kerning pairs per font. Without a
 * canvas (tests, workers) it measures with registered opentype.js fonts,
 * and falls back to an approximation.
 */
import { styledRuns, paragraphRanges, paraAt, baseStyle } from './text-runs.js';
import { flattenPath, pathBounds } from './bezier.js';

// ---- font hooks and caches ----

/**
 * Hooks set by the type feature:
 *   ensureFont(style)  starts loading a font a layout uses (called once per
 *                      font per generation).
 *   shape(style, text, start, end, chars, key)
 *                      applies OpenType substitutions to a run: may set
 *                      chars.glyph[i] (a glyph index, or -1 for a character
 *                      merged into the ligature before it) and adjust adv, gw
 *                      and kern. Returns true when it shaped anything.
 *   glyphPath(style, glyph, size)
 *                      Path2D of a glyph index (origin on the baseline, y down)
 *                      or null while the font's outlines are not available.
 *   story(node)        the threaded frames of an area type node (first frame,
 *                      which holds the text, first; `node` itself in its
 *                      place), or null.
 *   wraps(node)        text wrap obstacles for an area type node:
 *                      { deps: [nodes they come from], list: [{ polys (in the
 *                      node's local space), offset, invert }] }, or null.
 */
export const textHooks = { ensureFont: null, shape: null, glyphPath: null, story: null, wraps: null };

let generation = 0;
let layoutCache = new WeakMap();
let storyCache = new WeakMap(); // first frame of a threaded story -> layouts of every frame
const widthCache = new Map(); // font key -> Map(char -> width at 100px)
const kernCache = new Map(); // font key -> Map(pair -> kerning at 100px)
const metricCache = new Map(); // font key -> { ascent, descent, capHeight, xHeight } at 100px
const ensured = new Set();
const otFonts = new Map(); // family (lower case) -> [{ weight, style, font }]

/** Fonts changed (a face finished loading): drop measurement and layout caches. */
export function invalidateTextLayout() {
  generation++;
  layoutCache = new WeakMap();
  storyCache = new WeakMap();
  widthCache.clear();
  kernCache.clear();
  metricCache.clear();
  ensured.clear();
}

export function fontGeneration() {
  return generation;
}

/** Register a parsed opentype.js font for measuring without a canvas. */
export function registerMeasureFont(family, weight, style, font) {
  const k = family.toLowerCase();
  const list = otFonts.get(k) || [];
  list.push({ weight: Number(weight) || 400, style: style || 'normal', font });
  otFonts.set(k, list);
  invalidateTextLayout();
}

function otFontFor(style) {
  const list = otFonts.get(String(style.fontFamily || '').toLowerCase());
  if (!list || !list.length) return null;
  const w = Number(style.fontWeight) || 400;
  const italic = style.fontStyle === 'italic';
  let best = null;
  let bestD = Infinity;
  for (const f of list) {
    const d = Math.abs(f.weight - w) + ((f.style === 'italic') === italic ? 0 : 1000);
    if (d < bestD) {
      bestD = d;
      best = f.font;
    }
  }
  return best;
}

let measureCtx = null;
let triedCtx = false;

function ctx() {
  if (measureCtx || triedCtx) return measureCtx;
  triedCtx = true;
  try {
    if (typeof OffscreenCanvas !== 'undefined') measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
    else if (typeof document !== 'undefined' && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || ''))) {
      measureCtx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    measureCtx = null;
  }
  return measureCtx || null;
}

export function quoteFamily(family) {
  const f = String(family || 'sans-serif');
  return /^[a-z-]+$/i.test(f) && !/\s/.test(f) ? f : `"${f.replace(/"/g, '')}"`;
}

/** CSS font shorthand for a character style at a pixel size. */
export function cssFont(style, size = style.fontSize) {
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight || 400} ${size}px ${quoteFamily(style.fontFamily)}, sans-serif`;
}

function fontKey(style) {
  return cssFont(style, 100);
}

function ensureFont(style, key) {
  if (ensured.has(key)) return;
  ensured.add(key);
  textHooks.ensureFont?.(style);
}

function width100(style, key, ch) {
  let m = widthCache.get(key);
  if (!m) {
    m = new Map();
    widthCache.set(key, m);
  }
  let w = m.get(ch);
  if (w !== undefined) return w;
  const c = ctx();
  if (c) {
    c.font = key;
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    w = c.measureText(ch).width;
  } else {
    const ot = otFontFor(style);
    if (ot) {
      const g = ot.charToGlyph(ch);
      w = ((g?.advanceWidth || 0) * 100) / ot.unitsPerEm;
    } else w = ch === ' ' ? 27 : /[iljtf.,;:'!|]/.test(ch) ? 28 : /[mwMW]/.test(ch) ? 85 : /[A-Z]/.test(ch) ? 66 : 55;
  }
  m.set(ch, w);
  return w;
}

function kern100(style, key, a, b) {
  let m = kernCache.get(key);
  if (!m) {
    m = new Map();
    kernCache.set(key, m);
  }
  const pair = a + b;
  let k = m.get(pair);
  if (k !== undefined) return k;
  const c = ctx();
  if (c) {
    c.font = key;
    k = c.measureText(pair).width - width100(style, key, a) - width100(style, key, b);
    if (Math.abs(k) < 1e-3) k = 0;
  } else {
    const ot = otFontFor(style);
    k = 0;
    if (ot) {
      try {
        k = (ot.getKerningValue(ot.charToGlyph(a), ot.charToGlyph(b)) * 100) / ot.unitsPerEm;
      } catch {
        k = 0;
      }
    }
  }
  m.set(pair, k);
  return k;
}

/** Vertical metrics at 100px: { ascent, descent, capHeight, xHeight }. */
function metrics100(style, key) {
  let m = metricCache.get(key);
  if (m) return m;
  const c = ctx();
  if (c) {
    c.font = key;
    const t = c.measureText('Hxgjpq');
    const h = c.measureText('H');
    const x = c.measureText('x');
    if (t.fontBoundingBoxAscent) {
      m = { ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent, capHeight: h.actualBoundingBoxAscent || 70, xHeight: x.actualBoundingBoxAscent || 50 };
    }
  }
  if (!m) {
    const ot = otFontFor(style);
    if (ot) {
      const s = 100 / ot.unitsPerEm;
      const os2 = ot.tables?.os2;
      m = {
        ascent: ot.ascender * s,
        descent: -ot.descender * s,
        capHeight: (os2?.sCapHeight || ot.ascender * 0.7) * s,
        xHeight: (os2?.sxHeight || ot.ascender * 0.5) * s,
      };
    }
  }
  if (!m) m = { ascent: 80, descent: 20, capHeight: 70, xHeight: 50 };
  metricCache.set(key, m);
  return m;
}

export function leadingOf(style) {
  return style.leading ?? style.fontSize * 1.2;
}

/** Ascent and descent for a style at its size. */
export function fontMetrics(style) {
  const key = fontKey(style);
  const m = metrics100(style, key);
  return { ascent: (m.ascent * style.fontSize) / 100, descent: (m.descent * style.fontSize) / 100 };
}

/** Vertical metrics for a style at its size: { ascent, descent, capHeight, xHeight } (positive distances from the baseline). */
export function glyphMetrics(style) {
  const m = metrics100(style, fontKey(style));
  const k = style.fontSize / 100;
  return { ascent: m.ascent * k, descent: m.descent * k, capHeight: m.capHeight * k, xHeight: m.xHeight * k };
}

export function applyCaps(text, style) {
  return style.caps === 'all' || style.caps === 'small' ? String(text).toUpperCase() : text;
}

/** Width of a string in one style, including kerning pairs, tracking and horizontal scale. */
export function measure(text, style) {
  const key = fontKey(style);
  ensureFont(style, key);
  const s = applyCaps(String(text), style);
  let w = 0;
  let prev = null;
  for (const ch of s) {
    w += width100(style, key, ch);
    if (prev) w += kern100(style, key, prev, ch);
    prev = ch;
  }
  const track = ((style.tracking || 0) / 1000) * style.fontSize;
  return ((w * style.fontSize) / 100) * ((style.horizontalScale ?? 100) / 100) + track * s.length;
}

// ---- per-character measurement ----

/** Plain number arrays: cheaper than typed arrays for the short-lived arrays layout makes. */
function zeros(n) {
  return new Array(n).fill(0);
}

const SMALL_CAPS = 0.7;
const SCRIPT_SIZE = 0.583;
const SCRIPT_SHIFT = 0.333;
export const TAB_WIDTH = 36;
/** Forced line break inside a paragraph (Type > Insert Break Character). */
export const LINE_SEP = '\u2028';
/** Discretionary hyphen. */
export const SHY = '\u00ad';

function isSpace(c) {
  return c === ' ' || c === '\t' || c === '\u3000' || c === '\u00a0';
}

function isCJK(c) {
  if (!c) return false;
  const n = c.charCodeAt(0);
  return (n >= 0x3040 && n <= 0x30ff) || (n >= 0x3400 && n <= 0x9fff) || (n >= 0xac00 && n <= 0xd7af) || (n >= 0xf900 && n <= 0xfaff) || (n >= 0xff00 && n <= 0xffef);
}

/** Display character and size factor for a character in a style (caps, small caps, super/subscript). */
export function displayOf(ch, style) {
  let c = ch;
  let scale = 1;
  if (style.caps === 'all') c = ch.toUpperCase();
  else if (style.caps === 'small') {
    const up = ch.toUpperCase();
    if (up !== ch && up.length === 1) {
      c = up;
      scale = SMALL_CAPS;
    }
  }
  if (c.length !== 1) c = ch;
  if (style.position === 'super' || style.position === 'sub') scale *= SCRIPT_SIZE;
  return { c, scale };
}

/** Baseline offset (positive = up) for a style: baseline shift plus super/subscript position. */
export function riseOf(style) {
  let r = style.baselineShift || 0;
  if (style.position === 'super') r += style.fontSize * SCRIPT_SHIFT;
  else if (style.position === 'sub') r -= style.fontSize * SCRIPT_SHIFT;
  return r;
}

/**
 * Per-character arrays for a text: display char, style, draw size, advance,
 * glyph width, natural kerning and manual kerning before the character, and
 * vertical metrics.
 */
function measureChars(node, text, vertical) {
  const n = text.length;
  const out = {
    disp: new Array(n),
    sty: new Array(n),
    size: zeros(n),
    adv: zeros(n),
    gw: zeros(n),
    kern: zeros(n),
    manual: zeros(n),
    asc: zeros(n),
    desc: zeros(n),
    lead: zeros(n),
    glyph: null, // shaped glyph indices (see textHooks.shape)
    shaped: false,
    vertical,
  };
  for (const run of styledRuns(node)) {
    const st = run.style;
    const key = fontKey(st);
    ensureFont(st, key);
    const m = metrics100(st, key);
    const hs = (st.horizontalScale ?? 100) / 100;
    const vs = (st.verticalScale ?? 100) / 100;
    const track = ((st.tracking || 0) / 1000) * st.fontSize;
    const manual = ((st.kerning || 0) / 1000) * st.fontSize;
    const lead = leadingOf(st);
    const asc = ((m.ascent * st.fontSize) / 100) * vs;
    const desc = ((m.descent * st.fontSize) / 100) * vs;
    let prev = null;
    let prevScale = 0;
    for (let i = run.start; i < run.end && i < n; i++) {
      const ch = text[i];
      const d = displayOf(ch, st);
      const size = st.fontSize * d.scale;
      out.disp[i] = d.c;
      out.sty[i] = st;
      out.size[i] = size;
      out.lead[i] = lead;
      out.asc[i] = vertical ? (st.fontSize * hs) / 2 : asc;
      out.desc[i] = vertical ? (st.fontSize * hs) / 2 : desc;
      out.manual[i] = manual;
      if (ch === '\n' || ch === LINE_SEP || ch === SHY) {
        // Breaks take no room; a discretionary hyphen shows only where a line breaks at it.
        out.adv[i] = 0;
        if (ch !== '\n') out.disp[i] = '';
        if (ch !== SHY) prev = null;
        continue;
      }
      const w = (width100(st, key, d.c) * size) / 100;
      out.gw[i] = w * hs;
      if (vertical) {
        out.adv[i] = st.fontSize * vs + track;
      } else {
        out.adv[i] = w * hs + track;
        if (prev && prevScale === d.scale) out.kern[i] = ((kern100(st, key, prev, d.c) * size) / 100) * hs;
      }
      prev = d.c;
      prevScale = d.scale;
    }
    if (textHooks.shape && run.end > run.start && textHooks.shape(st, text, run.start, Math.min(run.end, n), out, key)) out.shaped = true;
  }
  return out;
}

// ---- tabs, lists and margins ----

/**
 * Advance of the tab at i, `x` along the line (from the line start). Tab
 * stops are measured from the frame's left edge; `tc.origin` is where the
 * line starts relative to it. Center, right and decimal stops align the
 * text up to the next tab (decimal: up to its decimal character). Past the
 * last stop, default stops repeat every TAB_WIDTH.
 */
function tabAdvance(text, ch, i, x, tc, end) {
  const abs = (tc?.origin || 0) + x;
  let stop = null;
  if (tc?.stops) {
    for (const s of tc.stops) {
      if (s.pos > abs + 0.01) {
        stop = s;
        break;
      }
    }
  }
  if (!stop) {
    const next = (Math.floor(abs / TAB_WIDTH + 1e-6) + 1) * TAB_WIDTH;
    return { adv: next - abs, stop: null };
  }
  const align = stop.align || 'left';
  if (align === 'left') return { adv: stop.pos - abs, stop };
  const dec = stop.decimal || '.';
  let w = 0;
  let before = null;
  for (let j = i + 1; j < end; j++) {
    const c = text[j];
    if (c === '\t' || c === '\n' || c === LINE_SEP) break;
    if (align === 'decimal' && before === null && c === dec) before = w;
    if (j > i + 1) w += ch.kern[j] + ch.manual[j];
    w += ch.adv[j];
  }
  const lead = align === 'right' ? w : align === 'center' ? w / 2 : (before ?? w);
  return { adv: Math.max(0, stop.pos - abs - lead), stop };
}

/** Sorted tab stops of a paragraph (or null). */
function tabStops(para) {
  const t = para.tabs;
  if (!Array.isArray(t) || !t.length) return null;
  return t.slice().sort((a, b) => a.pos - b.pos);
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** A list number in a format: '1' decimal, '01' zero padded, 'a'/'A' letters, 'i'/'I' roman. */
export function formatListNumber(n, format = '1') {
  n = Math.max(0, Math.round(n));
  if (format === 'a' || format === 'A') {
    let s = '';
    let k = Math.max(1, n);
    while (k > 0) {
      k--;
      s = String.fromCharCode(97 + (k % 26)) + s;
      k = Math.floor(k / 26);
    }
    return format === 'A' ? s.toUpperCase() : s;
  }
  if (format === 'i' || format === 'I') {
    if (n <= 0 || n >= 4000) return String(n);
    let s = '';
    let k = n;
    for (const [v, r] of ROMAN) {
      while (k >= v) {
        s += r;
        k -= v;
      }
    }
    return format === 'I' ? s.toUpperCase() : s;
  }
  if (format === '01') return String(n).padStart(2, '0');
  return String(n);
}

/**
 * List marker text per paragraph (null where a paragraph is not in a list).
 * Consecutive numbered paragraphs count up; any other paragraph restarts
 * the count (at list.start, default 1).
 */
export function listLabels(node, text = String(node.text ?? '')) {
  const n = paragraphRanges(text).length;
  const out = new Array(n).fill(null);
  let counter = 0;
  let prevNumbered = false;
  for (let pi = 0; pi < n; pi++) {
    const L = paraAt(node, pi).list;
    if (!L || (L.kind !== 'bullet' && L.kind !== 'number')) {
      prevNumbered = false;
      continue;
    }
    if (L.kind === 'number') {
      counter = prevNumbered && !L.restart ? counter + 1 : Number.isFinite(L.start) ? L.start : 1;
      out[pi] = formatListNumber(counter, L.format) + (L.suffix ?? '.');
      prevNumbered = true;
    } else {
      out[pi] = L.bullet || '\u2022';
      prevNumbered = false;
    }
  }
  return out;
}

/**
 * List markers per paragraph, measured in the style of the paragraph's
 * first character: { str, w, gap, style, size } or null.
 */
function listMarkers(node, text, ch) {
  const labels = listLabels(node, text);
  if (!labels.some((l) => l != null)) return null;
  const ranges = paragraphRanges(text);
  return labels.map((str, pi) => {
    if (str == null) return null;
    const pr = ranges[pi];
    const src = ch.sty[pr.start] || (pr.start > 0 ? ch.sty[pr.start - 1] : null) || baseStyle(node);
    const style = { ...src, underline: false, strike: false, rotation: 0, caps: 'normal', position: 'normal', baselineShift: 0, altGlyph: null };
    return { str, w: measure(str, style), gap: style.fontSize * 0.5, style, size: style.fontSize };
  });
}

/** Left indent of a line; a list paragraph's first line starts after its marker (a hanging indent). */
function lineLeft(para, first, marker) {
  const base = (para.indentLeft || 0) + (first ? para.indentFirst || 0 : 0);
  if (!first || !marker) return base;
  return Math.max(para.indentLeft || 0, base + marker.w + marker.gap);
}

/** How far a character hangs outside the margin with optical margin alignment (fraction of its advance). */
function hangOf(c) {
  if (!c) return 0;
  if ('.,\'"‘’“”‚„:;'.includes(c)) return c === ':' || c === ';' ? 0.5 : 1;
  if ('-‐‑­'.includes(c)) return 0.75;
  if ('–—*•'.includes(c)) return 0.5;
  if ('«»‹›'.includes(c)) return 0.5;
  if ('AJTVWYvwyTt'.includes(c)) return 0.05;
  return 0;
}

// ---- line breaking ----

/** Greedy line fill from `from` within `maxW`; returns the end index (exclusive). */
function fillLine(text, ch, from, pe, maxW, tc = null) {
  let x = 0;
  let lastBreak = -1;
  for (let i = from; i < pe; i++) {
    const c = text[i];
    if (c === LINE_SEP) return i + 1;
    if (i > from) x += ch.kern[i] + ch.manual[i];
    const a = c === '\t' ? tabAdvance(text, ch, i, x, tc, pe).adv : ch.adv[i];
    if (isSpace(c)) {
      x += a;
      lastBreak = i + 1;
      continue;
    }
    if (x + a > maxW + 1e-6 && i > from) {
      if (lastBreak > from) return lastBreak;
      return i;
    }
    x += a;
    if (c === '-' || c === SHY || c === '‐' || c === '–' || c === '—' || c === '/' || isCJK(c) || isCJK(text[i + 1])) lastBreak = i + 1;
  }
  return pe;
}

/** Positions (relative to the line start) of each caret index in [start, end]; tabs resolved go to `tabsOut`. */
function positions(text, ch, start, end, tc = null, tabsOut = null) {
  const xs = zeros(end - start + 1);
  let x = 0;
  for (let i = start; i < end; i++) {
    if (i > start) x += ch.kern[i] + ch.manual[i];
    xs[i - start] = x;
    if (text[i] === '\t') {
      const t = tabAdvance(text, ch, i, x, tc, end);
      if (tabsOut) tabsOut.push({ i, stop: t.stop });
      x += t.adv;
    } else x += ch.adv[i];
  }
  xs[end - start] = x;
  return xs;
}

/** Max metrics over [start, end); an empty range uses the character at `start` (or before it). */
function lineMetrics(text, ch, start, end) {
  let asc = 0;
  let desc = 0;
  let lead = 0;
  let a = start;
  let b = end;
  if (b <= a) {
    a = Math.min(start, text.length - 1);
    if (a < 0) return null;
    b = a + 1;
  }
  for (let i = a; i < b; i++) {
    if (ch.asc[i] > asc) asc = ch.asc[i];
    if (ch.desc[i] > desc) desc = ch.desc[i];
    if (ch.lead[i] > lead) lead = ch.lead[i];
  }
  return { asc, desc, lead, cap: asc * 0.85, xh: asc * 0.6 };
}

function emptyMetrics(node) {
  const st = baseStyle(node);
  const { ascent, descent } = fontMetrics(st);
  const vs = (st.verticalScale ?? 100) / 100;
  return { asc: ascent * vs, desc: descent * vs, lead: leadingOf(st), cap: ascent * 0.85, xh: ascent * 0.6 };
}

/**
 * Build a line: alignment, indents, tabs, list marker, optical margins and
 * justification within a slot that starts at x0 and is `avail` wide (point
 * type passes the anchor and no width). `opts.cellLeft` is the frame's left
 * edge (tab stops count from it), `opts.marker` the paragraph's list marker.
 */
function makeLine(text, ch, start, end, pi, para, firstInPara, lastInPara, slot, m, point, opts = {}) {
  let contentEnd = end;
  while (contentEnd > start && (isSpace(text[contentEnd - 1]) || text[contentEnd - 1] === LINE_SEP)) contentEnd--;
  const marker = firstInPara ? opts.marker || null : null;
  const left = lineLeft(para, firstInPara, marker);
  const right = para.indentRight || 0;
  const tabs = [];
  const tc = { stops: tabStops(para), origin: (point ? 0 : slot.x0 - (opts.cellLeft ?? slot.x0)) + left };
  const rel = positions(text, ch, start, end, tc, tabs);
  const width = rel[contentEnd - start];
  let hangL = 0;
  let hangR = 0;
  if (para.opticalMargin && contentEnd > start) {
    hangL = hangOf(text[start]) * ch.adv[start];
    hangR = hangOf(text[contentEnd - 1]) * ch.adv[contentEnd - 1];
  }
  const visible = width - hangL - hangR;
  const align = para.align || 'left';
  let offset;
  let extra = 0;
  if (point) {
    if (align === 'center' || align === 'justify-center') offset = slot.x0 - visible / 2 + (left - right) / 2 - hangL;
    else if (align === 'right' || align === 'justify-right') offset = slot.x0 - visible - right - hangL;
    else offset = slot.x0 + left - hangL;
  } else {
    const avail = slot.x1 - slot.x0 - left - right;
    const justify = align.startsWith('justify') && (!lastInPara || align === 'justify-all');
    if (justify && avail > visible) {
      extra = avail - visible;
      offset = slot.x0 + left - hangL;
    } else {
      let a = align;
      if (a === 'justify' || a === 'justify-all') a = 'left';
      else if (a === 'justify-center') a = 'center';
      else if (a === 'justify-right') a = 'right';
      offset = slot.x0 + left - hangL + (a === 'center' ? (avail - visible) / 2 : a === 'right' ? avail - visible : 0);
    }
  }
  const xs = zeros(rel.length);
  if (extra > 0) {
    // Distribute between words; lines without spaces spread the letters.
    let spaces = 0;
    for (let i = start; i < contentEnd; i++) if (text[i] === ' ' || text[i] === '　') spaces++;
    const gaps = spaces || Math.max(1, contentEnd - start - 1);
    const per = extra / gaps;
    let add = 0;
    for (let k = 0; k < rel.length; k++) {
      xs[k] = offset + rel[k] + add;
      const i = start + k;
      if (spaces ? i < contentEnd && (text[i] === ' ' || text[i] === '　') : i < contentEnd - 1) add += per;
    }
  } else {
    for (let k = 0; k < rel.length; k++) xs[k] = offset + rel[k];
  }
  // Drawn extras: the list marker, tab leaders and the hyphen of a line broken at a discretionary hyphen.
  let extras = null;
  const pushExtra = (e) => (extras || (extras = [])).push(e);
  if (marker) {
    const hanging = align === 'left' || align === 'justify' || align === 'justify-all';
    const mu = hanging ? slot.x0 + (para.indentLeft || 0) + (para.indentFirst || 0) : xs[0] - marker.w - marker.gap;
    pushExtra({ str: marker.str, u: mu, style: marker.style, size: marker.size, w: marker.w });
  }
  for (const t of tabs) {
    const L = t.stop?.leader;
    if (!L || !L.trim()) continue;
    const st = ch.sty[t.i];
    const lw = measure(L, st);
    if (!(lw > 0.5)) continue;
    const u0 = xs[t.i - start];
    const u1 = xs[t.i - start + 1];
    const origin = point ? slot.x0 : opts.cellLeft ?? slot.x0;
    for (let u = origin + Math.ceil((u0 - origin) / lw - 1e-6) * lw; u + lw <= u1 + 0.01; u += lw) pushExtra({ str: L, u, style: st, size: st.fontSize, w: lw });
  }
  if (text[end - 1] === SHY && !lastInPara) {
    const st = ch.sty[end - 1];
    pushExtra({ str: '-', u: xs[end - start], style: st, size: ch.size[end - 1], w: measure('-', st) });
  }
  return {
    start,
    end,
    contentEnd,
    xs,
    x: xs[0],
    width: xs[contentEnd - start] - xs[0],
    y: 0,
    asc: m.asc,
    desc: m.desc,
    lead: m.lead,
    para: pi,
    justified: extra > 0,
    text: text.slice(start, end),
    extras,
  };
}

// ---- frames ----

function polyIntervals(poly, y) {
  const xs = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push({ x0: xs[k], x1: xs[k + 1] });
  return out;
}

function intersectIntervals(a, b) {
  const out = [];
  for (const p of a) {
    for (const q of b) {
      const x0 = Math.max(p.x0, q.x0);
      const x1 = Math.min(p.x1, q.x1);
      if (x1 > x0) out.push({ x0, x1 });
    }
  }
  return out.sort((p, q) => p.x0 - q.x0);
}

/** Horizontal extent of a polygon within the band a <= y <= b (null when it does not reach the band). */
function bandExtent(poly, a, b) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j];
    const q = poly[i];
    if (Math.max(p.y, q.y) < a || Math.min(p.y, q.y) > b) continue;
    for (const v of [p, q]) {
      if (v.y >= a && v.y <= b) {
        if (v.x < lo) lo = v.x;
        if (v.x > hi) hi = v.x;
      }
    }
    for (const yy of [a, b]) {
      if ((p.y - yy) * (q.y - yy) < 0) {
        const x = p.x + ((q.x - p.x) * (yy - p.y)) / (q.y - p.y);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
  }
  return lo <= hi ? { x0: lo, x1: hi } : null;
}

/** Slots minus (or, inverted, within) a text wrap object, for a line band y0..y1. */
function wrapSlots(slots, w, y0, y1) {
  const off = w.offset || 0;
  if (w.invert) {
    let inside = [];
    for (const poly of w.polys) {
      let s = polyIntervals(poly, y0);
      s = intersectIntervals(s, polyIntervals(poly, (y0 + y1) / 2));
      s = intersectIntervals(s, polyIntervals(poly, y1));
      inside = inside.concat(s.map((p) => ({ x0: p.x0 + off, x1: p.x1 - off })).filter((p) => p.x1 > p.x0));
    }
    return intersectIntervals(slots, inside);
  }
  let out = slots;
  for (const poly of w.polys) {
    const ext = bandExtent(poly, y0 - off, y1 + off);
    if (!ext) continue;
    const x0 = ext.x0 - off;
    const x1 = ext.x1 + off;
    const next = [];
    for (const s of out) {
      if (x1 <= s.x0 || x0 >= s.x1) {
        next.push(s);
        continue;
      }
      if (x0 > s.x0) next.push({ x0: s.x0, x1: x0 });
      if (x1 < s.x1) next.push({ x0: x1, x1: s.x1 });
    }
    out = next;
  }
  return out;
}

/** Area frame cells: rows and columns of the box, or the container shape. */
function areaCells(node, vertical) {
  const o = node.areaOptions || {};
  const inset = Math.max(0, o.inset || 0);
  if (node.areaPath && node.areaPath.length > 2 && !vertical) {
    const poly = flattenPath(node.areaPath, true, 0.5);
    const b = pathBounds(node.areaPath, true) || { x: node.x, y: node.y, w: node.width, h: node.height };
    return { cells: [{ x: b.x, y: b.y, w: b.w, h: b.h, poly }], inset };
  }
  // Flow space for vertical type: u down the column, v from the right edge leftward.
  const W = vertical ? node.height : node.width;
  const H = vertical ? node.width : node.height;
  const X = vertical ? 0 : node.x;
  const Y = vertical ? 0 : node.y;
  const rows = Math.max(1, Math.round(o.rows || 1));
  const cols = Math.max(1, Math.round(o.columns || 1));
  const rg = rows > 1 ? Math.max(0, o.rowGutter ?? 18) : 0;
  const cg = cols > 1 ? Math.max(0, o.columnGutter ?? 18) : 0;
  const cw = Math.max(1, (W - cg * (cols - 1)) / cols);
  const rh = Math.max(1, (H - rg * (rows - 1)) / rows);
  const cells = [];
  const byCols = o.flow === 'columns';
  for (let a = 0; a < (byCols ? cols : rows); a++) {
    for (let b = 0; b < (byCols ? rows : cols); b++) {
      const r = byCols ? b : a;
      const c = byCols ? a : b;
      cells.push({ x: X + c * (cw + cg), y: Y + r * (rh + rg), w: cw, h: rh, poly: null });
    }
  }
  return { cells, inset };
}

function slotsAt(cell, inset, y0, y1) {
  let s;
  if (!cell.poly) s = [{ x0: cell.x + inset, x1: cell.x + cell.w - inset }];
  else {
    s = polyIntervals(cell.poly, y0);
    s = intersectIntervals(s, polyIntervals(cell.poly, (y0 + y1) / 2));
    s = intersectIntervals(s, polyIntervals(cell.poly, y1));
    s = s.map((p) => ({ x0: p.x0 + inset, x1: p.x1 - inset })).filter((p) => p.x1 > p.x0);
  }
  if (cell.wraps) for (const w of cell.wraps) s = wrapSlots(s, w, y0, y1);
  return s;
}

function firstOffset(node, m) {
  const o = node.areaOptions || {};
  let v;
  switch (o.firstBaseline) {
    case 'leading':
      v = m.lead;
      break;
    case 'capHeight':
      v = m.cap;
      break;
    case 'xHeight':
      v = m.xh;
      break;
    case 'fixed':
      v = 0;
      break;
    default:
      v = m.asc;
  }
  return Math.max(v, o.minBaseline || 0);
}

/**
 * Flow a story through area frames: every cell (row/column) of each frame
 * in turn. `frames` are the threaded frames (the story's own node when not
 * threaded); `wraps[fi]` the text wrap obstacles in frame fi's local space.
 * Lines carry `frame` (index) and `cell`.
 */
function flowArea(node, text, ch, vertical, frames = [node], wraps = null, markers = null) {
  const cells = [];
  frames.forEach((f, fi) => {
    const ac = areaCells(f, vertical);
    const list = wraps?.[fi]?.list?.length ? wraps[fi].list : null;
    for (const c of ac.cells) cells.push({ ...c, frame: fi, inset: ac.inset, node: f, wraps: list });
  });
  const ranges = paragraphRanges(text);
  const lines = [];
  let ci = 0;
  let prevBase = null;
  let pendingSpace = 0;
  let overflow = false;
  let visibleEnd = 0;
  const empty = emptyMetrics(node);
  outer: for (let pi = 0; pi < ranges.length; pi++) {
    const pr = ranges[pi];
    const para = paraAt(node, pi);
    const stops = tabStops(para);
    const marker = markers?.[pi] || null;
    let pos = pr.start;
    let firstInPara = true;
    for (let guardRows = 0; guardRows < 100000; guardRows++) {
      if (ci >= cells.length) {
        overflow = true;
        break outer;
      }
      const cell = cells[ci];
      const inset = cell.inset;
      const top = cell.y + inset;
      const bottom = cell.y + cell.h - inset;
      const cellLeft = cell.x + inset;
      let m = lineMetrics(text, ch, pos, Math.min(pr.end, pos + 1)) || empty;
      const baseFor = (mm) => (prevBase == null ? top + firstOffset(cell.node, mm) : prevBase + mm.lead + (firstInPara ? pendingSpace + (para.spaceBefore || 0) : 0));
      let base = baseFor(m);
      let row = null;
      let rowEnd = pos;
      for (let tries = 0; tries < 2000; tries++) {
        if (base + m.desc > bottom + 0.01) break;
        const slots = slotsAt(cell, inset, base - m.asc, base + m.desc).filter((s) => s.x1 - s.x0 >= Math.min(cell.w - 2 * inset, m.lead * 0.5));
        if (!slots.length) {
          if (!cell.poly && !cell.wraps) break;
          base += Math.max(0.5, m.lead / 6);
          continue;
        }
        // Fill each slot on this row in turn.
        const build = (mm, bs) => {
          const out = [];
          let p = pos;
          let first = firstInPara;
          for (const s of slots) {
            if (p >= pr.end && out.length) break;
            const left = lineLeft(para, first, first ? marker : null);
            const avail = s.x1 - s.x0 - left - (para.indentRight || 0);
            const e = p >= pr.end ? p : fillLine(text, ch, p, pr.end, Math.max(1, avail), { stops, origin: s.x0 - cellLeft + left });
            const lm = lineMetrics(text, ch, p, e) || mm;
            out.push({ s, p, e, first, lm });
            first = false;
            p = e;
          }
          return { out, p, bs };
        };
        let built = build(m, base);
        let actual = built.out.reduce((acc, r) => ({ asc: Math.max(acc.asc, r.lm.asc), desc: Math.max(acc.desc, r.lm.desc), lead: Math.max(acc.lead, r.lm.lead), cap: Math.max(acc.cap, r.lm.cap), xh: Math.max(acc.xh, r.lm.xh) }), { asc: 0, desc: 0, lead: 0, cap: 0, xh: 0 });
        if (actual.asc > m.asc + 1e-6 || actual.lead > m.lead + 1e-6 || actual.desc > m.desc + 1e-6) {
          m = { asc: Math.max(m.asc, actual.asc), desc: Math.max(m.desc, actual.desc), lead: Math.max(m.lead, actual.lead), cap: Math.max(m.cap, actual.cap), xh: Math.max(m.xh, actual.xh) };
          base = Math.max(base, baseFor(m));
          if (base + m.desc > bottom + 0.01) break;
          continue;
        }
        row = built.out.map((r) => {
          const line = makeLine(text, ch, r.p, r.e, pi, para, r.first, r.e >= pr.end, r.s, m, false, { cellLeft, marker: r.first ? marker : null });
          line.y = base;
          line.asc = m.asc;
          line.desc = m.desc;
          line.lead = m.lead;
          line.cell = ci;
          line.frame = cell.frame;
          return line;
        });
        rowEnd = built.p;
        break;
      }
      if (!row) {
        ci++;
        prevBase = null;
        continue;
      }
      lines.push(...row);
      visibleEnd = rowEnd;
      prevBase = base;
      pos = rowEnd;
      firstInPara = false;
      if (pos >= pr.end) break;
    }
    visibleEnd = pr.end;
    pendingSpace = para.spaceAfter || 0;
  }
  if (overflow) visibleEnd = lines.length ? lines[lines.length - 1].end : 0;
  return { lines, overflow: overflow && visibleEnd < text.length, visibleEnd, cells, inset: cells[0]?.inset || 0 };
}

function flowPoint(node, text, ch, anchorX, markers = null) {
  const ranges = paragraphRanges(text);
  const lines = [];
  const empty = emptyMetrics(node);
  let prevBase = null;
  let pendingSpace = 0;
  for (let pi = 0; pi < ranges.length; pi++) {
    const pr = ranges[pi];
    const para = paraAt(node, pi);
    // Forced line breaks split a paragraph into several lines.
    let start = pr.start;
    let first = true;
    for (;;) {
      let end = pr.end;
      for (let i = start; i < pr.end; i++) {
        if (text[i] === LINE_SEP) {
          end = i + 1;
          break;
        }
      }
      const m = lineMetrics(text, ch, start, end) || empty;
      const base = prevBase == null ? 0 : prevBase + m.lead + (first ? pendingSpace + (para.spaceBefore || 0) : 0);
      const line = makeLine(text, ch, start, end, pi, para, first, end >= pr.end, { x0: anchorX, x1: anchorX }, m, true, { marker: first ? markers?.[pi] : null });
      line.y = base;
      lines.push(line);
      prevBase = base;
      first = false;
      if (end >= pr.end) break;
      start = end;
    }
    pendingSpace = para.spaceAfter || 0;
  }
  return { lines, overflow: false, visibleEnd: text.length };
}

// ---- path frames ----

function pathFrame(node) {
  let anchors = node.pathAnchors || [];
  const opts = node.pathOptions || {};
  if (opts.flip) anchors = anchors.slice().reverse().map((p) => ({ ...p, ix: p.ox, iy: p.oy, ox: p.ix, oy: p.iy }));
  const pts = flattenPath(anchors, Boolean(node.pathClosed), 0.2);
  const cum = zeros(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const length = pts.length ? cum[pts.length - 1] : 0;
  const at = (u) => {
    if (pts.length < 2) return { x: pts[0]?.x || 0, y: pts[0]?.y || 0, tx: 1, ty: 0 };
    const uu = Math.max(0, Math.min(length, u));
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= uu) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const seg = cum[hi] - cum[lo] || 1;
    const t = (uu - cum[lo]) / seg;
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    // Extrapolate along the end tangents beyond the path ends.
    const extra = u < 0 ? u : u > length ? u - length : 0;
    return { x: a.x + (b.x - a.x) * t + tx * extra, y: a.y + (b.y - a.y) * t + ty * extra, tx, ty };
  };
  const project = (x, y) => {
    let best = { u: 0, d: Infinity };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best.d) {
        const l = Math.sqrt(l2);
        const side = (dx * (y - a.y) - dy * (x - a.x)) / l; // + = right of travel (below for left-to-right)
        best = { u: cum[i] + t * l, d, v: side };
      }
    }
    return best;
  };
  let center = null;
  if (pts.length) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    center = { x: sx / pts.length, y: sy / pts.length };
  }
  return { pts, length, at, project, center, closed: Boolean(node.pathClosed) };
}

function flowPath(node, text, ch, frame, vertical) {
  const n = text.length;
  const empty = emptyMetrics(node);
  const m = lineMetrics(text, ch, 0, n) || empty;
  const para = paraAt(node, 0);
  const rel = positions(text, ch, 0, n);
  const start = node.pathOptions?.start || 0;
  const spacing = node.pathOptions?.spacing || 0;
  const L = frame.length;
  // Spacing evens out the gaps around bends: characters on the outside of a
  // curve move closer together, those on the inside further apart, in
  // proportion to how much the path turns between them.
  const adj = zeros(n + 1);
  if (spacing && n > 1) {
    let add = 0;
    let prev = null;
    for (let i = 0; i < n; i++) {
      const p = frame.at(start + rel[i] + add + ch.adv[i] / 2);
      if (prev) {
        const turn = prev.tx * p.ty - prev.ty * p.tx;
        add = Math.max(add - (rel[i] - rel[i - 1]) * 0.9, add - spacing * turn);
      }
      adj[i] = add;
      prev = p;
    }
    adj[n] = add;
  }
  const width = rel[n] + adj[n];
  let u0 = start;
  const align = para.align || 'left';
  if (align === 'center' || align === 'justify-center') u0 = start + (L - start - width) / 2;
  else if (align === 'right' || align === 'justify-right') u0 = L - width;
  const xs = zeros(n + 1);
  for (let k = 0; k <= n; k++) xs[k] = u0 + rel[k] + adj[k];
  // Characters whose center falls beyond the path end overflow.
  let visibleEnd = n;
  for (let i = 0; i < n; i++) {
    if (xs[i] + ch.adv[i] / 2 > L + 0.01) {
      visibleEnd = i;
      break;
    }
  }
  const alignTo = node.pathOptions?.align || 'baseline';
  const vOff = vertical ? 0 : alignTo === 'ascender' ? m.asc : alignTo === 'descender' ? -m.desc : alignTo === 'center' ? (m.asc - m.desc) / 2 : 0;
  const line = { start: 0, end: n, contentEnd: n, xs, x: xs[0], width, y: vOff, asc: m.asc, desc: m.desc, lead: m.lead, para: 0, justified: false, text, visibleEnd, extras: null };
  return { lines: [line], overflow: visibleEnd < n, visibleEnd };
}

// ---- layout ----

const ID = [1, 0, 0, 1, 0, 0];

function invertM(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

function applyM(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function sameList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Text wrap obstacles for an area frame (see textHooks.wraps): { deps, list } or null. */
function wrapsOf(node, vertical) {
  if (node.kind !== 'area' || vertical || !textHooks.wraps) return null;
  return textHooks.wraps(node) || null;
}

/** Threaded frames of a node (head first), or null when it is not threaded. */
function storyFrames(node) {
  if (node.kind !== 'area' || !(node.threadNext || node.threadPrev) || !textHooks.story) return null;
  const frames = textHooks.story(node);
  return frames && frames.length > 1 ? frames : null;
}

/** Common layout record for a flow result. */
function finish(node, source, kind, vertical, text, ch, flow, toLocal, fromLocal, path, cells) {
  const { lines } = flow;
  const first = lines[0];
  const empty = first ? null : emptyMetrics(source);
  const lay = {
    kind,
    vertical,
    text,
    lines,
    chars: ch,
    overflow: Boolean(flow.overflow),
    visibleEnd: flow.visibleEnd,
    ascent: first ? first.asc : empty.asc,
    descent: first ? first.desc : empty.desc,
    leading: first ? first.lead : empty.lead,
    toLocal,
    fromLocal,
    path,
    cells,
    inset: flow.inset || 0,
    node,
    source,
  };
  lay.bounds = layoutBounds(node, lay);
  return lay;
}

function areaMapping(node, vertical) {
  if (vertical) {
    const right = node.x + node.width;
    return { toLocal: (u, v) => ({ x: right - v, y: node.y + u }), fromLocal: (x, y) => ({ u: y - node.y, v: right - x }) };
  }
  return { toLocal: (u, v) => ({ x: u, y: v }), fromLocal: (x, y) => ({ u: x, v: y }) };
}

function buildLayout(node, wraps) {
  const text = String(node.text ?? '');
  const kind = node.kind === 'path' && node.pathAnchors?.length ? 'path' : node.kind === 'area' ? 'area' : 'point';
  const vertical = Boolean(node.vertical);
  const ch = measureChars(node, text, vertical);
  const markers = kind === 'path' ? null : listMarkers(node, text, ch);
  let flow;
  let toLocal;
  let fromLocal;
  let path = null;
  let cells = null;
  if (kind === 'path') {
    path = pathFrame(node);
    flow = flowPath(node, text, ch, path, vertical);
    toLocal = (u, v) => {
      const p = path.at(u);
      return { x: p.x - p.ty * v, y: p.y + p.tx * v };
    };
    fromLocal = (x, y) => {
      const pr = path.project(x, y);
      return { u: pr.u, v: pr.v ?? 0 };
    };
  } else if (kind === 'area') {
    flow = flowArea(node, text, ch, vertical, [node], wraps ? [wraps] : null, markers);
    cells = flow.cells;
    ({ toLocal, fromLocal } = areaMapping(node, vertical));
  } else {
    flow = flowPoint(node, text, ch, vertical ? 0 : node.x, markers);
    if (vertical) {
      toLocal = (u, v) => ({ x: node.x - v, y: node.y + u });
      fromLocal = (x, y) => ({ u: y - node.y, v: node.x - x });
    } else {
      // Point type baselines start at node.y.
      for (const l of flow.lines) l.y += node.y;
      toLocal = (u, v) => ({ x: u, y: v });
      fromLocal = (x, y) => ({ u: x, v: y });
    }
  }
  return finish(node, node, kind, vertical, text, ch, flow, toLocal, fromLocal, path, cells);
}

/**
 * Layouts of every frame of a threaded story, cached on the story's first
 * frame (the node holding the text) and the identities of all frames and
 * their wrap obstacles.
 */
function storyLayouts(frames) {
  const head = frames[0];
  const vertical = Boolean(head.vertical);
  const wraps = frames.map((f) => wrapsOf(f, vertical));
  const deps = wraps.map((w) => w?.deps || null);
  const c = storyCache.get(head);
  if (c && sameList(c.frameList, frames) && c.deps.every((d, i) => sameList(d, deps[i]))) return c;
  const text = String(head.text ?? '');
  const ch = measureChars(head, text, vertical);
  const markers = listMarkers(head, text, ch);
  const flow = flowArea(head, text, ch, vertical, frames, wraps, markers);
  let end = 0;
  const layouts = frames.map((f, fi) => {
    const lines = flow.lines.filter((l) => l.frame === fi);
    if (lines.length) end = lines[lines.length - 1].end;
    const last = fi === frames.length - 1;
    const sub = { lines, overflow: last && flow.overflow, visibleEnd: last ? flow.visibleEnd : end, inset: (f.areaOptions?.inset || 0) };
    const { toLocal, fromLocal } = areaMapping(f, vertical);
    const lay = finish(f, head, 'area', vertical, text, ch, sub, toLocal, fromLocal, null, flow.cells.filter((cell) => cell.frame === fi));
    lay.story = { head, frames, index: fi, overflow: flow.overflow, visibleEnd: flow.visibleEnd, start: lines.length ? lines[0].start : end };
    return lay;
  });
  const entry = { frameList: frames, deps, frames: layouts, flow, edit: null };
  storyCache.set(head, entry);
  return entry;
}

/**
 * Lay out a text node. Returns (in the node's local space unless noted):
 *   kind, vertical, lines: [{ start, end, contentEnd, xs, x, y, width, asc, desc, lead, para, text, extras }]
 *     where xs[k] is the flow-space position of caret index start + k and
 *     y is the baseline's flow position; extras are drawn strings that are
 *     not characters of the text (list markers, tab leaders, hyphens),
 *   chars: per-character arrays (display char, style, size, advance, ...),
 *   bounds { x, y, w, h }, overflow, visibleEnd, ascent, descent, leading,
 *   toLocal(u, v) / fromLocal(x, y) flow mapping, path (for type on a path),
 *   source: the node holding the text (the first frame of a threaded story),
 *   story: { head, frames, index, ... } for threaded frames.
 * A threaded frame shows the part of the story that flows into it.
 */
export function layoutText(node) {
  const frames = storyFrames(node);
  if (frames) {
    let idx = frames.indexOf(node);
    if (idx < 0) idx = frames.findIndex((f) => f.id === node.id);
    if (idx >= 0) return storyLayouts(frames).frames[idx];
  }
  const wraps = wrapsOf(node, Boolean(node.vertical));
  const hit = layoutCache.get(node);
  if (hit && sameList(hit.wrapDeps, wraps?.deps || null)) return hit;
  const lay = buildLayout(node, wraps);
  lay.wrapDeps = wraps?.deps || null;
  layoutCache.set(node, lay);
  return lay;
}

/**
 * Layout for editing a text: the node's own layout, or for a threaded story
 * every frame's lines in one list, mapped into the first frame's local space
 * (each line carries its own toLocal/fromLocal), so carets and selections
 * move through all frames.
 */
export function editLayout(node) {
  const frames = storyFrames(node);
  if (!frames) return layoutText(node);
  const entry = storyLayouts(frames);
  if (entry.edit) return entry.edit;
  const head = frames[0];
  const hi = invertM(head.transform || ID);
  const lines = [];
  entry.frames.forEach((lay, fi) => {
    const M = mul(hi, frames[fi].transform || ID);
    const Mi = invertM(M);
    for (const l of lay.lines) {
      lines.push({
        ...l,
        frame: fi,
        toLocal: (u, v) => {
          const p = lay.toLocal(u, v);
          return applyM(M, p.x, p.y);
        },
        fromLocal: (x, y) => {
          const p = applyM(Mi, x, y);
          return lay.fromLocal(p.x, p.y);
        },
      });
    }
  });
  entry.edit = { ...entry.frames[0], lines, overflow: entry.flow.overflow, visibleEnd: entry.flow.visibleEnd, composite: true, frameLayouts: entry.frames, frames };
  return entry.edit;
}

function layoutBounds(node, lay) {
  if (lay.kind === 'area') {
    if (node.areaPath && node.areaPath.length > 2 && !lay.vertical) return pathBounds(node.areaPath, true);
    return { x: node.x, y: node.y, w: node.width, h: node.height };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  if (lay.kind === 'path') {
    const pb = pathBounds(node.pathAnchors, Boolean(node.pathClosed));
    if (pb) {
      add({ x: pb.x, y: pb.y });
      add({ x: pb.x + pb.w, y: pb.y + pb.h });
    }
    for (const g of glyphPlacements(lay)) {
      const { m } = g;
      const top = -lay.chars.asc[g.i];
      const bot = lay.chars.desc[g.i];
      const w = g.w;
      for (const [gx, gy] of [[0, top], [w, top], [w, bot], [0, bot]]) add({ x: m[0] * gx + m[2] * gy + m[4], y: m[1] * gx + m[3] * gy + m[5] });
    }
  } else {
    for (const l of lay.lines) {
      let u0 = Math.min(l.x, l.x + l.width);
      let u1 = Math.max(l.x, l.x + l.width);
      for (const e of l.extras || []) {
        u0 = Math.min(u0, e.u);
        u1 = Math.max(u1, e.u + (e.w || 0));
      }
      add(lay.toLocal(u0, l.y - l.asc));
      add(lay.toLocal(u1, l.y + l.desc));
      add(lay.toLocal(u0, l.y + l.desc));
      add(lay.toLocal(u1, l.y - l.asc));
    }
  }
  if (minX === Infinity) {
    const p = lay.toLocal(0, 0);
    return { x: p.x, y: p.y - lay.ascent, w: 0, h: lay.ascent + lay.descent };
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---- glyph placement ----

const GLYPH_CACHE = new WeakMap();
const EXTRA_CACHE = new WeakMap();

/**
 * Placements of a layout's extras (list markers, tab leaders, hyphens at
 * discretionary breaks), in the form glyphPlacements() uses, with
 * `extra: true`. Horizontal and vertical area and point type only.
 */
export function extraPlacements(lay) {
  let out = EXTRA_CACHE.get(lay);
  if (out) return out;
  out = [];
  if (lay.kind !== 'path') {
    for (const line of lay.lines) {
      if (!line.extras) continue;
      for (const x of line.extras) {
        const st = x.style;
        const hs = (st.horizontalScale ?? 100) / 100;
        const vs = (st.verticalScale ?? 100) / 100;
        let m;
        if (lay.vertical) {
          const p = lay.toLocal(0, line.y);
          m = [hs, 0, 0, vs, p.x - (x.w || 0) / 2, lay.toLocal(x.u + st.fontSize * vs * 0.82, line.y).y];
        } else m = [hs, 0, 0, vs, x.u, line.y - riseOf(st)];
        out.push({ i: line.start, ch: x.str, style: st, size: x.size, adv: 0, w: (x.w || 0) / hs, m, glyph: null, extra: true });
      }
    }
  }
  EXTRA_CACHE.set(lay, out);
  return out;
}

/**
 * One entry per visible, drawable character: { i, ch (display), style,
 * size (draw size), adv, m } where m maps glyph space (origin at the
 * baseline start, x right, y down, in px at `size` with scales applied) to
 * the node's local space, followed by the layout's extras (`extra: true`).
 * Drawing and outline conversion both use it.
 */
export function glyphPlacements(lay) {
  let out = GLYPH_CACHE.get(lay);
  if (out) return out;
  out = [];
  const { chars: ch, text } = lay;
  for (const line of lay.lines) {
    const last = lay.kind === 'path' ? Math.min(line.contentEnd, line.visibleEnd ?? line.contentEnd) : line.contentEnd;
    for (let i = line.start; i < last; i++) {
      const c = text[i];
      if (c === '\n' || c === '\t' || c === ' ' || c === '　' || c === LINE_SEP || c === SHY) continue;
      const glyph = ch.glyph ? ch.glyph[i] : undefined;
      if (glyph === -1) continue; // part of the ligature drawn at an earlier character
      const st = ch.sty[i];
      const hs = (st.horizontalScale ?? 100) / 100;
      const vs = (st.verticalScale ?? 100) / 100;
      const x = line.xs[i - line.start];
      const rise = riseOf(st);
      const adv = ch.adv[i] - ((st.tracking || 0) / 1000) * st.fontSize;
      let m;
      if (lay.kind === 'path' && lay.vertical) {
        // Upright characters stacked along the path: the glyph's down axis follows the path.
        const em = st.fontSize * vs;
        const p = lay.path.at(x + adv / 2);
        const t = [p.tx, p.ty];
        const xa = [p.ty, -p.tx];
        const along = em * 0.82 - adv / 2;
        const side = ch.gw[i] / 2 - rise;
        m = [xa[0] * hs, xa[1] * hs, t[0] * vs, t[1] * vs, p.x + t[0] * along - xa[0] * side, p.y + t[1] * along - xa[1] * side];
      } else if (lay.kind === 'path') {
        const uc = x + adv / 2;
        const p = lay.path.at(uc);
        const eff = lay.node.pathOptions?.effect || 'rainbow';
        let ex = [p.tx, p.ty];
        let ey = [-p.ty, p.tx];
        if (eff === 'skew') ey = [0, Math.sign(p.tx) || 1];
        else if (eff === 'ribbon') ex = [Math.sign(p.tx) || 1, 0];
        else if (eff === 'stair') {
          ex = [1, 0];
          ey = [0, 1];
        } else if (eff === 'gravity' && lay.path.center) {
          let gx = lay.path.center.x - p.x;
          let gy = lay.path.center.y - p.y;
          const l = Math.hypot(gx, gy) || 1;
          gx /= l;
          gy /= l;
          // Keep the reading direction of the path.
          const s = gy * p.tx - gx * p.ty >= 0 ? 1 : -1;
          ey = [gx * s, gy * s];
          ex = [ey[1], -ey[0]];
        }
        const v = line.y - rise;
        const ox = p.x - (ex[0] * adv) / 2 + ey[0] * v;
        const oy = p.y - (ex[1] * adv) / 2 + ey[1] * v;
        m = [ex[0] * hs, ex[1] * hs, ey[0] * vs, ey[1] * vs, ox, oy];
      } else if (lay.vertical) {
        const top = x;
        const em = st.fontSize * vs;
        const base = top + em * 0.82;
        const p = lay.toLocal(0, line.y);
        const gw = ch.gw[i];
        m = [hs, 0, 0, vs, p.x - gw / 2 + rise, lay.toLocal(base, line.y).y];
      } else {
        m = [hs, 0, 0, vs, x, line.y - rise];
      }
      if (st.rotation) {
        const r = (-st.rotation * Math.PI) / 180;
        const cx = adv / hs / 2;
        const cy = -ch.size[i] * 0.35;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        // m * T(c) * R * T(-c)
        const rot = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        m = mul(m, rot);
      }
      let str = ch.disp[i];
      if (glyph != null) for (let k = i + 1; k < last && ch.glyph[k] === -1; k++) str += ch.disp[k];
      out.push({ i, ch: str, style: st, size: ch.size[i], adv: ch.adv[i], w: adv / hs, m, glyph: glyph ?? null });
    }
  }
  for (const g of extraPlacements(lay)) out.push(g);
  GLYPH_CACHE.set(lay, out);
  return out;
}

function mul(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** True when a layout can be drawn as horizontal line segments (the fast path). */
export function drawsAsSegments(lay) {
  if (lay.kind === 'path' || lay.vertical || lay.chars.shaped) return false;
  for (const r of styledRuns(lay.source || lay.node)) if (r.style.rotation) return false;
  return true;
}

// ---- caret mapping ----

/** Line index for a caret index. */
export function lineIndexOf(lay, index) {
  const { lines } = lay;
  if (!lines.length) return -1;
  let li = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= index) li = i;
    else break;
  }
  return li;
}

/**
 * Caret geometry for an index: { x, y (baseline point), line, top, bottom }
 * in local space; top/bottom are the caret line's end points.
 */
export function caretPosition(lay, index) {
  const { lines } = lay;
  const li = lineIndexOf(lay, index);
  if (li < 0) {
    const p = lay.toLocal(lay.kind === 'point' && !lay.vertical ? lay.node.x : 0, lay.kind === 'point' && !lay.vertical ? lay.node.y : 0);
    const asc = lay.ascent;
    return { x: p.x, y: p.y, line: 0, u: 0, top: { x: p.x, y: p.y - asc }, bottom: { x: p.x, y: p.y + lay.descent } };
  }
  const l = lines[li];
  const k = Math.max(0, Math.min(l.end, index) - l.start);
  const u = l.xs[Math.min(k, l.xs.length - 1)];
  const toLocal = l.toLocal || lay.toLocal;
  const p = toLocal(u, l.y);
  return { x: p.x, y: p.y, u, line: li, top: toLocal(u, l.y - l.asc), bottom: toLocal(u, l.y + l.desc) };
}

/** Caret index in a line nearest flow position u. */
export function indexInLine(lay, li, u) {
  const l = lay.lines[li];
  if (!l) return 0;
  let best = l.start;
  let bestD = Infinity;
  const last = l.end > l.contentEnd && lay.lines[li + 1] && lay.lines[li + 1].start === l.end ? l.end - 1 : l.end;
  for (let i = l.start; i <= Math.max(l.start, last); i++) {
    const d = Math.abs(l.xs[i - l.start] - u);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Caret index from a local point. */
export function hitTestText(lay, x, y) {
  const { lines } = lay;
  if (!lines.length) return 0;
  const f0 = lay.fromLocal(x, y);
  if (lay.kind === 'path') return indexInLine(lay, 0, f0.u);
  let li = 0;
  let bestD = Infinity;
  let bestU = f0.u;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Threaded stories: each line maps the point into its own frame.
    const f = l.fromLocal ? l.fromLocal(x, y) : f0;
    const top = l.y - l.asc;
    const bot = l.y + l.desc;
    let d = f.v < top ? top - f.v : f.v > bot ? f.v - bot : 0;
    // Same row (several slots or cells): prefer the slot under u.
    const u0 = Math.min(l.xs[0], l.xs[l.xs.length - 1]);
    const u1 = Math.max(l.xs[0], l.xs[l.xs.length - 1]);
    const du = f.u < u0 ? u0 - f.u : f.u > u1 ? f.u - u1 : 0;
    d = d * 1000 + du;
    if (d < bestD) {
      bestD = d;
      li = i;
      bestU = f.u;
    }
  }
  return indexInLine(lay, li, bestU);
}

/**
 * Highlight polygons (local space) for the selection [a, b): one quad per
 * line piece (and per character on a path).
 */
export function selectionPolygons(lay, a, b) {
  const out = [];
  if (b <= a) return out;
  for (const l of lay.lines) {
    const s = Math.max(a, l.start);
    const e = Math.min(b, l.end);
    const includesBreak = b > l.end && a <= l.end && lay.text[l.end] === '\n';
    if (e < s || (e === s && !includesBreak)) continue;
    const u0 = l.xs[s - l.start];
    let u1 = l.xs[e - l.start];
    if (includesBreak) u1 += (l.asc + l.desc) * 0.3;
    if (lay.kind === 'path') {
      const steps = Math.max(1, Math.ceil(Math.abs(u1 - u0) / 4));
      const top = [];
      const bot = [];
      for (let k = 0; k <= steps; k++) {
        const u = u0 + ((u1 - u0) * k) / steps;
        top.push(lay.toLocal(u, l.y - l.asc));
        bot.push(lay.toLocal(u, l.y + l.desc));
      }
      out.push([...top, ...bot.reverse()]);
    } else {
      const toLocal = l.toLocal || lay.toLocal;
      out.push([toLocal(u0, l.y - l.asc), toLocal(u1, l.y - l.asc), toLocal(u1, l.y + l.desc), toLocal(u0, l.y + l.desc)]);
    }
  }
  return out;
}

/** Precise hit test in local space for type on a path (near the path or a glyph). */
export function hitTextLocal(lay, x, y, tol) {
  const b = lay.bounds;
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
  if (lay.kind !== 'path') return true;
  const pr = lay.path.project(x, y);
  if (pr.d <= tol + 1) return true;
  for (const g of glyphPlacements(lay)) {
    const m = g.m;
    const det = m[0] * m[3] - m[1] * m[2] || 1;
    const dx = x - m[4];
    const dy = y - m[5];
    const gx = (m[3] * dx - m[2] * dy) / det;
    const gy = (-m[1] * dx + m[0] * dy) / det;
    if (gx >= -tol && gx <= g.w + tol && gy >= -lay.chars.asc[g.i] - tol && gy <= lay.chars.desc[g.i] + tol) return true;
  }
  return false;
}
