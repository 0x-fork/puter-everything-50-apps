// Files panel: every open audio file and session with its format details.
// Double-click or Enter opens one in the editor; Delete closes it; rows can be
// dragged into a multitrack session (dataTransfer type application/x-audio-studio-file).
// The app event 'reveal-files' (file ids) highlights the files behind clips.
// The disclosure arrow lists a file's markers (click one to go there); the
// footer plays the selected file from its start, loops, and can auto-play
// files as they are picked.

import { h } from '../lib/dom.js';
import { icon } from '../ui/icons.js';

const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status' },
  { id: 'duration', label: 'Duration' },
  { id: 'rate', label: 'Sample Rate' },
  { id: 'channels', label: 'Channels' },
  { id: 'bits', label: 'Bits' },
  { id: 'format', label: 'Format' },
];

export function filesPanel(app) {
  const search = h('input.input.panel-search', { type: 'search', placeholder: 'Search files', 'aria-label': 'Search files' });
  const tbtn = (cmd, ic, label) => h('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick: () => app.commands.run(cmd), dataset: { cmd } }, icon(ic, 15));
  const toolbar = h(
    'div.panel-toolbar',
    tbtn('file.open', 'folder-open', 'Open'),
    tbtn('file.import', 'download', 'Import'),
    tbtn('file.newAudio', 'file-plus', 'New Audio File'),
    tbtn('mt.insertFiles', 'mode-multitrack', 'Insert into Multitrack'),
    tbtn('file.close', 'trash-2', 'Close'),
    search,
  );
  const head = h('tr', COLUMNS.map((c) => h('th', { scope: 'col' }, c.label)));
  const body = h('tbody');
  const table = h('table.data-table', { role: 'grid', 'aria-label': 'Open files' }, h('thead', head), body);
  const playBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Play from Start', title: 'Play from Start' }, icon('play', 15));
  const loopBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Loop Playback', title: 'Loop Playback', dataset: { cmd: 'transport.loop' }, onclick: () => app.commands.run('transport.loop') }, icon('repeat', 15));
  const autoPlay = h('input', { type: 'checkbox', checked: Boolean(app.prefs.get('filesAutoPlay')), onchange: (e) => app.prefs.set('filesAutoPlay', e.target.checked) });
  playBtn.addEventListener('click', () => {
    if (!app.active) return;
    if (app.engine.playing) app.stop();
    else app.play({ from: 0 });
  });
  const footer = h('div.panel-footer.files-footer', playBtn, loopBtn, h('label.check', { title: 'Play files as you select them' }, autoPlay, 'Auto-play'));
  const el = h('div.files-panel', toolbar, h('div.table-scroll', table), footer);
  const expanded = new Set();
  const pick = (doc) => {
    const changed = app.active !== doc;
    app.activate(doc);
    if (changed && autoPlay.checked) app.play({ from: 0 });
  };

  // Files picked out by Clip > Reveal Clips in Files Panel, until another file is opened.
  let revealed = new Set();
  const render = () => {
    const q = search.value.trim().toLowerCase();
    body.replaceChildren();
    const docs = app.documents.filter((d) => !q || d.name.toLowerCase().includes(q));
    if (!docs.length) {
      body.append(h('tr', h('td.empty-row', { colspan: String(COLUMNS.length) }, h('span.empty-text', app.documents.length ? 'No matching files' : 'No open files. Drop audio here or use File > Open.'))));
    }
    for (const doc of docs) {
      const active = doc === app.active;
      const info = doc.kind === 'audio'
        ? {
            duration: app.formatTime(doc.length, doc.sampleRate),
            rate: `${doc.sampleRate} Hz`,
            channels: doc.channelCount === 1 ? 'Mono' : doc.channelCount === 2 ? 'Stereo' : `${doc.channelCount}`,
            bits: doc.info.bitDepth === 32 ? '32 (float)' : String(doc.info.bitDepth ?? ''),
            format: (doc.info.format || '').toUpperCase(),
          }
        : { duration: app.formatTime(doc.length, doc.sampleRate), rate: `${doc.sampleRate} Hz`, channels: 'Stereo', bits: '32 (float)', format: 'Session' };
      const row = h(
        `tr${revealed.has(doc.id) ? '.is-revealed' : ''}`,
        {
          tabindex: active ? '0' : '-1',
          'aria-selected': String(active),
          draggable: 'true',
          dataset: { id: doc.id },
          ondblclick: () => {
            app.activate(doc);
            app.dock.openPanel('editor');
          },
          onclick: (e) => (e.target.closest('.files-twisty') ? toggle(doc) : pick(doc)),
          onkeydown: (e) => {
            const rows = [...body.querySelectorAll('tr[data-id]')];
            const i = rows.indexOf(row);
            if (e.key === 'ArrowDown') rows[i + 1]?.focus();
            else if (e.key === 'ArrowUp') rows[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && !expanded.has(doc.id) && doc.state?.markers?.length) toggle(doc);
            else if (e.key === 'ArrowLeft' && expanded.has(doc.id)) toggle(doc);
            else if (e.key === 'Enter') {
              app.activate(doc);
              app.dock.openPanel('editor');
            } else if (e.key === 'Delete' || e.key === 'Backspace') app.closeDocument(doc);
            else return;
            e.preventDefault();
            e.stopPropagation();
          },
          ondragstart: (e) => {
            e.dataTransfer.setData('application/x-audio-studio-file', doc.id);
            e.dataTransfer.effectAllowed = 'copy';
          },
        },
        h(
          'td.name-cell',
          h('span.files-twisty', { 'aria-hidden': 'true' }, doc.state?.markers?.length ? icon(expanded.has(doc.id) ? 'chevron-down' : 'chevron-right', 12) : null),
          icon(doc.kind === 'audio' ? 'file-audio' : 'mode-multitrack', 14),
          h('span', doc.name),
        ),
        h('td', doc.dirty ? h('span.status-dot', { title: 'Unsaved changes' }, 'Modified') : ''),
        h('td.tabular', info.duration),
        h('td.tabular', info.rate),
        h('td', info.channels),
        h('td', info.bits),
        h('td', info.format),
      );
      if (doc.state?.markers?.length) row.setAttribute('aria-expanded', String(expanded.has(doc.id)));
      body.append(row);
      if (expanded.has(doc.id)) for (const m of doc.state.markers) body.append(markerRow(doc, m));
    }
    playBtn.disabled = !app.active;
    playBtn.replaceChildren(icon(app.engine.playing ? 'square' : 'play', app.engine.playing ? 13 : 15));
    loopBtn.setAttribute('aria-pressed', String(app.loop));
    for (const b of toolbar.querySelectorAll('[data-cmd]')) b.disabled = !app.commands.isEnabled(b.dataset.cmd);
  };
  function toggle(doc) {
    if (expanded.has(doc.id)) expanded.delete(doc.id);
    else expanded.add(doc.id);
    render();
    body.querySelector(`tr[data-id="${doc.id}"]`)?.focus();
  }

  /** A marker under its expanded file: click to go there (range markers select their range). */
  function markerRow(doc, m) {
    const go = () => {
      app.activate(doc);
      if (doc.setSelection) doc.setSelection(m.start, m.start + m.duration);
      doc.setCursor(m.start);
      const v = doc.view;
      if (m.start < v.start || m.start > v.end) doc.setView(m.start - (v.end - v.start) / 3, m.start + ((v.end - v.start) * 2) / 3);
    };
    return h(
      'tr.files-marker',
      { tabindex: '-1', onclick: go, onkeydown: (e) => e.key === 'Enter' && go() },
      h('td.name-cell', h('span.files-twisty'), icon(m.duration ? 'bookmark' : 'flag', 12), h('span', m.name || 'Marker')),
      h('td.tabular', { colspan: String(COLUMNS.length - 1) }, app.formatTime(m.start, doc.sampleRate), m.duration ? ` – ${app.formatTime(m.start + m.duration, doc.sampleRate)}` : ''),
    );
  }

  app.on('transport', render);
  search.addEventListener('input', render);
  app.on('documents', render);
  app.on('active', () => {
    revealed = new Set();
    render();
  });
  app.on('reveal-files', (ids) => {
    revealed = new Set(ids);
    if (search.value && app.documents.some((d) => revealed.has(d.id) && !d.name.toLowerCase().includes(search.value.trim().toLowerCase()))) search.value = '';
    render();
    const first = body.querySelector('tr.is-revealed');
    first?.scrollIntoView?.({ block: 'nearest' });
  });
  app.on('doc-change', (doc, e) => {
    if (e.kind === 'edit' || e.kind === 'history' || e.kind === 'saved' || e.kind === 'rename') render();
  });
  render();
  return { el, show: render };
}
