// Preferences dialog: a category list (with keyboard navigation and a search
// box that finds options on every page) beside the selected page. Changes
// apply as soon as a control changes; each page can be reset to its defaults.
//
// Pages are declared in CATEGORIES as lists of items:
//   { type: 'check', key, label, help? }
//   { type: 'select' | 'radio', key, label, options: [{ value, label }] }
//   { type: 'number', key, label, min, max, step, unit }
//   { type: 'text', key, label, maxLength }
//   { type: 'checkNumber', key, numKey, label, min, max, step, unit }
//   { type: 'custom', label, keys: [...], keywords, render(ctx) => Node }
// plus `enabledIf(prefs) => boolean` and `help`. Feature modules add sections
// through app.preferenceSections: { category, title, keywords, build(app) }
// (a bare build function, optionally with .category, lands on General).

import { h, append, announce } from '../lib/dom.js';
import { openDialog, confirmDialog, promptDialog } from './dialog.js';
import { TIME_FORMATS } from '../lib/time.js';
import { WINDOWS, FFT_SIZES, FLOORS, settings as spectralSettings, setSettings as setSpectralSettings } from '../spectral/state.js';
import { ACCENTS, WAVE_PRESETS, cleanColor, toHex } from './appearance.js';
import { cssVar } from './theme.js';

const check = (key, label, o = {}) => ({ type: 'check', key, label, ...o });
const select = (key, label, options, o = {}) => ({ type: 'select', key, label, options, ...o });
const radio = (key, label, options, o = {}) => ({ type: 'radio', key, label, options, ...o });
const number = (key, label, o = {}) => ({ type: 'number', key, label, ...o });
const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));

/** Spectral display settings live in one object (see spectral/state.js). */
const spectral = (field, label, options, o = {}) => ({
  type: 'select',
  key: 'spectralSettings',
  label,
  options,
  get: (app) => spectralSettings(app)[field],
  set: (app, v) => setSpectralSettings(app, { [field]: v }),
  ...o,
});

