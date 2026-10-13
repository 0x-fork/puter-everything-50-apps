/**
 * Document Info panel: what the document (or, with Selection Only, the
 * selection) contains: document settings, objects by kind, graphic styles,
 * swatches, fonts, and linked and embedded images. A category menu narrows
 * the view; Save writes the report as a text file. File > Document Info
 * shows the same document summary as a dialog.
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { iconButton } from '../../ui/widgets.js';
import { formatLength, UNITS } from '../../lib/units.js';
import { graphicStylesOf } from '../paint/graphic-styles.js';
import { swatchesOf } from '../paint/swatch-model.js';
import { matchesStyle } from './select-commands.js';
import { fontsUsed } from './file-commands.js';
import { imageInfo } from './links.js';
import { documentStats } from '../files/document-stats.js';

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'document', label: 'Document' },
  { id: 'objects', label: 'Objects' },
  { id: 'styles', label: 'Graphic Styles' },
  { id: 'swatches', label: 'Swatches' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'linked', label: 'Linked Images' },
  { id: 'embedded', label: 'Embedded Images' },
];

/** Nodes in scope: the whole document, or the selection and everything inside it. */
function scopeNodes(doc, ids) {
  const out = [];
  if (!ids) {
    doc.walk((n) => {
      out.push(n);
    });
    return out;
  }
  const seen = new Set();
  const visit = (id) => {
    const n = doc.get(id);
    if (!n || seen.has(id)) return;
    seen.add(id);
    out.push(n);
    for (const c of n.children || []) visit(c);
  };
  for (const id of ids) visit(id);
  return out;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The report as sections [{ id, title, rows: [[label, value]] | items: [string] }]. */
export function documentReport(editor, { selectionOnly = false } = {}) {
  const doc = editor.doc;
  const root = doc.root;
  const units = UNITS[root.units] ? root.units : 'pt';
  const L = (v) => formatLength(v, units);
  const ids = selectionOnly ? editor.topSelection() : null;
  const nodes = scopeNodes(doc, ids);
  const st = documentStats(doc, { ids });
  const count = st.counts;
  const colors = st.colors;
  const swatchRefs = st.swatchRefs;
  const sections = [];
  sections.push({
    id: 'document',
    title: 'Document',
    rows: [
      ['Name', editor.name],
      ['Color Mode', root.colorMode === 'CMYK' ? 'CMYK Color' : 'RGB Color'],
      ['Units', UNITS[units].label],
      ['Artboards', `${root.artboards.length}: ${root.artboards.map((a) => `${L(a.w)} x ${L(a.h)}`).join(', ')}`],
      ['Raster Effects', `${root.rasterResolution || 72} ppi`],
      ...(root.info?.author ? [['Author', [].concat(root.info.author).join('; ')]] : []),
      ...(selectionOnly ? [['Scope', `Selection (${plural(editor.topSelection().length, 'object')})`]] : []),
    ],
  });
  sections.push({
    id: 'objects',
    title: 'Objects',
    rows: [
      ['Layers', count.layer],
      ['Paths', count.path],
      ['Compound Paths', count.compound],
      ['Groups', count.group],
      ['Clip Groups', count.clip],
      ['Type Objects', `${count.text} (${count.pointText} point, ${count.areaText} area, ${count.pathText} on a path)`],
      ['Images', count.image],
      ['Live Objects', count.live],
      ['With Effects', count.effects],
      ['Anchor Points', st.anchors],
      ['Colors Used', colors.size],
      ['Hidden', count.hidden],
      ['Locked', count.locked],
    ].filter(([, v]) => !selectionOnly || v !== 0),
  });
  const styles = graphicStylesOf(doc);
  const usedStyles = styles.filter((s) => nodes.some((n) => n.type !== 'layer' && n.type !== 'root' && (n.type === 'path' || n.type === 'compound' || n.type === 'text' || n.type === 'group') && matchesStyle(doc, n, s.style)));
  sections.push({ id: 'styles', title: 'Graphic Styles', items: (selectionOnly ? usedStyles : styles).map((s) => `${s.name}${!selectionOnly && usedStyles.includes(s) ? ' (in use)' : ''}`) });
  const swatches = swatchesOf(doc);
  const usedSwatches = swatches.filter((s) => swatchRefs.has(s.id) || (s.paint?.type === 'solid' && colors.has(s.paint.color.toLowerCase())));
  sections.push({ id: 'swatches', title: 'Swatches', items: (selectionOnly ? usedSwatches : swatches).map((s) => `${s.name}${s.global ? ' (global)' : ''}${s.mode === 'cmyk' ? ' (CMYK)' : ''}`) });
  const fontDoc = { walk: (fn) => nodes.forEach((n) => fn(n)) };
  sections.push({ id: 'fonts', title: 'Fonts', items: fontsUsed(fontDoc).map((f) => `${f.family} ${f.weight === 700 ? 'Bold' : f.weight === 400 ? 'Regular' : f.weight}${f.style === 'italic' ? ' Italic' : ''} (${plural(f.count, 'use')})`) });
  const imgs = nodes.filter((n) => n.type === 'image').map((n) => ({ n, i: imageInfo(doc, n) }));
  const line = ({ i }) => `${i.name}: ${i.format}, ${i.pixels.w} x ${i.pixels.h} px, ${Math.round(i.ppi.x)} ppi${i.location ? `, ${i.location}` : ''}`;
  sections.push({ id: 'linked', title: 'Linked Images', items: imgs.filter((x) => x.i.linked).map(line) });
  sections.push({ id: 'embedded', title: 'Embedded Images', items: imgs.filter((x) => !x.i.linked).map(line) });
  return sections;
}

export function reportText(sections) {
  return sections
    .map((s) => [`${s.title}:`, ...(s.rows ? s.rows.map(([k, v]) => `  ${k}: ${v}`) : s.items.length ? s.items.map((x) => `  ${x}`) : ['  None'])].join('\n'))
    .join('\n\n');
}

export class DocumentInfoPanel extends Panel {
  static id = 'documentInfo';
  static title = 'Document Info';
  static icon = 'panel-document-info';
  static placement = 'strip';

  build() {
    this.category = this.app.prefs.get('docInfoCategory') || 'all';
    this.selectionOnly = false;
    this.cat = h(
      'select#di-cat.select',
      { 'aria-label': 'Show', onchange: () => {
        this.category = this.cat.value;
        this.app.prefs.set('docInfoCategory', this.category);
        this.key = null;
        this.update();
      } },
      CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === this.category }, c.label)),
    );
    this.selOnly = h('input#di-sel', { type: 'checkbox', onchange: () => {
      this.selectionOnly = this.selOnly.checked;
      this.key = null;
      this.update();
    } });
    this.body = h('div.di-body', { 'aria-live': 'off' });
    this.empty = h('p.panel-empty', 'No document open.');
    this.head = h('div.di-head', this.cat, h('div.check-row.di-selonly', this.selOnly, h('label', { for: 'di-sel' }, 'Selection Only')), iconButton('download', 'Save Report as Text', () => this.save(), { className: 'small' }));
    this.el.append(this.empty, this.head, this.body);
  }

  sections() {
    const ed = this.app.editor;
    const all = documentReport(ed, { selectionOnly: this.selectionOnly && ed.selection.size > 0 });
    return this.category === 'all' ? all : all.filter((s) => s.id === this.category);
  }

  update() {
    const ed = this.app.editor;
    this.empty.hidden = Boolean(ed);
    this.head.hidden = this.body.hidden = !ed;
    if (!ed) return;
    const key = `${ed.doc.nodes.version}|${this.selectionOnly ? ed.selection.version : ''}|${this.category}|${ed.doc.id ?? ''}`;
    if (this.key === key && this.keyDoc === ed.doc) return;
    this.key = key;
    this.keyDoc = ed.doc;
    this.body.replaceChildren(
      ...this.sections().map((s) =>
        h(
          'section.di-sec',
          h('h3.section-title', s.title),
          s.rows ? h('dl.files-info-list', s.rows.flatMap(([k, v]) => [h('dt', k), h('dd', String(v))])) : s.items.length ? h('ul.di-items', s.items.map((x) => h('li', x))) : h('p.muted.di-none', 'None'),
        ),
      ),
    );
  }

  async save() {
    const ed = this.app.editor;
    if (!ed) return;
    const text = `${reportText(this.sections())}\n`;
    const { downloadBlob } = await import('../io/deliver.js');
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${ed.name.replace(/\.[^.]+$/, '')} Info.txt`);
  }
}
