/**
 * The New Document dialog: preset categories (Recent, Saved, Mobile, Web,
 * Print, Film & Video, Art & Illustration) on the left, Preset Details on
 * the right (name, size and units, orientation, artboards, bleed, color
 * mode, raster effects, preview mode), Close and Create below.
 */
import { h } from '../../lib/dom.js';
import { formatLength, UNITS } from '../../lib/units.js';
import { icon } from '../../ui/icons.js';
import { openDialog } from '../../ui/dialogs/dialog.js';
import { CATEGORIES, PRESETS, UNIT_OPTIONS, RASTER_OPTIONS, PREVIEW_OPTIONS, parsePresetForm, sizeLabel, presetKey, orientationOf, pushPreset } from './presets.js';
import { parseLength } from '../../lib/units.js';
import { nextUntitled } from './naming.js';

const SIDES = ['top', 'bottom', 'left', 'right'];

/** Next "Untitled-N" name, advancing the app's untitled counter. */
export function takeUntitledName(app) {
  const { name, counter } = nextUntitled(app.untitled || 0, app.editors.map((e) => e.name));
  app.untitled = counter;
  return name;
}

export function peekUntitledName(app) {
  return nextUntitled(app.untitled || 0, app.editors.map((e) => e.name)).name;
}

/** Create a document from parsed settings and open it. */
export function createFromSettings(app, v) {
  const m = /^Untitled-(\d+)$/.exec(v.name);
  if (m) app.untitled = Math.max(app.untitled || 0, Number(m[1]));
  const spacing = Number(app.prefs.get('gridSpacing'));
  const subdivisions = Number(app.prefs.get('gridSubdivisions'));
  const editor = app.newDocument({
    name: v.name,
    width: v.width,
    height: v.height,
    units: v.units,
    artboards: v.artboards,
    bleed: v.bleed,
    colorMode: 'RGB',
    rasterResolution: v.rasterResolution,
    grid: spacing > 0 && subdivisions >= 1 ? { spacing, subdivisions } : null,
  });
  if (v.previewMode === 'pixel') editor.setViewOption('pixelPreview', true);
  return editor;
}

function presetsFor(app, cat) {
  if (cat === 'recent') return app.prefs.get('newDocRecent') || [];
  if (cat === 'saved') return app.prefs.get('newDocSaved') || [];
  return PRESETS[cat] || [];
}

function thumbFor(p) {
  const max = 56;
  const s = max / Math.max(p.width, p.height);
  return h('span.newdoc-thumb', { 'aria-hidden': 'true' }, h('span.newdoc-page', { style: { width: `${Math.max(6, p.width * s)}px`, height: `${Math.max(6, p.height * s)}px` } }));
}

