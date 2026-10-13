// Batch Process panel: a list of files (open documents, files from this
// device or from Puter), a Favorite to apply to each (or none), export
// settings (format, sample type, location: a Puter folder, or downloads,
// zipped when there are several files), and Run with per-file progress,
// status and Cancel. Decoding, effects and encoding all run in workers, and
// files are processed one at a time so memory stays bounded.

import { h, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog } from '../ui/dialog.js';
import { FORMATS, getFormat, COMMON_RATES, usesDither } from '../export/formats.js';
import { DITHER_MODES } from '../audio/quantize.js';
import { zipStore } from '../lib/zip.js';
import { pickLocalFiles, downloadBlob, openAccept } from '../storage/files.js';
import * as puter from '../storage/puter.js';
import { loadFavorites } from '../effects/favorites.js';
import { PUTER_DRAG_TYPE, resolveMediaItems } from '../panels/media-browser.js';
import { STATUS_LABELS, addSources, removeItems, resetItems, batchSettings, plannedNames, describeBatch, runQueue, uniqueName } from './queue.js';
import { processItem, batchFavoriteProblem } from './process.js';

const PREFS = 'batchExport';

export function batchPanel(app) {
  let items = [];
  let selected = new Set();
  let running = null; // AbortController
  let focusIndex = 0;
  const settings = () => batchSettings(app.prefs.get(PREFS));
  const saveSettings = (patch) => app.prefs.set(PREFS, { ...settings(), ...patch });

  // ------------------------------------------------------------ toolbar
  const addOpenBtn = h('button.btn', { type: 'button', onclick: () => addOpen(), title: 'Add every open audio file', 'aria-label': 'Add Open Files' }, icon('file-audio', 14), h('span', 'Add Open Files'));
  const addLocalBtn = h('button.btn', { type: 'button', onclick: () => addLocal(), title: 'Add audio files from this device', 'aria-label': 'Add Files from this device' }, icon('hard-drive', 14), h('span', 'Add Files...'));
  const addPuterBtn = h('button.btn', { type: 'button', onclick: () => addPuter(), title: 'Add audio files from Puter', 'aria-label': 'Add Files from Puter' }, icon('cloud', 14), h('span', 'From Puter...'));
  const removeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Remove selected files', title: 'Remove selected files', onclick: () => removeSelected() }, icon('trash-2', 14));
  const clearBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Clear the list', title: 'Clear the list', onclick: () => clearAll() }, icon('x', 14));
  const toolbar = h('div.panel-toolbar.batch-toolbar', addOpenBtn, addLocalBtn, addPuterBtn, h('div.spacer'), removeBtn, clearBtn);

  // --------------------------------------------------------------- list
  const body = h('tbody');
  const table = h(
    'table.data-table.batch-table',
    { role: 'grid', 'aria-label': 'Files to process', 'aria-multiselectable': 'true' },
    h('thead', h('tr', h('th', { scope: 'col' }, 'File'), h('th.batch-status-col', { scope: 'col' }, 'Status'))),
    body,
  );
  const listWrap = h('div.table-scroll.batch-list', table);

  // ---------------------------------------------------------- settings
  const favSel = h('select.select.batch-fav', { 'aria-label': 'Favorite to apply' });
  favSel.addEventListener('change', () => {
    saveSettings({ favorite: favSel.value });
    refresh();
  });
  const favNote = h('div.batch-note.faint', { role: 'status' });
  const exportText = h('span.batch-export-text');
  const exportBtn = h('button.btn', { type: 'button', onclick: () => exportSettingsDialog() }, 'Export Settings...');
  const runBtn = h('button.btn.primary.batch-run', { type: 'button', onclick: () => run() }, icon('play', 14), h('span', 'Run'));
  const cancelBtn = h('button.btn.batch-cancel', { type: 'button', hidden: true, onclick: () => running?.abort() }, 'Cancel');
  const summary = h('div.batch-summary', { 'aria-live': 'polite' });
  const foot = h(
    'div.batch-foot',
    h('div.batch-field', h('label.batch-label', 'Favorite'), favSel),
    favNote,
    h('div.batch-field', h('span.batch-label', 'Export'), h('div.batch-export', exportText, exportBtn)),
    h('div.batch-actions', summary, h('div.spacer'), cancelBtn, runBtn),
  );
  const el = h('div.batch-panel', toolbar, listWrap, foot);

  // Drop files from the desktop onto the list.
  // Drops from the desktop or the Media Browser add files to the list (the
  // window-level open handlers skip drops whose default was prevented).
  const dragTypes = (e) => [...(e.dataTransfer?.types || [])];
  el.addEventListener('dragover', (e) => {
    const t = dragTypes(e);
    if (t.includes('Files') || t.includes(PUTER_DRAG_TYPE)) {
      e.preventDefault();
      el.classList.add('drop');
    }
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop');
  });
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    if (dragTypes(e).includes(PUTER_DRAG_TYPE)) {
      e.preventDefault();
      let list = [];
      try {
        list = JSON.parse(e.dataTransfer.getData(PUTER_DRAG_TYPE));
      } catch {
        return;
      }
      add(list.filter((x) => x?.path && !x.local && !puter.isDir(x)).map((x) => ({ type: 'puter', path: x.path, item: x })));
      // Device folder files resolve to Files asynchronously.
      const device = list.filter((x) => x?.local);
      if (device.length) resolveMediaItems(device).then((files) => files.length && add(files.map((file) => ({ type: 'local', file }))));
      return;
    }
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    add(files.map((file) => ({ type: 'local', file })));
  });

  // -------------------------------------------------------------- adding
  function add(sources) {
    if (running) return;
    const r = addSources(items, sources);
    items = r.items;
    if (r.added) announce(`${r.added} file${r.added === 1 ? '' : 's'} added`);
    else if (sources.length) app.notify('Those files are already in the list.');
    refresh();
  }
  function addOpen() {
    const docs = app.documents.filter((d) => d.kind === 'audio');
    if (!docs.length) return app.notify('There are no open audio files.');
    add(docs.map((doc) => ({ type: 'doc', doc })));
  }
  async function addLocal() {
    const files = await pickLocalFiles({ accept: openAccept(), multiple: true });
    if (files.length) add(files.filter((f) => !/\.asesx$/i.test(f.name)).map((file) => ({ type: 'local', file })));
  }
  async function addPuter() {
    try {
      if (!puter.isSignedIn() && !(await puter.signIn().catch(() => false))) return;
      const picked = await puter.pickFiles({ multiple: true, accept: openAccept() });
      add(picked.filter((f) => !puter.isDir(f) && !/\.asesx$/i.test(f.name || '')).map((item) => ({ type: 'puter', path: item.path, item })));
    } catch (err) {
      app.notify(err?.message || 'Could not open the Puter file picker.', { error: true });
    }
  }
  function removeSelected() {
    if (running || !selected.size) return;
    const n = selected.size;
    items = removeItems(items, [...selected]);
    selected = new Set();
    focusIndex = Math.min(focusIndex, Math.max(0, items.length - 1));
    announce(`${n} file${n === 1 ? '' : 's'} removed`);
    refresh();
  }
  function clearAll() {
    if (running) return;
    items = [];
    selected = new Set();
    announce('List cleared');
    refresh();
  }

  // ------------------------------------------------------------ settings
  const favorites = () => loadFavorites(app.prefs);
  function renderFavorites() {
    const s = settings();
    favSel.replaceChildren(h('option', { value: '' }, 'None (convert only)'), ...favorites().map((f) => h('option', { value: f.id }, f.name)));
    favSel.value = favorites().some((f) => f.id === s.favorite) ? s.favorite : '';
    const fav = favorites().find((f) => f.id === favSel.value);
    const problem = batchFavoriteProblem(fav);
    favNote.textContent = problem;
    favNote.hidden = !problem;
  }

  function locationText(s) {
    if (s.location === 'puter') return `to ${s.dir || `~/${puter.APP_DIR}`}`;
    return 'downloaded (several files as one ZIP)';
  }

  async function exportSettingsDialog() {
    const s = settings();
    const sdk = Boolean(puter.sdk());
    const fmtSel = h('select.select', { 'aria-label': 'Format' }, FORMATS.map((f) => h('option', { value: f.id }, f.label)));
    fmtSel.value = s.format;
    const rateSel = h('select.select', { 'aria-label': 'Sample rate' });
    const chSel = h('select.select', { 'aria-label': 'Channels' }, h('option', { value: 'source' }, 'Same as source'), h('option', { value: '1' }, 'Mono'), h('option', { value: '2' }, 'Stereo'));
    chSel.value = String(s.channels);
    const bitSel = h('select.select', { 'aria-label': 'Bit depth' });
    const ditherSel = h('select.select', { 'aria-label': 'Dither' }, DITHER_MODES.map((d) => h('option', { value: d.id }, d.label)));
    ditherSel.value = s.dither;
    const settingsHost = h('div.batch-format-settings');
    const prefix = h('input.input', { type: 'text', value: s.prefix, 'aria-label': 'File name prefix', spellcheck: 'false' });
    const suffix = h('input.input', { type: 'text', value: s.suffix, 'aria-label': 'File name suffix', spellcheck: 'false' });
    const locSel = h('select.select', { 'aria-label': 'Location' }, h('option', { value: 'puter', disabled: !sdk }, sdk ? 'Puter folder' : 'Puter folder (not available)'), h('option', { value: 'download' }, 'Download (ZIP for several files)'));
    locSel.value = sdk ? s.location : 'download';
    let dir = s.dir;
    const dirText = h('span.batch-dir');
    const browse = h('button.btn', { type: 'button' }, 'Browse...');
    const dirRow = h('div.batch-dir-row', icon('folder', 14), dirText, browse);
    const collSel = h('select.select', { 'aria-label': 'When a file exists' }, h('option', { value: 'rename' }, 'Add a number to the name'), h('option', { value: 'overwrite' }, 'Replace the existing file'));
    collSel.value = s.collision;
    const collRow = [h('label', 'If a file exists:'), collSel];
    const bitRow = [h('label', 'Bit Depth:'), bitSel];
    const ditherRow = [h('label', 'Dither:'), ditherSel];
    const example = h('div.faint.batch-example');
    const formatSettings = { ...s.settings };

    const sync = () => {
      const f = getFormat(fmtSel.value);
      const rates = f.rates || COMMON_RATES;
      const curRate = rateSel.value || String(s.sampleRate);
      rateSel.replaceChildren(...(f.rates ? [] : [h('option', { value: 'source' }, 'Same as source')]), ...rates.map((r) => h('option', { value: String(r) }, `${r} Hz`)));
      rateSel.value = [...rateSel.options].some((o) => o.value === curRate) ? curRate : rateSel.options[0].value;
      bitRow.forEach((x) => (x.hidden = !f.bitDepths));
      if (f.bitDepths) {
        const cur = Number(bitSel.value || s.bitDepth);
        bitSel.replaceChildren(...f.bitDepths.map((b) => h('option', { value: String(b) }, b === 32 ? '32-bit (float)' : `${b}-bit`)));
        bitSel.value = String(f.bitDepths.includes(cur) ? cur : f.bitDepths.includes(24) ? 24 : f.bitDepths[f.bitDepths.length - 1]);
      }
      ditherRow.forEach((x) => (x.hidden = !usesDither({ format: f.id, bitDepth: f.bitDepths ? Number(bitSel.value) : undefined })));
      settingsHost.replaceChildren(
        ...f.settings.map((st) => {
          const opts = typeof st.options === 'function' ? st.options({ sampleRate: rateSel.value === 'source' ? 48000 : Number(rateSel.value) }) : st.options;
          const sel = h('select.select', { 'aria-label': st.label }, opts.map((o) => h('option', { value: String(o.value) }, o.label)));
          const cur = formatSettings[st.id] ?? st.default;
          sel.value = String(opts.some((o) => o.value === cur) ? cur : st.default);
          formatSettings[st.id] = Number(sel.value);
          sel.addEventListener('change', () => (formatSettings[st.id] = Number(sel.value)));
          return h('label.batch-setting', h('span.muted', `${st.label}:`), sel);
        }),
      );
      const puterLoc = locSel.value === 'puter';
      dirRow.hidden = !puterLoc;
      collRow.forEach((x) => (x.hidden = !puterLoc));
      dirText.textContent = dir || `~/${puter.APP_DIR}`;
      example.textContent = `Example: ${prefix.value}Interview${suffix.value}.${f.ext}`;
    };
    fmtSel.addEventListener('change', sync);
    bitSel.addEventListener('change', sync);
    rateSel.addEventListener('change', sync);
    locSel.addEventListener('change', sync);
    prefix.addEventListener('input', sync);
    suffix.addEventListener('input', sync);
    browse.addEventListener('click', async () => {
      try {
        if (!puter.isSignedIn() && !(await puter.signIn())) return;
        const item = await puter.pickDirectory();
        if (item?.path) {
          dir = item.path;
          sync();
        }
      } catch (err) {
        app.notify(err?.message || 'The folder could not be chosen.', { error: true });
      }
    });
    sync();
    const body = h(
      'div.batch-settings',
      h(
        'div.form-grid',
        h('label', 'Format:'),
        fmtSel,
        h('label', 'Sample Rate:'),
        rateSel,
        h('label', 'Channels:'),
        chSel,
        ...bitRow,
        ...ditherRow,
        h('label', 'Format Settings:'),
        settingsHost,
        h('label', 'Name Prefix:'),
        prefix,
        h('label', 'Name Suffix:'),
        suffix,
        h('label', 'Location:'),
        h('div.batch-loc', locSel, dirRow),
        ...collRow,
      ),
      example,
    );
    const r = await openDialog({ title: 'Batch Export Settings', body, className: 'batch-settings-dialog', buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', primary: true }] });
    if (r !== 'ok') return;
    const f = getFormat(fmtSel.value);
    saveSettings({
      format: f.id,
      sampleRate: rateSel.value === 'source' ? 'source' : Number(rateSel.value),
      channels: chSel.value === 'source' ? 'source' : Number(chSel.value),
      bitDepth: f.bitDepths ? Number(bitSel.value) : s.bitDepth,
      dither: ditherSel.value,
      settings: { ...s.settings, ...formatSettings },
      prefix: prefix.value,
      suffix: suffix.value,
      location: locSel.value,
      dir,
      collision: collSel.value,
    });
    refresh();
  }

  // ----------------------------------------------------------------- run
  async function run() {
    if (running || !items.length) return;
    const s = settings();
    const fav = favorites().find((f) => f.id === s.favorite) || null;
    const problem = batchFavoriteProblem(fav);
    if (problem) return app.notify(`${fav.name}: ${problem}`, { error: true });
    let dir = null;
    if (s.location === 'puter') {
      if (!puter.sdk()) return app.notify('Puter is not available. Choose Download in Export Settings.', { error: true });
      if (!puter.isSignedIn() && !(await puter.signIn().catch(() => false))) return;
      dir = s.dir || (await puter.appDir());
    }
    running = new AbortController();
    const signal = running.signal;
    const zip = [];
    const taken = new Set();
    items = resetItems(items);
    refresh();
    const names = plannedNames(items, s);
    const write = async (name, blob) => {
      if (s.location === 'puter') {
        let final = name;
        if (s.collision === 'rename') {
          const used = new Set();
          final = name;
          while (await puter.exists(puter.joinPath(dir, final))) {
            used.add(final.toLowerCase());
            final = uniqueName(name, used);
          }
        }
        await puter.writeFile(puter.joinPath(dir, final), blob);
        return final;
      }
      const final = uniqueName(name, taken);
      zip.push({ name: final, blob });
      return final;
    };
    announce('Batch processing started');
    const result = await runQueue(items, {
      names,
      signal,
      onUpdate: (list) => {
        items = list;
        renderRows();
      },
      process: (item, o) => processItem(item, { favorite: fav, settings: s, write, ...o }),
    });
    items = result.items;
    running = null;
    if (zip.length === 1) downloadBlob(zip[0].blob, zip[0].name);
    else if (zip.length > 1) {
      const files = [];
      for (const z of zip) files.push({ name: z.name, data: new Uint8Array(await z.blob.arrayBuffer()) });
      downloadBlob(zipStore(files), 'Batch Process.zip');
    }
    const msg = `${result.done} of ${items.length} file${items.length === 1 ? '' : 's'} processed${result.failed ? `, ${result.failed} failed` : ''}${result.cancelled ? `, ${result.cancelled} cancelled` : ''}.`;
    summary.textContent = msg;
    announce(msg);
    if (result.done && dir) app.setStatus(`Batch output saved to ${dir}`);
    refresh();
  }

  // -------------------------------------------------------------- render
  function statusCell(item) {
    const bar = h('div.batch-progress', { role: 'progressbar', 'aria-label': `${item.name} progress`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(item.progress * 100)) }, h('div.batch-progress-bar', { style: { width: `${Math.round(item.progress * 100)}%` } }));
    const text = item.status === 'done' && item.output ? `Done: ${item.output}` : item.message && item.status !== 'running' ? `${STATUS_LABELS[item.status]}: ${item.message}` : STATUS_LABELS[item.status];
    return h(`td.batch-status.st-${item.status}`, { title: text }, item.status === 'running' ? bar : null, h('span.batch-status-text', text));
  }

  function select(i, e) {
    const item = items[i];
    if (!item) return;
    if (e?.shiftKey && selected.size) {
      const anchor = items.findIndex((x) => selected.has(x.id));
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      selected = new Set(items.slice(a, b + 1).map((x) => x.id));
    } else if (e?.ctrlKey || e?.metaKey) {
      if (selected.has(item.id)) selected.delete(item.id);
      else selected.add(item.id);
      selected = new Set(selected);
    } else selected = new Set([item.id]);
    focusIndex = i;
    renderRows();
    body.children[i]?.focus();
  }

  function rowKeys(e, i) {
    if (e.key === 'ArrowDown') select(Math.min(items.length - 1, i + 1), { shiftKey: e.shiftKey });
    else if (e.key === 'ArrowUp') select(Math.max(0, i - 1), { shiftKey: e.shiftKey });
    else if (e.key === ' ') select(i, { ctrlKey: true });
    else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
      selected = new Set(items.map((x) => x.id));
      renderRows();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function renderRows() {
    if (!items.length) {
      body.replaceChildren(h('tr', h('td.empty-row', { colspan: '2' }, h('span.empty-text', 'Add open files, files from this device or from Puter, or drop files here.'))));
      return;
    }
    const hadFocus = body.contains(document.activeElement);
    body.replaceChildren(
      ...items.map((item, i) =>
        h(
          'tr',
          {
            'aria-selected': String(selected.has(item.id)),
            tabindex: i === focusIndex ? '0' : '-1',
            onclick: (e) => select(i, e),
            onkeydown: (e) => rowKeys(e, i),
          },
          h('td.batch-name', { title: item.source.type === 'puter' ? item.source.path : item.name }, h('span.name-cell', icon(item.source.type === 'doc' ? 'file-audio' : item.source.type === 'puter' ? 'cloud' : 'hard-drive', 14), h('span', item.name))),
          statusCell(item),
        ),
      ),
    );
    if (hadFocus) body.children[focusIndex]?.focus();
  }

  function refresh() {
    const busy = Boolean(running);
    renderFavorites();
    const s = settings();
    exportText.textContent = `${describeBatch(s)}; ${locationText(s)}`;
    addOpenBtn.disabled = busy;
    addLocalBtn.disabled = busy;
    addPuterBtn.disabled = busy;
    addPuterBtn.hidden = !puter.sdk();
    removeBtn.disabled = busy || !selected.size;
    clearBtn.disabled = busy || !items.length;
    favSel.disabled = busy;
    exportBtn.disabled = busy;
    runBtn.disabled = busy || !items.length;
    runBtn.hidden = busy;
    cancelBtn.hidden = !busy;
    if (!busy && !items.some((i) => i.status !== 'ready')) summary.textContent = items.length ? `${items.length} file${items.length === 1 ? '' : 's'} ready` : '';
    renderRows();
  }

  // Closed documents leave the list.
  app.on('documents', () => {
    if (running) return;
    const open = new Set(app.documents);
    const before = items.length;
    items = items.filter((i) => i.source.type !== 'doc' || open.has(i.source.doc));
    if (items.length !== before) refresh();
  });
  app.prefs.on('change', (key) => (key === 'favorites' || key === PREFS) && !running && refresh());
  refresh();

  return {
    el,
    show: refresh,
    focus: () => (items.length ? body.children[focusIndex] : addOpenBtn)?.focus(),
    /** For scripting and tests. */
    api: { add, run, get items() { return items; }, cancel: () => running?.abort() },
  };
}

