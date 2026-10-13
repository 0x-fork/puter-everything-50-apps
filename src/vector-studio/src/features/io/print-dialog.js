/**
 * File > Print: choose artboards, media size and orientation, placement,
 * scaling (fit, custom, tiled), printer's marks and bleed, which layers
 * print, and color or grayscale output, with a live preview of every
 * page; save the settings as named print presets. The browser's print
 * dialog follows for the printer itself.
 */
import { h } from '../../lib/dom.js';
import { formatLength, parseLength } from '../../lib/units.js';
import { drawArtwork } from '../../render/draw.js';
import { visualBounds, rectsIntersect } from '../../model/geometry.js';
import { parseRange, outlinesFor } from './jobs.js';
import { MEDIA, DEFAULT_PRINT, layoutContent } from './print-layout.js';
import { printPages, printView } from './print.js';

const PRESETS_KEY = 'printPresets';
const LAST_KEY = 'printSettings';

const ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];

/** Artboards with nothing visible on them. */
function isBlank(doc, a) {
  let found = false;
  doc.walk((n) => {
    if (found || n.hidden) return false;
    if (n.type === 'layer') return true;
    const b = visualBounds(doc, n);
    if (b && rectsIntersect(b, a)) found = true;
    return false;
  });
  return !found;
}

/** All pages for the settings: each chosen artboard (or the artwork bounds) laid out. */
export function printJob(doc, settings, { activeArtboard = 0, fileName = '' } = {}) {
  const view = printView(doc, settings.layers);
  const date = new Date().toLocaleString();
  const contents = [];
  if (settings.ignoreArtboards) {
    let b = null;
    for (const id of doc.root.children) {
      const l = view.get(id);
      if (!l || l.hidden) continue;
      const v = visualBounds(view, l);
      if (v) b = b ? { x: Math.min(b.x, v.x), y: Math.min(b.y, v.y), w: Math.max(b.x + b.w, v.x + v.w) - Math.min(b.x, v.x), h: Math.max(b.y + b.h, v.y + v.h) - Math.min(b.y, v.y) } : v;
    }
    if (b) contents.push({ rect: b, info: `${fileName}  ${date}` });
  } else {
    let indices;
    if (settings.which === 'current') indices = [activeArtboard];
    else if (settings.which === 'range') indices = parseRange(settings.range, doc.artboards.length) || [];
    else indices = doc.artboards.map((_, i) => i);
    for (const i of indices) {
      const a = doc.artboards[i];
      if (!a || (settings.skipBlank && isBlank(view, a))) continue;
      contents.push({ rect: { x: a.x, y: a.y, w: a.w, h: a.h }, info: `${fileName}  ${a.name || `Artboard ${i + 1}`}  ${date}` });
    }
  }
  const bleed = settings.useDocBleed ? { ...DEFAULT_PRINT.bleed, ...(doc.root.bleed || {}) } : settings.bleed;
  return contents.flatMap((c) => layoutContent(c.rect, { ...settings, bleed }, c.info));
}

function defaults(app) {
  return {
    ...DEFAULT_PRINT,
    which: 'all',
    range: '',
    ignoreArtboards: false,
    skipBlank: false,
    layers: 'printable',
    useDocBleed: false,
    color: 'color',
    textMode: 'text',
    ...(app.prefs.get(LAST_KEY) || {}),
  };
}