export function newDocumentDialog(app) {
  const prefs = app.prefs;
  const hasRecent = (prefs.get('newDocRecent') || []).length > 0;
  let category = prefs.get('newDocCategory') || (hasRecent ? 'recent' : 'print');
  if (!CATEGORIES.some((c) => c.id === category)) category = 'print';
  const lastUnits = prefs.get('newDocUnits');
  const start = (hasRecent && prefs.get('newDocRecent')[0]) || { name: 'Letter', width: 612, height: 792, units: lastUnits || 'in' };
  const state = {
    selected: hasRecent && category === 'recent' ? presetKey(start) : null,
    selectedPreset: null,
    units: UNITS[start.units] ? start.units : 'pt',
    linked: true,
  };

  // ---- Preset Details ----
  const nameInput = h('input', { type: 'text', id: 'nd-name', value: peekUntitledName(app), spellcheck: false, autocomplete: 'off' });
  const widthInput = h('input', { type: 'text', id: 'nd-width', inputmode: 'decimal', autocomplete: 'off', spellcheck: false });
  const heightInput = h('input', { type: 'text', id: 'nd-height', inputmode: 'decimal', autocomplete: 'off', spellcheck: false });
  const unitsSelect = h('select.select', { id: 'nd-units', 'aria-label': 'Units' }, UNIT_OPTIONS.map((o) => h('option', { value: o.value }, o.label)));
  const artboardsInput = h('input', { type: 'text', id: 'nd-artboards', inputmode: 'numeric', value: String(start.artboards || 1), autocomplete: 'off' });
  const bleedInputs = Object.fromEntries(SIDES.map((s) => [s, h('input', { type: 'text', id: `nd-bleed-${s}`, inputmode: 'decimal', autocomplete: 'off', spellcheck: false })]));
  const linkBtn = h('button.icon-btn.newdoc-link', { type: 'button', 'aria-label': 'Link bleed values', 'aria-pressed': 'true', 'data-tip': 'Make all settings the same' }, icon('link', 14));
  const colorSelect = h('select.select', { id: 'nd-color' }, h('option', { value: 'RGB' }, 'RGB Color'));
  const rasterSelect = h('select.select', { id: 'nd-raster' }, RASTER_OPTIONS.map((o) => h('option', { value: String(o.value) }, o.label)));
  const previewSelect = h('select.select', { id: 'nd-preview' }, PREVIEW_OPTIONS.map((o) => h('option', { value: o.value }, o.label)));
  const error = h('p.form-error', { role: 'alert' });
  const orientBtns = ['portrait', 'landscape'].map((o) =>
    h(
      'button.icon-btn.newdoc-orient',
      { type: 'button', role: 'radio', 'aria-label': o === 'portrait' ? 'Portrait' : 'Landscape', 'data-tip': o === 'portrait' ? 'Portrait' : 'Landscape', 'aria-checked': 'false', dataset: { orient: o } },
      icon(o === 'portrait' ? 'rectangle-vertical' : 'rectangle-horizontal', 16),
    ),
  );

  const fmt = (pt) => formatLength(pt, state.units, { suffix: false });
  const setSize = (w, hgt) => {
    widthInput.value = fmt(w);
    heightInput.value = fmt(hgt);
    syncOrientation();
  };
  const currentSize = () => ({ w: parseLength(widthInput.value, state.units), h: parseLength(heightInput.value, state.units) });
  const syncOrientation = () => {
    const { w, h: hh } = currentSize();
    const o = Number.isFinite(w) && Number.isFinite(hh) ? orientationOf(w, hh) : null;
    for (const b of orientBtns) {
      const on = b.dataset.orient === o;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (!o && b.dataset.orient === 'portrait') ? 0 : -1;
    }
  };
  const setBleed = (b) => {
    const v = typeof b === 'number' ? { top: b, bottom: b, left: b, right: b } : b || {};
    for (const s of SIDES) bleedInputs[s].value = fmt(v[s] || 0);
    const vals = SIDES.map((s) => v[s] || 0);
    setLinked(vals.every((x) => x === vals[0]));
  };
  const setLinked = (on) => {
    state.linked = on;
    linkBtn.setAttribute('aria-pressed', String(on));
    linkBtn.replaceChildren(icon(on ? 'link' : 'unlink', 14));
  };
  const setUnits = (u) => {
    const { w, h: hh } = currentSize();
    const bl = Object.fromEntries(SIDES.map((s) => [s, parseLength(bleedInputs[s].value, state.units)]));
    state.units = u;
    unitsSelect.value = u;
    if (Number.isFinite(w) && Number.isFinite(hh)) setSize(w, hh);
    for (const s of SIDES) if (Number.isFinite(bl[s])) bleedInputs[s].value = fmt(bl[s]);
  };
  const applyPreset = (p) => {
    state.units = UNITS[p.units] ? p.units : 'pt';
    unitsSelect.value = state.units;
    setSize(p.width, p.height);
    setBleed(p.bleed || 0);
    artboardsInput.value = String(p.artboards || 1);
    if (p.rasterResolution) rasterSelect.value = String(p.rasterResolution);
    if (p.previewMode) previewSelect.value = p.previewMode;
    error.textContent = '';
  };

  unitsSelect.addEventListener('change', () => setUnits(unitsSelect.value));
  widthInput.addEventListener('input', syncOrientation);
  heightInput.addEventListener('input', syncOrientation);
  for (const b of orientBtns) {
    b.addEventListener('click', () => {
      const { w, h: hh } = currentSize();
      if (!Number.isFinite(w) || !Number.isFinite(hh)) return;
      if (orientationOf(w, hh) !== b.dataset.orient && w !== hh) setSize(hh, w);
      syncOrientation();
    });
    b.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const other = orientBtns.find((x) => x !== b);
      other.click();
      other.focus();
    });
  }
  linkBtn.addEventListener('click', () => {
    setLinked(!state.linked);
    if (state.linked) for (const s of SIDES) bleedInputs[s].value = bleedInputs.top.value;
  });
  for (const s of SIDES) {
    bleedInputs[s].addEventListener('input', () => {
      if (!state.linked) return;
      for (const o of SIDES) if (o !== s) bleedInputs[o].value = bleedInputs[s].value;
    });
  }

  const rawValues = () => ({
    name: nameInput.value,
    width: widthInput.value,
    height: heightInput.value,
    units: state.units,
    artboards: artboardsInput.value,
    bleed: Object.fromEntries(SIDES.map((s) => [s, bleedInputs[s].value])),
    rasterResolution: Number(rasterSelect.value),
    previewMode: previewSelect.value,
  });
  const fieldEl = { name: nameInput, width: widthInput, height: heightInput, artboards: artboardsInput, ...Object.fromEntries(SIDES.map((s) => [`bleed-${s}`, bleedInputs[s]])) };
  let parsed = null;
  const validate = () => {
    const r = parsePresetForm(rawValues());
    if (!r.ok) {
      error.textContent = r.message;
      fieldEl[r.field]?.focus();
      fieldEl[r.field]?.select?.();
      return false;
    }
    error.textContent = '';
    parsed = r.value;
    return true;
  };

  const saveBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Save Preset', 'data-tip': 'Save preset' }, icon('bookmark-plus', 16));
  const deleteBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Delete Saved Preset', 'data-tip': 'Delete saved preset', hidden: true }, icon('trash', 16));

  const row = (label, id, ...controls) => h('div.newdoc-row', h('label', { for: id }, label), h('div.newdoc-ctl', ...controls));
  const details = h(
    'section.newdoc-details',
    { 'aria-labelledby': 'nd-details-title' },
    h('div.newdoc-details-head', h('h3#nd-details-title', 'Preset Details'), h('div.newdoc-head-actions', deleteBtn, saveBtn)),
    h('label.sr-only', { for: 'nd-name' }, 'Document name'),
    nameInput,
    row('Width', 'nd-width', widthInput, unitsSelect),
    h('div.newdoc-row', h('label', { for: 'nd-height' }, 'Height'), h('div.newdoc-ctl', heightInput, h('div.newdoc-orients', { role: 'radiogroup', 'aria-label': 'Orientation' }, orientBtns))),
    row('Artboards', 'nd-artboards', artboardsInput),
    h(
      'fieldset.newdoc-bleed',
      h('legend', 'Bleed'),
      h('div.newdoc-bleed-grid', SIDES.map((s) => h('div.newdoc-bleed-cell', h('label', { for: `nd-bleed-${s}` }, s[0].toUpperCase() + s.slice(1)), bleedInputs[s])), linkBtn),
    ),
    h(
      'details.newdoc-advanced',
      { open: prefs.get('newDocAdvancedOpen') === true },
      h('summary', 'Advanced Options'),
      row('Color Mode', 'nd-color', colorSelect),
      row('Raster Effects', 'nd-raster', rasterSelect),
      row('Preview Mode', 'nd-preview', previewSelect),
    ),
    error,
  );
  details.querySelector('details').addEventListener('toggle', (e) => prefs.set('newDocAdvancedOpen', e.target.open));

  // ---- categories and presets ----
  const tabs = CATEGORIES.map((c) =>
    h('button.newdoc-tab', { type: 'button', role: 'tab', id: `nd-tab-${c.id}`, 'aria-controls': 'nd-panel', 'aria-selected': 'false', tabindex: '-1', dataset: { cat: c.id } }, c.label),
  );
  const tablist = h('div.newdoc-tabs', { role: 'tablist', 'aria-label': 'Preset categories' }, tabs);
  const heading = h('h3.newdoc-heading');
  const grid = h('div.newdoc-grid', { role: 'listbox', 'aria-label': 'Presets' });
  const panel = h('div.newdoc-panel', { role: 'tabpanel', id: 'nd-panel' }, heading, grid);

  let cards = [];
  let resolveCreate = null;
  const selectCard = (card, focus = false) => {
    for (const c of cards) {
      const on = c === card;
      c.setAttribute('aria-selected', String(on));
      c.tabIndex = on ? 0 : -1;
    }
    if (!card) return;
    state.selected = card.dataset.key;
    state.selectedPreset = card._preset;
    applyPreset(card._preset);
    deleteBtn.hidden = category !== 'saved';
    if (focus) card.focus();
  };
  const renderCategory = () => {
    for (const t of tabs) {
      const on = t.dataset.cat === category;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `nd-tab-${category}`);
    const list = presetsFor(app, category);
    const label = CATEGORIES.find((c) => c.id === category).label;
    heading.textContent = category === 'recent' ? 'Recently used settings' : category === 'saved' ? 'Your saved presets' : `Blank ${label} presets`;
    heading.append(h('span.newdoc-count', ` (${list.length})`));
    cards = list.map((p) => {
      const card = h(
        'div.newdoc-card',
        { role: 'option', 'aria-selected': 'false', tabindex: '-1', dataset: { key: presetKey(p) }, 'aria-label': `${p.name}, ${sizeLabel(p)}` },
        thumbFor(p),
        h('span.newdoc-card-name', p.name),
        ' ',
        h('span.newdoc-card-size', sizeLabel(p)),
      );
      card._preset = p;
      card.addEventListener('click', () => selectCard(card));
      card.addEventListener('dblclick', () => {
        selectCard(card);
        if (validate()) resolveCreate?.();
      });
      return card;
    });
    if (!cards.length) {
      grid.replaceChildren(h('p.newdoc-empty', category === 'saved' ? 'Save the settings you use often with the Save Preset button in Preset Details.' : 'Documents you create appear here.'));
      deleteBtn.hidden = true;
      return;
    }
    grid.replaceChildren(...cards);
    const sel = cards.find((c) => c.dataset.key === state.selected);
    if (sel) selectCard(sel);
    else cards[0].tabIndex = 0;
    deleteBtn.hidden = !(category === 'saved' && sel);
  };
  const setCategory = (cat, focusTab = false) => {
    category = cat;
    prefs.set('newDocCategory', cat);
    renderCategory();
    if (focusTab) tabs.find((t) => t.dataset.cat === cat)?.focus();
  };
  for (const t of tabs) {
    t.addEventListener('click', () => setCategory(t.dataset.cat));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      let j = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j == null) return;
      e.preventDefault();
      setCategory(tabs[j].dataset.cat, true);
    });
  }
  grid.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    let j = null;
    if (step) j = Math.max(0, Math.min(cards.length - 1, i + step));
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = cards.length - 1;
    else if (e.key === ' ') j = i;
    if (j == null) return;
    e.preventDefault();
    selectCard(cards[j], true);
  });

  saveBtn.addEventListener('click', async () => {
    const r = parsePresetForm(rawValues());
    if (!r.ok) {
      error.textContent = r.message;
      return;
    }
    const values = await app.dialogs.form({
      title: 'Save Preset',
      fields: [{ key: 'name', label: 'Preset name', type: 'text', value: state.selectedPreset && category !== 'saved' ? `${state.selectedPreset.name} (custom)` : 'My Preset' }],
      okLabel: 'Save',
    });
    const name = values?.name?.trim();
    if (!name) return;
    const v = r.value;
    const preset = { name, width: v.width, height: v.height, units: v.units, artboards: v.artboards, bleed: v.bleed, rasterResolution: v.rasterResolution, previewMode: v.previewMode };
    prefs.set('newDocSaved', pushPreset(prefs.get('newDocSaved'), preset, 50));
    state.selected = presetKey(preset);
    setCategory('saved');
    app.notify(`Saved preset "${name}"`, { polite: true });
  });
  deleteBtn.addEventListener('click', () => {
    if (category !== 'saved' || !state.selectedPreset) return;
    const key = presetKey(state.selectedPreset);
    prefs.set('newDocSaved', (prefs.get('newDocSaved') || []).filter((p) => presetKey(p) !== key));
    state.selected = null;
    state.selectedPreset = null;
    renderCategory();
    (cards[0] || tabs.find((t) => t.dataset.cat === 'saved'))?.focus();
  });

  applyPreset(start);
  renderCategory();

  const body = h('div.newdoc', h('div.newdoc-main', tablist, panel), details);
  return openDialog({
    title: 'New Document',
    className: 'wide newdoc-dialog',
    body,
    initialFocus: () => tabs.find((t) => t.dataset.cat === category),
    onOpen: ({ close }) => {
      resolveCreate = () => close(parsed);
    },
    buttons: [
      { label: 'Close', value: null },
      { label: 'Create', primary: true, validate, value: () => parsed },
    ],
  }).then((v) => {
    if (!v) return null;
    const sizeChanged = !state.selectedPreset || Math.abs(state.selectedPreset.width - v.width) > 0.01 || Math.abs(state.selectedPreset.height - v.height) > 0.01;
    const recentName = sizeChanged ? 'Custom' : state.selectedPreset.name;
    prefs.set('newDocRecent', pushPreset(prefs.get('newDocRecent'), { name: recentName, width: v.width, height: v.height, units: v.units, artboards: v.artboards, bleed: v.bleed, rasterResolution: v.rasterResolution, previewMode: v.previewMode }, 12));
    prefs.set('newDocUnits', v.units);
    return createFromSettings(app, v);
  });
}

/** New document with the most recent settings, no dialog (Alt+Mod+N). */
export function newDocumentQuick(app) {
  const last = (app.prefs.get('newDocRecent') || [])[0];
  const v = last ? { ...last, name: takeUntitledName(app), colorMode: 'RGB' } : { name: takeUntitledName(app), width: 612, height: 792, units: 'pt', artboards: 1, bleed: 0, rasterResolution: 72, previewMode: 'default' };
  return createFromSettings(app, v);
}
