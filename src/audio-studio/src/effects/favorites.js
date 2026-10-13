// Favorites: named one-click actions (an effect with stored settings, or a
// command with arguments) applied without dialogs. They fill the Favorites
// menu and panel, can carry a keyboard shortcut, and can be recorded: after
// Start Recording Favorite, the next applied effect is captured with its
// settings and saved under a name you choose.
//
// prefs key 'favorites': [{ id, name, shortcut, action }] where action is
//   { type: 'effect', effect, values } | { type: 'command', command, args }

import { h, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { formatShortcut, eventShortcut, normalizeShortcut } from '../commands/registry.js';
import { getEffect } from './registry.js';
import { normalizeValues, formatValue } from './params.js';
import { lastValues } from './presets.js';
import { openEffectDialog } from './dialog.js';
import { groupedEffects } from './rack.js';
import { showNotice } from '../ui/notices.js';

let nextFav = 1;
const favId = () => `fav${Date.now().toString(36)}${nextFav++}`;

const effect = (name, id, values = {}) => ({ id: `seed-${id}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, shortcut: '', action: { type: 'effect', effect: id, values } });
const command = (name, id, args) => ({ id: `seed-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, shortcut: '', action: { type: 'command', command: id, args } });

/** The default set: everyday one-click fixes, in the spirit of a pro editor's starter favorites (original names). */
export function seedFavorites() {
  return [
    command('Auto Heal', 'fx.autoHeal'),
    command('Convert to Mono', 'fx.toMono'),
    command('Convert to Stereo', 'fx.toStereo'),
    effect('De-Esser', 'deesser'),
    effect('De-Noise', 'denoise'),
    effect('De-Reverb', 'dereverb'),
    command('Fade In', 'fx.fadeIn'),
    command('Fade Out', 'fx.fadeOut'),
    effect('Hard Limit to -0.1 dB', 'hardLimiter', { ceiling: -0.1, inputBoost: 0 }),
    effect('Lower Pitch', 'pitchShifter', { semitones: -2, cents: 0, precision: 1, formants: false }),
    command('Normalize to -0.1 dB', 'fx.normalizePeak', { peak: -0.1 }),
    command('Normalize to -3 dB', 'fx.normalizePeak', { peak: -3 }),
    effect('Raise Pitch', 'pitchShifter', { semitones: 2, cents: 0, precision: 1, formants: false }),
    effect('Remove 50 Hz Hum', 'dehummer', HUM(50)),
    effect('Remove 60 Hz Hum', 'dehummer', HUM(60)),
    effect('Remove Vocals', 'centerChannelExtractor', { target: 0, centerLevel: -48, sideLevel: 0 }),
    effect('Repair Clicks and Crackle', 'autoClickRemover'),
    effect('Repair DC Offset', 'dcOffset'),
    effect('Telephone Voice', 'parametricEq', TELEPHONE),
    effect('Voice-Over Compressor', 'singleBandCompressor', VOICE_OVER),
  ];
}

// High-pass at 400 Hz, low-pass at 3.2 kHz (both 24 dB/octave) and a presence
// lift, using the Parametric Equalizer's parameter ids.
const TELEPHONE = { hpOn: true, hpFreq: 400, hpSlope: 4, lpOn: true, lpFreq: 3200, lpSlope: 4, band3On: true, band3Freq: 1500, band3Gain: 4, band3Q: 1.2 };

// Mains hum and its first harmonics (DeHummer).
const HUM = (frequency) => ({ frequency, q: 30, gain: -40, harmonics: 6, slope: 75, humOnly: false });

// Steady speech: 3:1 from -24 dB with a soft knee, RMS detection and make-up.
const VOICE_OVER = { threshold: -24, ratio: 3, attack: 5, release: 150, outputGain: 6, knee: 8, detection: 1, link: true };

/**
 * Seed ids of the first default set. Saved lists from before a seed was
 * added get it appended once (see mergeNewSeeds); these were already offered.
 */
const FIRST_SEED_IDS = [
  'seed-fade-in',
  'seed-fade-out',
  'seed-normalize-to-0-1-db',
  'seed-normalize-to-3-db',
  'seed-hardLimiter-hard-limit-to-0-1-db',
  'seed-convert-to-mono',
  'seed-convert-to-stereo',
  'seed-denoise-reduce-background-noise',
  'seed-deesser-soften-sibilance',
  'seed-dereverb-reduce-room-echo',
  'seed-autoClickRemover-repair-clicks-and-crackle',
  'seed-parametricEq-telephone-voice',
  'seed-centerChannelExtractor-remove-center-vocals',
];

const SEEDS_OFFERED = 'favoritesSeeds';

/** True when two favorites do the same thing (same effect and settings, or command and arguments). */
function sameAction(a, b) {
  const x = a.action || {};
  const y = b.action || {};
  if (x.type !== y.type) return false;
  if (x.type === 'effect') return x.effect === y.effect && JSON.stringify(x.values || {}) === JSON.stringify(y.values || {});
  return x.command === y.command && JSON.stringify(x.args ?? null) === JSON.stringify(y.args ?? null);
}

/**
 * Adds default favorites introduced since a saved list was made, without
 * touching anything the user has: each new seed is appended once, unless the
 * list already has a favorite that does the same thing. Seeds the user
 * deleted are never brought back (offered ids are remembered).
 */
export function mergeNewSeeds(prefs) {
  const list = prefs.get('favorites');
  if (!Array.isArray(list)) return false; // still on the built-in set
  const offered = new Set(prefs.get(SEEDS_OFFERED) || FIRST_SEED_IDS);
  const seeds = seedFavorites();
  const add = seeds.filter((sd) => !offered.has(sd.id) && !list.some((f) => f.id === sd.id || sameAction(f, sd)));
  prefs.set(SEEDS_OFFERED, [...new Set([...offered, ...seeds.map((sd) => sd.id)])]);
  if (!add.length) return false;
  prefs.set('favorites', [...list, ...add]);
  return true;
}

export function loadFavorites(prefs) {
  const list = prefs.get('favorites');
  return Array.isArray(list) ? list : seedFavorites();
}

export function saveFavorites(prefs, list) {
  // The first save from the built-in set has seen every current seed.
  if (!Array.isArray(prefs.get(SEEDS_OFFERED))) prefs.set(SEEDS_OFFERED, seedFavorites().map((sd) => sd.id));
  prefs.set('favorites', list);
}

export function addFavorite(prefs, fav) {
  const item = { id: favId(), shortcut: '', ...fav };
  saveFavorites(prefs, [...loadFavorites(prefs), item]);
  return item;
}

export function updateFavorite(prefs, id, patch) {
  saveFavorites(prefs, loadFavorites(prefs).map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

export function removeFavorite(prefs, id) {
  saveFavorites(prefs, loadFavorites(prefs).filter((f) => f.id !== id));
}

export function moveFavorite(prefs, id, delta) {
  const list = loadFavorites(prefs).slice();
  const i = list.findIndex((f) => f.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveFavorites(prefs, list);
}

/** Why a favorite cannot run right now, or '' when it can. */
export function favoriteProblem(app, fav) {
  const a = fav.action || {};
  if (a.type === 'effect') {
    if (!getEffect(a.effect)) return 'This effect is not available yet.';
    if (app.active?.kind !== 'audio' || !app.active.length) return 'Open an audio file first.';
    return '';
  }
  if (a.type === 'command') {
    if (!app.commands.get(a.command)) return 'This command is not available.';
    if (!app.commands.isEnabled(a.command, a.args)) return 'Not available for the current file or selection.';
    return '';
  }
  return 'This favorite is damaged. Delete it and record it again.';
}

export async function applyFavorite(app, fav) {
  const problem = favoriteProblem(app, fav);
  if (problem) {
    app.notify(`${fav.name}: ${problem}`, { error: true });
    return false;
  }
  const a = fav.action;
  if (a.type === 'effect') {
    const def = getEffect(a.effect);
    return app.runEffect(def.id, { values: normalizeValues(def, a.values) });
  }
  await app.commands.run(a.command, a.args);
  return true;
}

/** Short description of what a favorite does (panel tooltip). */
export function describeFavorite(app, fav) {
  const a = fav.action || {};
  if (a.type === 'effect') return getEffect(a.effect)?.name || `${a.effect} (not available)`;
  if (a.type === 'command') return app.commands.label(a.command);
  return '';
}

/** The settings a favorite applies, as [label, text] pairs (effect parameters or command arguments). */
export function favoriteSettings(app, fav) {
  const a = fav.action || {};
  if (a.type === 'effect') {
    const def = getEffect(a.effect);
    if (!def) return [];
    const v = normalizeValues(def, a.values);
    return (def.params || []).filter((p) => p.label && p.id in v).map((p) => [p.label, formatValue(p, v[p.id])]);
  }
  if (a.type === 'command' && a.args && typeof a.args === 'object') {
    const words = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    return Object.entries(a.args).map(([k, v]) => [words(k), typeof v === 'number' && /peak|gain|db/i.test(k) ? `${v} dB` : String(v)]);
  }
  return [];
}

// -------------------------------------------------- shortcuts (commands)

function syncShortcutCommands(app) {
  const reg = app.commands;
  for (const [key, id] of [...reg.byShortcut]) if (id.startsWith('fav.run.')) reg.byShortcut.delete(key);
  for (const id of [...reg.commands.keys()]) if (id.startsWith('fav.run.')) reg.commands.delete(id);
  for (const fav of loadFavorites(app.prefs)) {
    if (!fav.shortcut) continue;
    if (reg.byShortcut.has(normalizeShortcut(fav.shortcut))) continue; // never steal a built-in shortcut
    reg.register({ id: `fav.run.${fav.id}`, label: `Favorite: ${fav.name}`, shortcut: fav.shortcut, run: () => applyFavorite(app, loadFavorites(app.prefs).find((f) => f.id === fav.id) || fav) });
  }
}

// ---------------------------------------------------------- dialogs

/** Shortcut field: press a key combination to set it; Backspace clears. */
function shortcutField(app, value, ownId) {
  let current = value || '';
  const note = h('span.fav-shortcut-note.faint', { role: 'status' });
  const input = h('input.input.fav-shortcut', { type: 'text', readOnly: true, value: current ? formatShortcut(current) : '', placeholder: 'Press keys', 'aria-label': 'Keyboard shortcut. Press a key combination; Backspace clears.' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Escape' || e.key === 'Enter') return;
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      current = '';
      input.value = '';
      note.textContent = '';
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
    const s = eventShortcut(e);
    const parts = s.split('+');
    const key = parts.pop();
    const mods = parts.map((m) => ({ mod: 'Mod', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[m]);
    const spec = [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
    const taken = app.commands.byShortcut.get(normalizeShortcut(spec));
    if (taken && taken !== `fav.run.${ownId}`) {
      note.textContent = `${formatShortcut(spec)} is used by ${app.commands.label(taken)}.`;
      return;
    }
    current = spec;
    input.value = formatShortcut(spec);
    note.textContent = '';
  });
  return { el: h('div.fav-shortcut-field', input, note), get: () => current };
}

/** New favorite: choose an effect (then its settings) or capture the last applied one. */
export async function newFavoriteDialog(app) {
  const name = h('input.input', { type: 'text', value: '', placeholder: 'Favorite name', 'aria-label': 'Favorite name' });
  const effectSel = h(
    'select.select',
    { 'aria-label': 'Effect' },
    groupedEffects().map((g) => h('optgroup', { label: g.label }, g.defs.map((d) => h('option', { value: d.id }, d.name)))),
  );
  const shortcut = shortcutField(app, '', null);
  const error = h('div.fx-name-error', { role: 'alert' });
  const r = await openDialog({
    title: 'New Favorite',
    body: h('div.form-grid', h('label', 'Name:'), name, h('label', 'Effect:'), effectSel, h('label', 'Shortcut:'), shortcut.el, h('span'), error),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Next: Settings...', value: 'next', primary: true },
    ],
    onSubmit: () => {
      if (!effectSel.value) {
        error.textContent = 'There are no effects to choose from.';
        return false;
      }
      return true;
    },
  });
  if (r !== 'next') return null;
  const def = getEffect(effectSel.value);
  let values = lastValues(app.prefs, def);
  if (def.params.length) {
    values = await openEffectDialog(app, def, { mode: 'apply', values, title: `Favorite Settings - ${def.name}`, applyLabel: 'Save Favorite' });
    if (!values) return null;
  }
  const fav = addFavorite(app.prefs, { name: name.value.trim() || def.name, shortcut: shortcut.get(), action: { type: 'effect', effect: def.id, values } });
  announce(`Favorite ${fav.name} saved`);
  return fav;
}

export async function editFavoriteDialog(app, fav) {
  const name = h('input.input', { type: 'text', value: fav.name, 'aria-label': 'Favorite name' });
  const shortcut = shortcutField(app, fav.shortcut, fav.id);
  const isEffect = fav.action?.type === 'effect' && getEffect(fav.action.effect);
  const buttons = [{ label: 'Cancel', value: null }];
  if (isEffect && getEffect(fav.action.effect).params.length) buttons.push({ label: 'Edit Settings...', value: 'settings' });
  buttons.push({ label: 'Save', value: 'save', primary: true });
  const r = await openDialog({
    title: 'Edit Favorite',
    body: h('div.form-grid', h('label', 'Name:'), name, h('label', 'Action:'), h('span.muted', describeFavorite(app, fav)), h('label', 'Shortcut:'), shortcut.el),
    buttons,
  });
  if (!r) return false;
  updateFavorite(app.prefs, fav.id, { name: name.value.trim() || fav.name, shortcut: shortcut.get() });
  if (r === 'settings') {
    const def = getEffect(fav.action.effect);
    const values = await openEffectDialog(app, def, { mode: 'apply', values: fav.action.values, title: `Favorite Settings - ${def.name}`, applyLabel: 'Save Favorite' });
    if (values) updateFavorite(app.prefs, fav.id, { action: { ...fav.action, values } });
  }
  return true;
}

async function nameDialog(title, value) {
  const input = h('input.input', { type: 'text', value, 'aria-label': 'Favorite name', style: { width: '100%' } });
  const r = await openDialog({ title, body: h('div.form-grid', h('label', 'Name:'), input), buttons: [{ label: 'Discard', value: null }, { label: 'Save', value: 'ok', primary: true }] });
  return r === 'ok' ? input.value.trim() || value : null;
}

// ------------------------------------------------------------- panel

export function favoritesPanel(app) {
  let selectedId = null;
  const tbtn = (ic, label, onclick, extra = {}) => h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick, ...extra }, icon(ic, 15));
  const recordBtn = tbtn('transport-record', 'Record a favorite: captures the next effect you apply', () => app.commands.run(app.favorites.recording ? 'fav.recordStop' : 'fav.recordStart'), { 'aria-pressed': 'false' });
  recordBtn.classList.add('fav-record');
  const applyBtn = tbtn('transport-play', 'Apply favorite', () => current() && applyFavorite(app, current()));
  const editBtn = tbtn('pencil', 'Edit favorite', () => current() && editFavoriteDialog(app, current()));
  const deleteBtn = tbtn('trash-2', 'Delete favorite', () => {
    const f = current();
    if (!f) return;
    const list = loadFavorites(app.prefs);
    const i = list.findIndex((x) => x.id === f.id);
    removeFavorite(app.prefs, f.id);
    const next = loadFavorites(app.prefs);
    selectedId = next[Math.min(i, next.length - 1)]?.id || null;
    announce(`Favorite ${f.name} deleted`);
  });
  const addBtn = tbtn('plus', 'New favorite', () => newFavoriteDialog(app));
  const toolbar = h('div.panel-toolbar', recordBtn, applyBtn, h('div.toolbar-sep'), addBtn, editBtn, deleteBtn);
  const body = h('tbody');
  const table = h(
    'table.data-table.fav-table',
    { role: 'grid', 'aria-label': 'Favorites' },
    h('thead', h('tr', h('th', { scope: 'col' }, 'Favorite Name'), h('th', { scope: 'col' }, 'Shortcut'))),
    body,
  );
  const status = h('div.panel-footer.fav-status', { role: 'status' });
  // Details of the selected favorite: what it runs and with which settings (wide frames only).
  const details = h('div.fav-details', { 'aria-live': 'polite' });
  const el = h('div.favorites-panel', toolbar, h('div.fav-split', h('div.table-scroll', table), details), status);

  const renderDetails = (f) => {
    if (!f) {
      details.replaceChildren(h('div.empty-state', 'Select a favorite to see what it does.'));
      return;
    }
    const settings = favoriteSettings(app, f);
    const problem = favoriteProblem(app, f);
    const parts = [
      h(
        'table.data-table.fav-actions',
        { 'aria-label': `${f.name} actions` },
        h('thead', h('tr', h('th', { scope: 'col' }, 'Action Name'), h('th', { scope: 'col' }, 'Applies To'))),
        h('tbody', h('tr', h('td', describeFavorite(app, f)), h('td', 'Selection, or the whole file')))),
      settings.length
        ? h(
            'table.data-table.fav-settings',
            { 'aria-label': 'Settings' },
            h('thead', h('tr', h('th', { scope: 'col' }, 'Setting'), h('th', { scope: 'col' }, 'Value'))),
            h('tbody', ...settings.map(([k, v]) => h('tr', h('td', k), h('td.tabular', v)))),
          )
        : h('p.muted.fav-note', 'Runs with no settings to adjust.'),
      problem ? h('p.muted.fav-note', problem) : null,
    ];
    details.replaceChildren(...parts.filter(Boolean));
  };

  const current = () => loadFavorites(app.prefs).find((f) => f.id === selectedId) || null;

  const render = () => {
    const list = loadFavorites(app.prefs);
    if (selectedId && !list.some((f) => f.id === selectedId)) selectedId = null;
    if (!selectedId && list.length) selectedId = list[0].id;
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TR';
    body.replaceChildren();
    if (!list.length) body.append(h('tr', h('td.empty-row', { colspan: '2' }, h('span.empty-text', 'No favorites. Press Record, then apply an effect.'))));
    for (const fav of list) {
      const sel = fav.id === selectedId;
      const problem = favoriteProblem(app, fav);
      const missing = fav.action?.type === 'effect' ? !getEffect(fav.action.effect) : !app.commands.get(fav.action?.command);
      const row = h(
        `tr${missing ? '.unavailable' : ''}`,
        {
          tabindex: sel ? '0' : '-1',
          'aria-selected': String(sel),
          title: `${describeFavorite(app, fav)}${problem ? `. ${problem}` : ''}`,
          dataset: { id: fav.id },
          onclick: () => select(fav.id),
          ondblclick: () => applyFavorite(app, fav),
          onkeydown: (e) => {
            const i = list.indexOf(fav);
            if (e.key === 'Enter') applyFavorite(app, fav);
            else if (e.key === 'ArrowDown' && e.altKey) moveFavorite(app.prefs, fav.id, 1);
            else if (e.key === 'ArrowUp' && e.altKey) moveFavorite(app.prefs, fav.id, -1);
            else if (e.key === 'ArrowDown') select(list[Math.min(list.length - 1, i + 1)].id, true);
            else if (e.key === 'ArrowUp') select(list[Math.max(0, i - 1)].id, true);
            else if (e.key === 'F2') editFavoriteDialog(app, fav);
            else if (e.key === 'Delete' || e.key === 'Backspace') deleteBtn.click();
            else return;
            e.preventDefault();
            e.stopPropagation();
            requestAnimationFrame(() => body.querySelector('tr[aria-selected="true"]')?.focus());
          },
        },
        h('td.name-cell', icon(fav.action?.type === 'effect' ? 'fx' : 'star', 14), h('span', fav.name)),
        h('td.fav-shortcut-cell', fav.shortcut ? h('kbd', formatShortcut(fav.shortcut)) : ''),
      );
      body.append(row);
    }
    if (hadFocus) body.querySelector('tr[aria-selected="true"]')?.focus();
    const f = current();
    renderDetails(f);
    applyBtn.disabled = !f || Boolean(favoriteProblem(app, f));
    editBtn.disabled = !f;
    deleteBtn.disabled = !f;
    const rec = app.favorites.recording;
    recordBtn.setAttribute('aria-pressed', String(rec));
    recordBtn.classList.toggle('recording', rec);
    recordBtn.setAttribute('aria-label', rec ? 'Stop recording favorite' : 'Record a favorite: captures the next effect you apply');
    recordBtn.title = recordBtn.getAttribute('aria-label');
    status.textContent = rec ? 'Recording: apply an effect to capture it as a favorite.' : '';
    status.hidden = !rec;
  };
  const select = (id) => {
    selectedId = id;
    render();
  };
  app.prefs.on('change', (key) => key === 'favorites' && render());
  app.on('favorites', render);
  app.on('active', render);
  app.on('doc-change', (doc, e) => doc === app.active && e.kind === 'selection' && render());
  render();
  return { el, show: render, focus: () => (body.querySelector('tr[aria-selected="true"]') || body.querySelector('tr'))?.focus() };
}

// ---------------------------------------------------------- install

export function installFavorites(app) {
  mergeNewSeeds(app.prefs);
  const fav = {
    recording: false,
    list: () => loadFavorites(app.prefs),
    apply: (f) => applyFavorite(app, f),
    addEffect: (name, effectId, values) => {
      const def = getEffect(effectId);
      return addFavorite(app.prefs, { name, action: { type: 'effect', effect: effectId, values: def ? normalizeValues(def, values) : values } });
    },
  };
  app.favorites = fav;
  const setRecording = (on) => {
    fav.recording = on;
    app.emit('favorites');
    app.setStatus(on ? 'Recording favorite: apply an effect to capture it' : '');
    announce(on ? 'Recording favorite. Apply an effect to capture it.' : 'Stopped recording favorite');
  };
  app.on('fx-applied', async ({ effect: id, values, name }) => {
    if (!fav.recording) return;
    setRecording(false);
    const n = await nameDialog('Save Favorite', name);
    if (!n) return;
    fav.addEffect(n, id, values);
    announce(`Favorite ${n} saved`);
    app.notify(`Saved favorite "${n}".`);
  });

  app.commands.register([
    { id: 'fav.add', label: 'New Favorite...', run: () => newFavoriteDialog(app) },
    { id: 'fav.edit', label: 'Edit Favorites...', run: () => app.dock?.openPanel('favorites') },
    {
      id: 'fav.recordStart',
      label: 'Start Recording Favorite',
      enabled: () => !fav.recording,
      run: async () => {
        const go = await showNotice(app, {
          id: 'favoriteRecording',
          title: 'Recording a Favorite',
          message: [
            'Audio Studio is recording a favorite. Apply an effect in the Waveform editor and its settings are saved as a favorite you can run from the Favorites menu, the Favorites panel or a batch process.',
            'To stop without saving, choose Favorites > Stop Recording Favorite.',
          ],
        });
        if (go) setRecording(true);
      },
    },
    { id: 'fav.recordStop', label: 'Stop Recording Favorite', enabled: () => fav.recording, run: () => setRecording(false) },
  ]);

  app.favoriteMenuItems = () => {
    const list = loadFavorites(app.prefs);
    if (!list.length) return [{ type: 'cmd', label: 'No Favorites', enabled: false }];
    return list.map((f) => ({ type: 'cmd', label: f.name, enabled: !favoriteProblem(app, f), shortcut: f.shortcut ? formatShortcut(f.shortcut) : '', run: () => applyFavorite(app, f) }));
  };

  syncShortcutCommands(app);
  app.prefs.on('change', (key) => key === 'favorites' && syncShortcutCommands(app));
  app.registerPanel({ id: 'favorites', title: 'Favorites', create: favoritesPanel, near: ['files', 'effects'] });
}