export async function printDialog(app) {
  const editor = app.editor;
  if (!editor) return;
  const doc = editor.doc;
  const unit = doc.root.units || 'pt';
  let st = defaults(app);
  st.range ||= `1-${doc.artboards.length}`;
  let pageIndex = 0;
  let pages = [];

  // ---- controls ----
  const len = (v) => formatLength(v, unit);
  const lenInput = (value, label, onSet) => {
    const el = h('input.pd-len', { type: 'text', value: len(value), 'aria-label': label, inputmode: 'decimal', spellcheck: false, autocomplete: 'off' });
    el.addEventListener('change', () => {
      const v = parseLength(el.value, unit);
      if (Number.isFinite(v)) onSet(v);
      el.value = len(v);
      refresh();
    });
    return el;
  };
  const sel = (options, value, onSet, label) => {
    const el = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    el.addEventListener('change', () => {
      onSet(el.value);
      refresh();
    });
    return el;
  };
  const check = (label, value, onSet) => {
    const input = h('input', { type: 'checkbox', checked: Boolean(value) });
    input.addEventListener('change', () => {
      onSet(input.checked);
      refresh();
    });
    return { el: h('label.pd-check', input, label), input };
  };
  const field = (label, ...controls) => h('div.pd-field', h('span.pd-label', label), h('div.pd-controls', ...controls));

  const presetSel = h('select.pd-preset', { 'aria-label': 'Print preset' });
  const fillPresets = (selected = '') => {
    const presets = app.prefs.get(PRESETS_KEY) || {};
    presetSel.replaceChildren(h('option', { value: '' }, '[Custom]'), ...Object.keys(presets).sort().map((n) => h('option', { value: n, selected: n === selected }, n)));
  };
  presetSel.addEventListener('change', () => {
    const p = (app.prefs.get(PRESETS_KEY) || {})[presetSel.value];
    if (p) {
      st = { ...defaults(app), ...p, range: st.range };
      rebuild();
    }
  });
  const savePreset = h('button.btn.small', { type: 'button', onclick: async () => {
    const v = await app.dialogs.form({ title: 'Save Print Preset', fields: [{ key: 'name', label: 'Name', type: 'text', value: presetSel.value || 'My Print Preset' }] });
    const name = v?.name?.trim();
    if (!name) return;
    const { which, range, ...keep } = st;
    app.prefs.set(PRESETS_KEY, { ...(app.prefs.get(PRESETS_KEY) || {}), [name]: keep });
    fillPresets(name);
  } }, 'Save Preset…');
  const deletePreset = h('button.btn.small', { type: 'button', onclick: () => {
    const name = presetSel.value;
    if (!name) return;
    const all = { ...(app.prefs.get(PRESETS_KEY) || {}) };
    delete all[name];
    app.prefs.set(PRESETS_KEY, all);
    fillPresets('');
  } }, 'Delete');
  fillPresets();

  const general = h('div.pd-section');
  const marksTab = h('div.pd-section', { hidden: true });
  const outputTab = h('div.pd-section', { hidden: true });
  const tabs = [['General', general], ['Marks and Bleed', marksTab], ['Output', outputTab]].map(([label, panel], i) => {
    const b = h('button.pd-tab', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), onclick: () => {
      for (const t of tabs) t.btn.setAttribute('aria-selected', String(t.btn === b));
      for (const t of tabs) t.panel.hidden = t.panel !== panel;
    } }, label);
    return { btn: b, panel };
  });

  const rebuild = () => {
    const count = doc.artboards.length;
    const rangeInput = h('input.pd-range', { type: 'text', value: st.range, 'aria-label': 'Artboard range', spellcheck: false, autocomplete: 'off' });
    rangeInput.addEventListener('change', () => {
      st.range = rangeInput.value;
      st.which = 'range';
      rebuild();
    });
    const which = h('div.pd-radios', { role: 'radiogroup', 'aria-label': 'Artboards' }, [['all', `All (${count})`], ['current', 'Current'], ['range', 'Range']].map(([v, l]) => {
      const r = h('input', { type: 'radio', name: 'pd-which', value: v, checked: st.which === v, disabled: st.ignoreArtboards });
      r.addEventListener('change', () => {
        st.which = v;
        refresh();
      });
      return h('label.pd-radio', r, l);
    }), rangeInput);
    const ignore = check('Ignore artboards (print all artwork)', st.ignoreArtboards, (v) => {
      st.ignoreArtboards = v;
      rebuild();
    });
    const skip = check('Skip blank artboards', st.skipBlank, (v) => (st.skipBlank = v));
    const media = sel([['artboard', 'Defined by artboard'], ...Object.entries(MEDIA).map(([k, m]) => [k, `${m.label} (${len(m.w)} × ${len(m.h)})`]), ['custom', 'Custom']], st.media, (v) => {
      st.media = v;
      if (v === 'artboard' && st.scaling === 'fit') st.scaling = 'none';
      rebuild();
    }, 'Media size');
    const custom = st.media === 'custom' ? [lenInput(st.mediaW, 'Media width', (v) => (st.mediaW = Math.max(36, v))), h('span.pd-x', '×'), lenInput(st.mediaH, 'Media height', (v) => (st.mediaH = Math.max(36, v)))] : [];
    const orient = h('div.pd-seg', { role: 'radiogroup', 'aria-label': 'Orientation' }, [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([v, l]) => h('button.btn.small', { type: 'button', role: 'radio', 'aria-checked': String(st.orientation === v), disabled: st.media === 'artboard', onclick: () => {
      st.orientation = v;
      rebuild();
    } }, l)));
    const layers = sel([['printable', 'Visible & Printable Layers'], ['visible', 'Visible Layers'], ['all', 'All Layers']], st.layers, (v) => (st.layers = v), 'Print layers');
    const anchor = h('div.pd-anchor', { role: 'radiogroup', 'aria-label': 'Placement' }, ANCHORS.map((a) => h('button.pd-anchor-cell', { type: 'button', role: 'radio', 'aria-checked': String(st.anchor === a), 'aria-label': `Place at ${a}`, onclick: () => {
      st.anchor = a;
      st.offsetX = 0;
      st.offsetY = 0;
      rebuild();
    } })));
    const offX = lenInput(st.offsetX, 'Horizontal offset', (v) => (st.offsetX = v));
    const offY = lenInput(st.offsetY, 'Vertical offset', (v) => (st.offsetY = v));
    const scaling = sel([['none', 'Do Not Scale'], ...(st.media === 'artboard' ? [] : [['fit', 'Fit to Page']]), ['custom', 'Custom Scale'], ...(st.media === 'artboard' ? [] : [['tile', 'Tile Full Pages']])], st.scaling, (v) => {
      st.scaling = v;
      rebuild();
    }, 'Scaling');
    const pct = h('input.pd-pct', { type: 'number', min: 1, max: 1000, value: st.scale, 'aria-label': 'Scale percent', disabled: !(st.scaling === 'custom' || st.scaling === 'tile') });
    pct.addEventListener('change', () => {
      st.scale = Math.max(1, Math.min(1000, Number(pct.value) || 100));
      refresh();
    });
    const overlap = lenInput(st.overlap, 'Tile overlap', (v) => (st.overlap = Math.max(0, v)));
    overlap.disabled = st.scaling !== 'tile';
    general.replaceChildren(
      field('Artboards', which),
      h('div.pd-indent', ignore.el, skip.el),
      field('Media', media, ...custom),
      field('Orientation', orient),
      field('Print layers', layers),
      field('Placement', anchor, h('div.pd-offsets', h('label', 'X', offX), h('label', 'Y', offY))),
      field('Scaling', scaling, h('label.pd-inline', pct, '%'), h('label.pd-inline', 'Overlap', overlap)),
    );

    const m = st.marks;
    const all = check("All printer's marks", m.trim && m.registration && m.colorBars && m.pageInfo, (v) => {
      st.marks = { trim: v, registration: v, colorBars: v, pageInfo: v };
      rebuild();
    });
    const mark = (key, label) => check(label, m[key], (v) => {
      st.marks = { ...st.marks, [key]: v };
      rebuild();
    }).el;
    const weight = sel([['0.125', '0.125 pt'], ['0.25', '0.25 pt'], ['0.5', '0.5 pt']], String(st.markWeight), (v) => (st.markWeight = Number(v)), 'Trim mark weight');
    const offset = lenInput(st.markOffset, 'Mark offset', (v) => (st.markOffset = Math.max(0, Math.min(72, v))));
    const docBleed = check('Use document bleed settings', st.useDocBleed, (v) => {
      st.useDocBleed = v;
      rebuild();
    });
    const b = st.useDocBleed ? { ...DEFAULT_PRINT.bleed, ...(doc.root.bleed || {}) } : st.bleed;
    const bleedInput = (side) => {
      const el = lenInput(b[side], `Bleed ${side}`, (v) => (st.bleed = { ...st.bleed, [side]: Math.max(0, Math.min(72, v)) }));
      el.disabled = st.useDocBleed;
      return h('label.pd-bleed', side[0].toUpperCase() + side.slice(1), el);
    };
    marksTab.replaceChildren(
      h('h3.pd-heading', 'Marks'),
      all.el,
      h('div.pd-grid2', mark('trim', 'Trim marks'), mark('registration', 'Registration marks'), mark('colorBars', 'Color bars'), mark('pageInfo', 'Page information')),
      field('Trim mark weight', weight),
      field('Offset', offset),
      h('h3.pd-heading', 'Bleed'),
      docBleed.el,
      h('div.pd-grid2', bleedInput('top'), bleedInput('bottom'), bleedInput('left'), bleedInput('right')),
    );

    outputTab.replaceChildren(
      field('Color', sel([['color', 'Color'], ['gray', 'Grayscale']], st.color, (v) => (st.color = v), 'Color')),
      field('Text', sel([['text', 'Print as text'], ['outlines', 'Convert to outlines']], st.textMode, (v) => (st.textMode = v), 'Text')),
      h('p.form-help', 'Copies, paper source and the printer itself are chosen in the next step.'),
    );
    refresh();
  };

  // ---- preview ----
  const canvas = h('canvas.pd-canvas', { width: 260, height: 300, 'aria-label': 'Page preview', role: 'img' });
  const pageLabel = h('span.pd-page-label');
  const prev = h('button.btn.small', { type: 'button', 'aria-label': 'Previous page', onclick: () => ((pageIndex = Math.max(0, pageIndex - 1)), draw()) }, '‹');
  const next = h('button.btn.small', { type: 'button', 'aria-label': 'Next page', onclick: () => ((pageIndex = Math.min(pages.length - 1, pageIndex + 1)), draw()) }, '›');
  const summary = h('p.pd-summary', { role: 'status' });
  let view = null; // { s, ox, oy } for dragging

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.fillRect !== 'function') return;
    const dpr = window.devicePixelRatio || 1;
    const W = 260;
    const H = 300;
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const p = pages[pageIndex];
    pageLabel.textContent = pages.length ? `${pageIndex + 1} of ${pages.length}` : 'No pages';
    prev.disabled = pageIndex <= 0;
    next.disabled = pageIndex >= pages.length - 1;
    if (!p) return;
    const s = Math.min((W - 24) / p.w, (H - 24) / p.h);
    const ox = (W - p.w * s) / 2;
    const oy = (H - p.h * s) / 2;
    view = { s, ox, oy };
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(ox + 2, oy + 3, p.w * s, p.h * s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, p.w * s, p.h * s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, p.w * s, p.h * s);
    ctx.clip();
    if (st.color === 'gray' && 'filter' in ctx) ctx.filter = 'grayscale(1)';
    const src = printView(doc, st.layers);
    for (const t of p.tiles) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox + t.x * s, oy + t.y * s, t.rect.w * t.s * s, t.rect.h * t.s * s);
      ctx.clip();
      const k = t.s * s;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (ox + t.x * s - t.rect.x * k), dpr * (oy + t.y * s - t.rect.y * k));
      drawArtwork(ctx, src, { viewRect: t.rect, outline: false, hairline: 1 / k, scale: k * dpr });
      ctx.restore();
    }
    ctx.filter = 'none';
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    for (const m of p.marks || []) {
      ctx.lineWidth = Math.max(0.5, (m.w || 0.25) * s);
      if (m.kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(ox + m.x1 * s, oy + m.y1 * s);
        ctx.lineTo(ox + m.x2 * s, oy + m.y2 * s);
        ctx.stroke();
      } else if (m.kind === 'registration') {
        ctx.beginPath();
        ctx.arc(ox + m.x * s, oy + m.y * s, m.r * s, 0, Math.PI * 2);
        ctx.stroke();
      } else if (m.kind === 'swatch') {
        ctx.fillStyle = m.color;
        ctx.fillRect(ox + m.x * s, oy + m.y * s, m.w * s, m.h * s);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, p.w * s - 1, p.h * s - 1);
  };

  // Drag the artwork in the preview to move it on the page.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!view || st.scaling === 'fit' || st.scaling === 'tile') return;
    drag = { x: e.clientX, y: e.clientY, ox: st.offsetX, oy: st.offsetY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    st.offsetX = drag.ox + (e.clientX - drag.x) / view.s;
    st.offsetY = drag.oy + (e.clientY - drag.y) / view.s;
    refresh();
  });
  canvas.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    rebuild();
  });

  function refresh() {
    pages = printJob(doc, st, { activeArtboard: editor.activeArtboard, fileName: editor.name || doc.root.name || '' });
    pageIndex = Math.min(pageIndex, Math.max(0, pages.length - 1));
    const p = pages[0];
    const scale = p?.tiles[0]?.s;
    summary.textContent = pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${len(p.w)} × ${len(p.h)} · ${Math.round((scale || 1) * 1000) / 10}%` : 'Nothing to print with these settings.';
    draw();
  }

  rebuild();
  const body = h(
    'div.pd',
    h('div.pd-top', h('label.pd-preset-label', 'Preset', presetSel), savePreset, deletePreset),
    h(
      'div.pd-main',
      h('div.pd-preview', canvas, h('div.pd-nav', prev, pageLabel, next), summary),
      h('div.pd-settings', h('div.pd-tabs', { role: 'tablist' }, tabs.map((t) => t.btn)), general, marksTab, outputTab),
    ),
  );
  const ok = await app.dialogs.open({
    title: 'Print',
    className: 'wide print-dialog',
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Print', primary: true, value: () => true, validate: () => pages.length > 0 },
    ],
  });
  if (!ok) return;
  app.prefs.set(LAST_KEY, (({ which, range, ...keep }) => keep)(st));
  const outlines = st.textMode === 'outlines' ? await outlinesFor(app, editor, null, true) : null;
  await printPages(app, editor, pages, { layers: st.layers, outlines, grayscale: st.color === 'gray' });
}
