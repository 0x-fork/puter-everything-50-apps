// Metadata panel: title, artist, album, year, genre and comment of the active
// audio file. Edits are undoable ("Edit Metadata") and are written into
// exports as RIFF INFO (WAV), ID3v2 (MP3, AIFF), Vorbis comments (FLAC, Ogg)
// or MP4 atoms (M4A) when "Include markers and other metadata" is on.

import { h } from '../lib/dom.js';
import { META_FIELDS, cleanMeta } from '../audio/meta.js';

/** New document state with one field changed (null when nothing changes). Pure. */
export function withMetaField(state, field, value) {
  const current = state.meta || {};
  const next = cleanMeta({ ...current, [field]: value });
  const before = cleanMeta(current);
  if (JSON.stringify(next) === JSON.stringify(before)) return null;
  return { ...state, meta: next };
}

export function metadataPanel(app) {
  const inputs = new Map();
  const form = h('div.form-grid.meta-form');
  for (const f of META_FIELDS) {
    const id = `meta-${f.id}`;
    const input = f.multiline
      ? h('textarea.input.meta-comment', { id, rows: 3, spellcheck: 'true' })
      : h('input.input', { id, type: 'text', autocomplete: 'off', inputMode: f.id === 'year' ? 'numeric' : null, maxLength: f.id === 'year' ? 10 : 500 });
    const commit = () => {
      const doc = app.active;
      if (!doc || doc.kind !== 'audio') return;
      const state = withMetaField(doc.state, f.id, input.value);
      if (state) doc.apply('Edit Metadata', state);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !f.multiline) {
        commit();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = app.active?.state?.meta?.[f.id] || '';
        input.blur();
      }
    });
    inputs.set(f.id, input);
    form.append(h('label', { for: id }, `${f.label}:`), input);
  }
  const note = h('p.muted.meta-note', 'Saved with the file in WAV, AIFF, FLAC, MP3, Ogg Opus and M4A exports.');
  const empty = h('div.empty-state', 'Open an audio file to edit its metadata.');
  const el = h('div.metadata-panel', form, note, empty);

  const render = () => {
    const doc = app.active;
    const ok = doc?.kind === 'audio';
    form.hidden = !ok;
    note.hidden = !ok;
    empty.hidden = ok;
    if (!ok) return;
    const meta = doc.state.meta || {};
    for (const [id, input] of inputs) if (document.activeElement !== input) input.value = meta[id] || '';
  };
  app.on('active', render);
  app.on('doc-change', (doc, e) => doc === app.active && (e.kind === 'edit' || e.kind === 'history') && render());
  render();
  return { el, show: render, focus: () => inputs.get('title').focus() };
}
