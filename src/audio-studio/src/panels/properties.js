// Properties panel: details of the active file (or of whatever a feature
// module provides through app.propertySections, e.g. track and clip
// properties in a multitrack session).

import { h } from '../lib/dom.js';

export function propertiesPanel(app) {
  const el = h('div.properties-panel');
  /** Feature modules push (app, doc) => HTMLElement | null section builders. */
  app.propertySections = app.propertySections || [];

  const row = (label, value) => h('div.prop-row', h('span.prop-label', label), h('span.prop-value', value));

  const render = () => {
    const doc = app.active;
    el.replaceChildren();
    if (!doc) {
      el.append(h('div.empty-state', 'No Selection'));
      return;
    }
    for (const build of app.propertySections) {
      const section = build(app, doc);
      if (section) el.append(section);
    }
    if (doc.kind !== 'audio') return;
    const name = h('input.input', { type: 'text', value: doc.name, 'aria-label': 'File name' });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) doc.rename(v);
      else name.value = doc.name;
    });
    name.addEventListener('keydown', (e) => e.stopPropagation());
    const bytes = doc.length * doc.channelCount * 4;
    el.append(
      h(
        'section.prop-section',
        h('h3.prop-heading', 'File'),
        h('div.prop-row', h('label.prop-label', 'Name'), name),
        row('Location', doc.source?.path || (doc.source?.type === 'local' ? 'This device' : 'Not saved')),
        row('Duration', app.formatTime(doc.length, doc.sampleRate)),
        row('Sample Rate', `${doc.sampleRate} Hz`),
        row('Channels', doc.channelCount === 1 ? 'Mono' : doc.channelCount === 2 ? 'Stereo' : String(doc.channelCount)),
        row('Bit Depth', doc.info.bitDepth === 32 ? '32 (float)' : String(doc.info.bitDepth)),
        row('Source Format', (doc.info.format || 'wav').toUpperCase()),
        row('Uncompressed Size', formatBytes(bytes)),
        row('Markers', String(doc.state.markers.length)),
      ),
    );
  };
  app.on('active', render);
  app.on('doc-change', (doc, e) => doc === app.active && (e.kind === 'edit' || e.kind === 'history' || e.kind === 'saved' || e.kind === 'rename' || e.kind === 'properties') && render());
  app.on('properties', render);
  render();
  return { el, show: render };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