export const CATEGORIES = [
  {
    id: 'general',
    label: 'General',
    sections: [
      {
        title: 'Zoom',
        items: [
          select('wheelZoomFactor', 'Mouse wheel zoom speed', opts([[0.5, 'Slow'], [1, 'Normal'], [2, 'Fast'], [4, 'Very fast']])),
          radio('wheelZoomAnchor', 'Wheel zoom keeps in place', opts([['mouse', 'The time under the pointer'], ['playhead', 'The playhead (when it is in view)']])),
        ],
      },
      {
        title: 'Editing',
        items: [
          radio('rightClick', 'Right-click in the editors', opts([['menu', 'Opens the context menu (Shift+click extends the selection)'], ['extend', 'Extends the selection (Shift+right-click opens the menu)']])),
          select('defaultFadeCurve', 'Curve for new fades', opts([['linear', 'Linear'], ['log', 'Logarithmic'], ['cosine', 'Cosine (S-curve)']]), { help: 'Used when you drag a fade handle on a file or a clip without a fade.' }),
          check('hud', 'Show the amplitude HUD over the waveform'),
          check('hudSelectionOnly', 'Show the HUD only while part of the file is selected', { enabledIf: (p) => p.get('hud') }),
          check('syncFiles', 'Keep selection, zoom and playhead in step across open audio files', { help: 'Switching to another file shows the same range (as far as that file reaches).' }),
          select('historyLimit', 'Undo history steps', opts([[50, '50'], [100, '100'], [200, '200'], [500, '500']])),
        ],
      },
      {
        title: 'New Files',
        items: [
          select('defaultRate', 'Sample rate', [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000].map((r) => ({ value: r, label: `${r} Hz` }))),
          select('defaultChannels', 'Channels', opts([[1, 'Mono'], [2, 'Stereo']])),
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    sections: [
      {
        items: [
          select('theme', 'Theme', opts([['system', 'Match the system'], ['light', 'Light'], ['dark', 'Dark']])),
          { type: 'custom', label: 'Accent color', keys: ['accentColor'], keywords: 'highlight color ' + ACCENTS.map((a) => a.label).join(' '), render: accentPicker },
          check('statusBar', 'Show the status bar'),
        ],
      },
      {
        title: 'Waveform Colors',
        items: [{ type: 'custom', bare: true, label: 'Waveform, selection and background colors', keys: ['waveColors'], keywords: 'waveform color preset selection background save delete', render: waveColorEditor }],
      },
    ],
  },
  {
    id: 'audioHardware',
    label: 'Audio Hardware',
    sections: [],
    note: 'The browser picks the output device and its sample rate; playback follows the system output.',
  },
  {
    id: 'autoSave',
    label: 'Auto Save',
    sections: [
      {
        items: [
          check('autosave', 'Keep recovery copies of unsaved audio files in this browser', { help: 'If the tab closes unexpectedly, Audio Studio offers to restore them the next time it starts.' }),
          select('autosaveInterval', 'Save a recovery copy every', opts([[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [600, '10 minutes']]), { enabledIf: (p) => p.get('autosave') !== false }),
          { type: 'custom', label: 'Recover unsaved files', keys: [], keywords: 'restore crash recovery', render: recoverButton },
        ],
      },
    ],
  },
  {
    id: 'controlSurface',
    label: 'Control Surface',
    sections: [],
  },
  {
    id: 'data',
    label: 'Data',
    sections: [
      {
        title: 'Smoothing',
        items: [
          { type: 'checkNumber', key: 'smoothDelete', numKey: 'smoothDeleteMs', label: 'Crossfade the join when deleting or cutting audio over', min: 0.5, max: 100, step: 0.5, unit: 'ms', help: 'Blends the audio on both sides of the cut so it does not click.' },
          { type: 'checkNumber', key: 'smoothEdits', numKey: 'smoothEditsMs', label: 'Crossfade the edges of processed audio over', min: 0.5, max: 200, step: 0.5, unit: 'ms', help: 'Applies to effects, the Effects Rack and the amplitude HUD when they process part of a file.' },
        ],
      },
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    sections: [
      {
        items: [
          check('fxOpenOnAdd', 'Open the settings of an effect when it is added to an Effects Rack'),
          check('fxProcessBypassed', 'Keep processing switched-off effects during playback', { help: 'Their delay lines and reverb tails stay up to date, so switching one back on is seamless. Off saves processing power.' }),
          radio('fxMenuSort', 'Sort effect menus', opts([['category', 'By category'], ['name', 'By name']])),
          check('previewAuto', 'Show the Preview Editor for effects that change the length of the audio', { help: 'View > Show Preview Editor shows it for every effect.' }),
        ],
      },
    ],
  },
  {
    id: 'markers',
    label: 'Markers & Metadata',
    sections: [
      {
        items: [
          check('exportMarkers', 'Include markers and metadata when saving as or exporting (can be changed per file)'),
          check('markerUndo', 'Add marker changes to the undo history', { help: 'When off, adding, moving and deleting markers does not create undo steps.' }),
          check('markersWithClipboard', 'Include markers when cutting, copying and pasting audio'),
          check('showMarkerLines', 'Show marker lines across the waveform'),
          check('markersInMixdowns', 'Copy session markers into multitrack mixdowns and recorded takes'),
          { type: 'text', key: 'markerName', label: 'Name for new markers', maxLength: 40, help: 'New markers are numbered after it, for example "Marker 01".' },
        ],
      },
    ],
  },
  {
    id: 'multitrack',
    label: 'Multitrack',
    sections: [
      {
        items: [
          radio('panLaw', 'Panning', opts([['balance', 'Balance: the far side fades out, center at full level'], ['equalPower', 'Equal power: loudness stays even across the pan range']])),
          select('panLawDb', 'Level at center (equal power)', [-1.5, -2.5, -3, -4.5, -6].map((v) => ({ value: v, label: `${v} dB` })), { enabledIf: (p) => p.get('panLaw') === 'equalPower' }),
          radio('soloExclusive', 'Track solo', opts([[false, 'Non-exclusive: several tracks can be soloed'], [true, 'Exclusive: soloing a track unsolos the others']])),
          check('loopToLastClip', 'When looping without a selection, loop at the end of the last clip', { help: 'When off, the loop runs to the end of the bar the last clip ends in.' }),
          check('avoidOverlap', 'Avoid overlapping clips when inserting or pasting (use the next free track)'),
          check('randomTrackColor', 'Give new tracks a random color'),
        ],
      },
    ],
  },
  {
    id: 'clips',
    label: 'Multitrack Clips',
    sections: [
      {
        items: [
          check('autoCrossfade', 'Crossfade overlapping clips automatically in new sessions'),
          check('clipsToFront', 'Bring clips to the front when selecting them'),
          check('clipGainWaveform', 'Scale the clip waveform with the clip gain'),
          radio('insertMultiple', 'When inserting several files', opts([['tracks', 'Place each file on its own track'], ['same', 'Place them one after another on the same track']])),
          check('clipFadeHandles', 'Show fade handles'),
          check('clipVolumeEnvelopes', 'Show clip volume envelopes'),
          check('clipPanEnvelopes', 'Show clip pan envelopes'),
        ],
      },
    ],
  },
  {
    id: 'playback',
    label: 'Playback and Recording',
    sections: [
      {
        title: 'Playback',
        items: [
          check('autoScroll', 'Scroll the view to follow the playhead'),
          radio('scrollWave', 'Scrolling in the Waveform editor', opts([['page', 'Page by page'], ['center', 'Keep the playhead centered']]), { enabledIf: (p) => p.get('autoScroll') }),
          radio('scrollMulti', 'Scrolling in the Multitrack editor', opts([['page', 'Page by page'], ['center', 'Keep the playhead centered']]), { enabledIf: (p) => p.get('autoScroll') }),
          check('returnToStart', 'Return the playhead to where playback started'),
          radio('returnToStartOn', 'Return it on the', opts([['first', 'First stop'], ['second', 'Second stop (the first stop leaves it where it is)']]), { enabledIf: (p) => p.get('returnToStart') }),
          check('scrollAfterReturn', 'Scroll to the playhead after it returns', { enabledIf: (p) => p.get('returnToStart') }),
          check('stopAtSelectionEnd', 'Stop at the end of the selection when playback starts inside it'),
          check('skipSelection', 'Skip the selection during playback'),
          check('scrubAudio', 'Play audio while dragging the playhead in the time ruler'),
          select('shuttleSpeed', 'J/K/L shuttle starting speed', opts([[1, 'Normal (1x)'], [1.5, '1.5x'], [2, '2x'], [4, '4x']]), { help: 'L plays forward and J backward; pressing again doubles the speed, K stops.' }),
        ],
      },
      {
        title: 'Level Meters',
        items: [
          number('meterCaution', 'Caution color from', { min: -60, max: 0, step: 0.5, unit: 'dBFS' }),
          number('meterWarning', 'Warning color from', { min: -60, max: 0, step: 0.5, unit: 'dBFS' }),
        ],
      },
      {
        title: 'Recording',
        items: [
          select('prerollSeconds', 'Pre-roll before punching in over a selection', opts([[0, 'Off'], [1, '1 second'], [2, '2 seconds'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds']]), { help: 'Plays the audio before the selection, then records over it.' }),
          check('prerollCountdown', 'Show a countdown during pre-roll', { enabledIf: (p) => Number(p.get('prerollSeconds')) > 0 }),
        ],
      },
    ],
  },
  {
    id: 'spectral',
    label: 'Spectral Displays',
    sections: [
      {
        items: [
          spectral('window', 'Window function', WINDOWS),
          spectral('fft', 'Resolution (FFT size)', FFT_SIZES.map((n) => ({ value: n, label: `${n} points` }))),
          spectral('minDb', 'Decibel range', FLOORS.map((v) => ({ value: v, label: `${-v} dB` }))),
          check('spectralLog', 'Logarithmic frequency scale'),
          check('spectralGrid', 'Show frequency gridlines'),
          number('spectralGridOpacity', 'Gridline opacity', { min: 2, max: 100, step: 1, unit: '%', enabledIf: (p) => p.get('spectralGrid') }),
          check('spectralPlaySelected', 'Play only the selected frequencies while a spectral selection exists'),
        ],
      },
    ],
  },
  {
    id: 'time',
    label: 'Time Display',
    sections: [
      {
        items: [
          select('timeFormat', 'Time format', TIME_FORMATS.map((f) => ({ value: f.id, label: f.label }))),
          number('customFps', 'Custom frame rate', { min: 1, max: 240, step: 1, unit: 'fps', help: 'Used by the Custom Frame Rate format.' }),
          number('tempo', 'Tempo', { min: 20, max: 400, step: 0.5, unit: 'BPM', help: 'Quarter notes per minute, for Bars and Beats.' }),
          { type: 'custom', label: 'Time signature', keys: ['beatsPerBar', 'beatNote'], keywords: 'meter beats per bar note', render: timeSignature },
          number('subdivisions', 'Subdivisions per beat', { min: 1, max: 100, step: 1, help: 'Shown after the beat and used for snapping in Bars and Beats.' }),
        ],
      },
    ],
  },
];

// ------------------------------------------------------------ custom items

function accentPicker({ app, row }) {
  const group = h('div.prefs-swatches', { role: 'radiogroup', 'aria-label': 'Accent color' });
  const current = () => app.prefs.get('accentColor');
  const render = () => {
    group.replaceChildren(
      ...ACCENTS.map((a, i) => {
        const on = current() === a.id;
        const b = h('button.prefs-swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), 'aria-label': a.label, title: a.label, tabindex: on ? '0' : '-1', style: { '--swatch': a.dark, '--swatch-light': a.light } });
        b.addEventListener('click', () => {
          app.prefs.set('accentColor', a.id);
          render();
          group.children[i]?.focus();
        });
        b.addEventListener('keydown', (e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const n = ACCENTS[(i + d + ACCENTS.length) % ACCENTS.length];
          app.prefs.set('accentColor', n.id);
          render();
          group.children[ACCENTS.indexOf(n)]?.focus();
        });
        return b;
      }),
    );
  };
  render();
  row.refresh = render;
  return group;
}

function waveColorEditor({ app, row }) {
  const p = app.prefs;
  const userPresets = () => (Array.isArray(p.get('waveColorPresets')) ? p.get('waveColorPresets') : []);
  const presetSel = h('select.select', { 'aria-label': 'Waveform color preset' });
  const del = h('button.btn', { type: 'button' }, 'Delete Preset');
  const save = h('button.btn', { type: 'button' }, 'Save as Preset...');
  const fields = [
    ['wave', 'Waveform', '--wave'],
    ['selection', 'Selection', '--sel-edge'],
    ['background', 'Background', '--bg-editor'],
  ];
  const inputs = {};
  const grid = h('div.form-grid.prefs-colors');
  for (const [k, label, token] of fields) {
    inputs[k] = h('input.prefs-color', { type: 'color', 'aria-label': `${label} color`, dataset: { token } });
    inputs[k].addEventListener('input', () => {
      const cur = p.get('waveColors') || {};
      const next = { wave: cur.wave ?? null, selection: cur.selection ?? null, background: cur.background ?? null, [k]: inputs[k].value };
      p.set('waveColors', next);
      sync();
    });
    grid.append(h('label', `${label}:`), inputs[k]);
  }
  const all = () => [...WAVE_PRESETS.map((x) => ({ ...x, builtIn: true })), ...userPresets()];
  const same = (a, b) => ['wave', 'selection', 'background'].every((k) => (cleanColor(a?.[k]) || null) === (cleanColor(b?.[k]) || null));
  const sync = () => {
    const cur = p.get('waveColors');
    const list = all();
    const match = list.findIndex((x) => same(x, cur || {}));
    presetSel.replaceChildren(...list.map((x, i) => h('option', { value: String(i), selected: i === match }, x.builtIn ? x.name : `${x.name} (yours)`)));
    if (match < 0) presetSel.append(h('option', { value: '', selected: true }, 'Custom'));
    del.disabled = match < 0 || list[match].builtIn;
    // Unset colors show the theme's current value.
    for (const [k, , token] of fields) inputs[k].value = cleanColor(cur?.[k]) ? toHex(cur[k]) : toHex(cssVar(token) || '#000000');
  };
  presetSel.addEventListener('change', () => {
    const x = all()[Number(presetSel.value)];
    if (!x) return;
    p.set('waveColors', x.wave || x.selection || x.background ? { wave: x.wave, selection: x.selection, background: x.background } : null);
    sync();
  });
  save.addEventListener('click', async () => {
    const name = await promptDialog({ title: 'Save Waveform Colors', label: 'Preset name:', value: 'My Colors', validate: (v) => (!v.trim() ? 'Enter a name.' : WAVE_PRESETS.some((x) => x.name.toLowerCase() === v.trim().toLowerCase()) ? 'A built-in preset has that name.' : '') });
    if (!name) return;
    const cur = p.get('waveColors') || {};
    const preset = { name: name.trim(), wave: inputs.wave.value, selection: inputs.selection.value, background: inputs.background.value, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => cleanColor(v))) };
    p.set('waveColorPresets', [...userPresets().filter((x) => x.name !== preset.name), preset]);
    p.set('waveColors', { wave: preset.wave, selection: preset.selection, background: preset.background });
    sync();
    announce(`Saved preset ${preset.name}`);
  });
  del.addEventListener('click', () => {
    const x = all()[Number(presetSel.value)];
    if (!x || x.builtIn) return;
    p.set('waveColorPresets', userPresets().filter((u) => u.name !== x.name));
    sync();
    announce(`Deleted preset ${x.name}`);
  });
  sync();
  row.refresh = sync;
  return h('div.prefs-wave-colors', h('div.form-grid', h('label', 'Preset:'), h('div.prefs-inline', presetSel, save, del)), grid);
}

function timeSignature({ app, row }) {
  const beats = h('input.input.num', { type: 'number', min: 1, max: 16, step: 1, 'aria-label': 'Beats per bar' });
  const note = h('select.select', { 'aria-label': 'Beat note' }, [2, 4, 8, 16].map((n) => h('option', { value: n }, String(n))));
  const sync = () => {
    beats.value = app.prefs.get('beatsPerBar');
    note.value = String(app.prefs.get('beatNote'));
  };
  beats.addEventListener('change', () => {
    const v = Math.round(Number(beats.value));
    if (Number.isFinite(v)) app.prefs.set('beatsPerBar', Math.max(1, Math.min(16, v)));
    sync();
  });
  note.addEventListener('change', () => app.prefs.set('beatNote', Number(note.value)));
  sync();
  row.refresh = sync;
  return h('div.prefs-inline', beats, h('span.muted', '/'), note);
}

function recoverButton({ app }) {
  return h('button.btn', { type: 'button', disabled: !app.commands.isEnabled('file.recover'), onclick: () => app.commands.run('file.recover') }, 'Recover Unsaved Files...');
}

// ------------------------------------------------------------- page model

/** Pages with extension sections from app.preferenceSections merged in. */
export function preferencePages(app) {
  const extra = new Map();
  for (const s of app.preferenceSections || []) {
    const sec = typeof s === 'function' ? { category: s.category || 'general', title: s.title, keywords: s.keywords, build: s } : s;
    const id = CATEGORIES.find((c) => c.id === sec.category || c.label === sec.category)?.id || 'general';
    if (!extra.has(id)) extra.set(id, []);
    extra.get(id).push({ title: sec.title, items: [{ type: 'custom', bare: true, label: sec.title || '', keys: sec.keys || [], keywords: sec.keywords || '', render: ({ app: a }) => h('div.prefs-ext', sec.build(a)) }] });
  }
  return CATEGORIES.map((c) => ({ ...c, sections: [...c.sections, ...(extra.get(c.id) || [])] }));
}

/** Preference keys a page controls (for Reset). */
export function pageKeys(page) {
  const keys = new Set();
  for (const s of page.sections) {
    for (const it of s.items) {
      if (it.key) keys.add(it.key);
      if (it.numKey) keys.add(it.numKey);
      for (const k of it.keys || []) keys.add(k);
    }
  }
  return [...keys];
}

const itemText = (page, section, it) => `${it.label} ${it.help || ''} ${it.keywords || ''} ${(it.options || []).map((o) => o.label).join(' ')} ${section.title || ''} ${page.label}`.toLowerCase();

/** Items matching a search: [{ page, section, item }]. Every word must match. */
export function searchPreferences(pages, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const page of pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        const text = itemText(page, section, item);
        if (words.every((w) => text.includes(w))) out.push({ page, section, item });
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ dialog

let rowCount = 0;
let current = null; // the open dialog: { show(id) }

/** Builds the control row for one item. */
function renderItem(app, item) {
  const p = app.prefs;
  const id = `pref-${++rowCount}`;
  const helpId = item.help ? `${id}-help` : null;
  const get = () => (item.get ? item.get(app) : p.get(item.key));
  const set = (v) => (item.set ? item.set(app, v) : p.set(item.key, v));
  const numeric = item.options && typeof item.options[0]?.value === 'number';
  const boolean = item.options && typeof item.options[0]?.value === 'boolean';
  const parse = (v) => (numeric ? Number(v) : boolean ? v === 'true' : v);
  const row = h(`div.prefs-row.prefs-${item.type}`, { dataset: { key: item.key || (item.keys || [])[0] || '' } });
  row._item = item;
  const add = (...kids) => append(row, kids);
  const help = helpId ? h('div.prefs-help', { id: helpId }, item.help) : null;
  let controls = [];
  if (item.type === 'check') {
    const c = h('input', { type: 'checkbox', id, 'aria-describedby': helpId });
    row.refresh = () => (c.checked = Boolean(get()));
    c.addEventListener('change', () => set(c.checked));
    add(h('label.check', { for: id }, c, item.label), help);
    controls = [c];
  } else if (item.type === 'checkNumber') {
    const c = h('input', { type: 'checkbox', id, 'aria-describedby': helpId });
    const n = h('input.input.num', { type: 'number', min: item.min, max: item.max, step: item.step, 'aria-label': `${item.label} (${item.unit})` });
    row.refresh = () => {
      c.checked = Boolean(p.get(item.key));
      n.value = p.get(item.numKey);
      n.disabled = !c.checked;
    };
    c.addEventListener('change', () => {
      p.set(item.key, c.checked);
      n.disabled = !c.checked;
    });
    n.addEventListener('change', () => {
      const v = Number(n.value);
      if (Number.isFinite(v)) p.set(item.numKey, Math.max(item.min, Math.min(item.max, v)));
      n.value = p.get(item.numKey);
    });
    add(h('div.prefs-inline', h('label.check', { for: id }, c, item.label), n, h('span.muted', item.unit)), help);
    controls = [c];
  } else if (item.type === 'select') {
    const s = h('select.select', { id, 'aria-describedby': helpId }, item.options.map((o) => h('option', { value: String(o.value) }, o.label)));
    row.refresh = () => {
      const v = String(get());
      if (!item.options.some((o) => String(o.value) === v)) s.append(h('option', { value: v }, v));
      s.value = v;
    };
    s.addEventListener('change', () => set(parse(s.value)));
    add(h('label.prefs-label', { for: id }, item.label), s, help);
    controls = [s];
  } else if (item.type === 'radio') {
    const name = `${id}-r`;
    const radios = item.options.map((o, i) => h('input', { type: 'radio', name, id: `${id}-${i}`, value: String(o.value) }));
    row.refresh = () => radios.forEach((r) => (r.checked = r.value === String(get())));
    radios.forEach((r) => r.addEventListener('change', () => r.checked && set(parse(r.value))));
    add(h('fieldset.prefs-radios', { 'aria-describedby': helpId }, h('legend.prefs-label', item.label), radios.map((r, i) => h('label.check', { for: r.id }, r, item.options[i].label))), help);
    controls = radios;
  } else if (item.type === 'number') {
    const n = h('input.input.num', { type: 'number', id, min: item.min, max: item.max, step: item.step, 'aria-describedby': helpId });
    row.refresh = () => (n.value = get());
    n.addEventListener('change', () => {
      const v = Number(n.value);
      if (Number.isFinite(v) && n.value !== '') set(Math.max(item.min, Math.min(item.max, v)));
      row.refresh();
    });
    add(h('label.prefs-label', { for: id }, item.label), h('div.prefs-inline', n, item.unit ? h('span.muted', item.unit) : null), help);
    controls = [n];
  } else if (item.type === 'text') {
    const t = h('input.input', { type: 'text', id, maxLength: item.maxLength || 80, 'aria-describedby': helpId });
    row.refresh = () => (t.value = get());
    t.addEventListener('change', () => {
      const v = t.value.trim();
      if (v) set(v);
      else p.reset([item.key]);
      row.refresh();
    });
    add(h('label.prefs-label', { for: id }, item.label), t, help);
    controls = [t];
  } else if (item.type === 'custom') {
    const body = item.render({ app, row, item });
    const labelled = item.label && !item.bare;
    if (!labelled) row.classList.add('prefs-wide');
    add(labelled ? h('div.prefs-label', item.label) : null, body, help);
  }
  row.controls = controls;
  row.refresh?.();
  return row;
}

function updateEnabled(app, root) {
  for (const row of root.querySelectorAll('.prefs-row')) {
    const fn = row._item?.enabledIf;
    if (!fn) continue;
    const on = Boolean(fn(app.prefs));
    row.classList.toggle('disabled', !on);
    for (const c of row.querySelectorAll('input, select, button')) c.disabled = !on;
    if (on && row._item.type === 'checkNumber') row.refresh?.();
  }
}

/**
 * Opens Preferences on `args.category` (a page id), or the page used last.
 * When it is already open, switches page instead.
 */
export function preferencesDialog(app, args = {}) {
  const pages = preferencePages(app);
  const want = args?.category && pages.some((pg) => pg.id === args.category) ? args.category : app.prefs.get('prefsCategory');
  if (current) {
    current.show(want);
    return current.promise;
  }
  let pageId = pages.some((pg) => pg.id === want) ? want : 'general';
  const search = h('input.input.prefs-search', { type: 'search', placeholder: 'Search preferences', 'aria-label': 'Search preferences', autocomplete: 'off' });
  const tabs = h('div.prefs-tabs', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Preference pages' });
  const pick = h('select.select.prefs-pick', { 'aria-label': 'Preference page' });
  const pane = h('div.prefs-pane', { role: 'tabpanel', tabindex: '-1' });
  const status = h('div.prefs-status', { role: 'status' });
  let rows = [];
  let writing = false;

  const matches = () => searchPreferences(pages, search.value);

  const renderTabs = () => {
    const q = search.value.trim();
    const hits = q ? matches() : null;
    const count = (id) => (hits ? hits.filter((m) => m.page.id === id).length : 0);
    const visible = pages.filter((pg) => !hits || count(pg.id));
    tabs.replaceChildren(
      ...visible.map((pg) => {
        const on = pg.id === pageId;
        const t = h('button.prefs-tab', { type: 'button', role: 'tab', id: `prefs-tab-${pg.id}`, 'aria-selected': String(on), 'aria-controls': 'prefs-pane', tabindex: on || (!visible.some((x) => x.id === pageId) && pg === visible[0]) ? '0' : '-1', dataset: { page: pg.id } }, h('span', pg.label), hits ? h('span.prefs-count', String(count(pg.id))) : null);
        t.addEventListener('click', () => show(pg.id, { keepSearch: true }));
        return t;
      }),
    );
    if (hits && !visible.length) tabs.append(h('p.muted.prefs-none', 'No matches'));
    pick.replaceChildren(...visible.map((pg) => h('option', { value: pg.id, selected: pg.id === pageId }, pg.label)));
  };

  const renderPane = () => {
    const q = search.value.trim();
    const page = pages.find((pg) => pg.id === pageId);
    pane.setAttribute('aria-labelledby', `prefs-tab-${pageId}`);
    pane.id = 'prefs-pane';
    rows = [];
    const out = [h('h3.prefs-title', page.label)];
    const hits = q ? new Set(matches().filter((m) => m.page.id === pageId).map((m) => m.item)) : null;
    for (const section of page.sections) {
      const items = section.items.filter((it) => !hits || hits.has(it));
      if (!items.length) continue;
      if (section.title) out.push(h('h4.prefs-heading', section.title));
      const box = h('div.prefs-section');
      for (const it of items) {
        const row = renderItem(app, it);
        rows.push(row);
        box.append(row);
      }
      out.push(box);
    }
    if (page.note && !q) out.push(h('p.muted.prefs-note', page.note));
    if (hits && !hits.size) out.push(h('p.muted', 'Nothing on this page matches the search.'));
    pane.replaceChildren(...out);
    updateEnabled(app, pane);
  };

  const show = (id, { keepSearch = false, focusTab = false } = {}) => {
    if (!pages.some((pg) => pg.id === id)) return;
    if (!keepSearch && search.value) search.value = '';
    pageId = id;
    app.prefs.set('prefsCategory', id);
    renderTabs();
    renderPane();
    if (focusTab) tabs.querySelector(`[data-page="${id}"]`)?.focus();
  };

  // Search: the list narrows to pages with matches; Enter jumps to the first match.
  search.addEventListener('input', () => {
    const hits = matches();
    if (search.value.trim() && hits.length && !hits.some((m) => m.page.id === pageId)) pageId = hits[0].page.id;
    renderTabs();
    renderPane();
    status.textContent = search.value.trim() ? `${hits.length} matching option${hits.length === 1 ? '' : 's'}` : '';
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = matches()[0];
      if (!first) return;
      const key = first.item.key || first.item.keys?.[0];
      show(first.page.id);
      const row = rows.find((r) => r._item === first.item) || pane.querySelector(`.prefs-row[data-key="${key}"]`);
      row?.scrollIntoView?.({ block: 'center' });
      row?.classList.add('found');
      (row?.querySelector('input, select, button') || pane).focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      tabs.querySelector('[aria-selected="true"]')?.focus() || tabs.querySelector('.prefs-tab')?.focus();
    }
  });

  // Category list keys: arrows, Home and End move and select.
  tabs.addEventListener('keydown', (e) => {
    const list = [...tabs.querySelectorAll('.prefs-tab')];
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    if (j < 0) return;
    e.preventDefault();
    show(list[j].dataset.page, { keepSearch: true, focusTab: true });
  });
  pick.addEventListener('change', () => show(pick.value, { keepSearch: true }));

  // Keep controls in step with changes made elsewhere (menus, reset, import).
  const offPrefs = app.prefs.on('change', (key) => {
    if (writing) return;
    for (const row of rows) {
      const it = row._item;
      if (it.key === key || it.numKey === key || it.keys?.includes(key)) {
        if (!row.contains(document.activeElement) || it.type === 'check' || it.type === 'radio') row.refresh?.();
      }
    }
    updateEnabled(app, pane);
  });

  const resetPage = async () => {
    const page = pages.find((pg) => pg.id === pageId);
    writing = true;
    app.prefs.reset(pageKeys(page));
    writing = false;
    renderPane();
    status.textContent = `${page.label} preferences restored to their defaults.`;
  };
  const resetAll = async () => {
    const ok = await confirmDialog({ title: 'Reset All Preferences', message: 'Restore every page of Preferences to its defaults? Keyboard shortcuts, workspaces, favorites and presets are kept.', confirm: 'Reset All', danger: true });
    if (!ok) return;
    writing = true;
    app.prefs.reset([...new Set(pages.flatMap(pageKeys))]);
    writing = false;
    renderTabs();
    renderPane();
    status.textContent = 'All preferences restored to their defaults.';
  };

  renderTabs();
  renderPane();
  // Enter applies a typed value (or jumps to a search match) instead of closing the dialog.
  const body = h('div.prefs-dialog', { 'data-own-enter': '' }, h('nav.prefs-nav', { 'aria-label': 'Preferences' }, search, pick, tabs), h('div.prefs-main', pane, status));
  const promise = openDialog({
    title: 'Preferences',
    wide: true,
    className: 'prefs-window',
    body,
    initialFocus: '.prefs-tab[aria-selected="true"]',
    footerStart: h('div.prefs-resets', h('button.btn', { type: 'button', onclick: resetPage }, 'Reset Page'), h('button.btn', { type: 'button', onclick: resetAll }, 'Reset All')),
    buttons: [{ label: 'Done', value: true, primary: true }],
  }).finally(() => {
    offPrefs();
    current = null;
  });
  current = { show: (id) => show(id), promise };
  return promise;
}
