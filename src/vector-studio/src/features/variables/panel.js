/**
 * Variables panel: data-driven artwork. Make a selected text object's
 * content dynamic, or any object's visibility, capture the current values
 * as data sets, step through data sets to update the artwork, import and
 * export data sets as CSV, and export every data set as files at once.
 */
import { h } from '../../lib/dom.js';
import { Panel, emptyState } from '../../ui/panels/panel.js';
import { iconButton } from '../../ui/widgets.js';
import { openMenu } from '../../ui/menubar.js';
import { defaultLabel } from '../../model/nodes.js';
import { replaceIn } from '../type/type-ops.js';
import { downloadBlob, deliverFiles, safeFileName } from '../io/deliver.js';
import {
  VARIABLE_TYPES,
  variablesOf,
  dataSetsOf,
  boundTo,
  addVariable,
  removeVariables,
  bind,
  captureDataSet,
  updateDataSet,
  applyDataSet,
  cleanName,
  toCSV,
  importCSV,
} from './model.js';

const setText = (doc, node, text) => replaceIn(doc, node, 0, node.text.length, text, 'Apply Data Set');

export class VariablesPanel extends Panel {
  static id = 'variables';
  static title = 'Variables';
  static icon = 'panel-variables';

  build() {
    this.selected = null;
    this.dsSelect = h('select.var-ds', { 'aria-label': 'Data set', onchange: () => this.apply(this.dsSelect.value) });
    this.prevBtn = iconButton('chevron-left', 'Previous Data Set', () => this.step(-1), { className: 'small' });
    this.nextBtn = iconButton('chevron-right', 'Next Data Set', () => this.step(1), { className: 'small' });
    this.captureBtn = iconButton('camera', 'Capture Data Set', () => this.capture(), { className: 'small' });
    this.list = h('div.var-list', { role: 'listbox', 'aria-label': 'Variables' });
    this.menuBtn = iconButton('ellipsis', 'Variables options', (e) => this.openMenu(e.currentTarget), { className: 'small' });
    this.textBtn = iconButton('type', 'Make Text Dynamic', () => this.makeDynamic('text'), { className: 'small' });
    this.visBtn = iconButton('eye', 'Make Visibility Dynamic', () => this.makeDynamic('visibility'), { className: 'small' });
    this.unbindBtn = iconButton('unlink', 'Unbind Variable', () => this.unbind(), { className: 'small' });
    this.newBtn = iconButton('plus', 'New Variable', () => this.newVariable(), { className: 'small' });
    this.delBtn = iconButton('trash', 'Delete Variable', () => this.deleteVariable(), { className: 'small' });
    this.el.append(
      h('div.var-top', h('label.var-ds-label', 'Data Set', this.dsSelect), this.prevBtn, this.nextBtn, this.captureBtn, this.menuBtn),
      h('div.var-head', { 'aria-hidden': 'true' }, h('span', 'Variable'), h('span', 'Type'), h('span', 'Bound to')),
      this.list,
      h('div.var-footer', this.textBtn, this.visBtn, this.unbindBtn, h('span.var-spacer'), this.newBtn, this.delBtn),
    );
  }

  get doc() {
    return this.app.editor?.doc || null;
  }

  update() {
    const doc = this.doc;
    this.el.classList.toggle('disabled', !doc);
    if (!doc) {
      this.list.replaceChildren(emptyState('Open a document to use variables.'));
      return;
    }
    const key = [doc.root.variables, doc.root.dataSets, doc.root.dataSet, this.app.editor.selection.size, doc.nodes.version];
    if (this.key && key.every((k, i) => k === this.key[i])) return;
    this.key = key;
    this.render();
  }

  render() {
    const doc = this.doc;
    const sets = dataSetsOf(doc);
    this.dsSelect.replaceChildren(...(sets.length ? sets.map((ds) => h('option', { value: ds.id, selected: ds.id === doc.root.dataSet }, ds.name)) : [h('option', { value: '' }, 'No data sets')]));
    this.dsSelect.disabled = !sets.length;
    this.prevBtn.disabled = this.nextBtn.disabled = sets.length < 2;
    this.captureBtn.disabled = !variablesOf(doc).length;
    const vars = variablesOf(doc);
    if (!vars.some((v) => v.id === this.selected)) this.selected = null;
    if (!vars.length) {
      this.list.replaceChildren(h('p.panel-empty', 'Select a text object and choose Make Text Dynamic, or any object and Make Visibility Dynamic.'));
    } else {
      this.list.replaceChildren(
        ...vars.map((v) => {
          const bound = boundTo(doc, v.id);
          return h(
            `div.var-row${v.id === this.selected ? '.selected' : ''}`,
            {
              role: 'option',
              tabindex: '0',
              'aria-selected': String(v.id === this.selected),
              onclick: () => this.pick(v.id),
              ondblclick: () => this.renameVariable(v),
              onkeydown: (e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  this.pick(v.id);
                } else if (e.key === 'F2') this.renameVariable(v);
                else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteVariable(v.id);
              },
            },
            h('span.var-name', v.name),
            h('span.var-type', VARIABLE_TYPES[v.type]),
            h('span.var-bound', bound.length ? (bound.length === 1 ? defaultLabel(bound[0].node) : `${bound.length} objects`) : '—'),
          );
        }),
      );
    }
    const sel = this.app.editor.selectedNodes();
    this.textBtn.disabled = !(sel.length === 1 && sel[0].type === 'text');
    this.visBtn.disabled = sel.length !== 1;
    this.unbindBtn.disabled = !sel.some((n) => n.bindings);
    this.delBtn.disabled = !this.selected;
  }

  /** Select a variable; its bound objects are selected on the canvas. */
  pick(id) {
    this.selected = id;
    const ids = boundTo(this.doc, id).map((b) => b.node.id);
    if (ids.length) this.app.editor.select(ids);
    this.render();
  }

  makeDynamic(slot) {
    const ed = this.app.editor;
    const n = ed.selectedNodes()[0];
    if (!n) return;
    const doc = ed.doc;
    doc.transact(slot === 'text' ? 'Make Text Dynamic' : 'Make Visibility Dynamic', () => {
      // Reuse the selected variable when it has the right type and nothing bound yet; otherwise make one.
      let v = variablesOf(doc).find((x) => x.id === this.selected && x.type === slot && !boundTo(doc, x.id).length);
      if (!v) v = addVariable(doc, slot, slot === 'visibility' ? null : cleanName(n.name || ''));
      bind(doc, n.id, slot, v.id);
      this.selected = v.id;
    });
  }

  unbind() {
    const ed = this.app.editor;
    ed.doc.transact('Unbind Variable', () => {
      for (const n of ed.selectedNodes()) if (n.bindings) ed.doc.update(n.id, { bindings: undefined });
    });
  }

  async newVariable() {
    const v = await this.app.dialogs.form({
      title: 'New Variable',
      fields: [
        { key: 'name', label: 'Name', type: 'text', value: '' },
        { key: 'type', label: 'Type', type: 'select', value: 'text', options: Object.entries(VARIABLE_TYPES).map(([value, label]) => ({ value, label })) },
      ],
    });
    if (!v) return;
    this.doc.transact('New Variable', () => {
      this.selected = addVariable(this.doc, v.type, v.name || null).id;
    });
  }

  async renameVariable(v) {
    const r = await this.app.dialogs.form({ title: 'Variable Options', fields: [{ key: 'name', label: 'Name', type: 'text', value: v.name }] });
    if (!r?.name) return;
    const name = cleanName(r.name);
    if (variablesOf(this.doc).some((x) => x.name === name && x.id !== v.id)) {
      this.app.notify(`A variable named ${name} already exists.`, { error: true });
      return;
    }
    this.doc.transact('Rename Variable', () => this.doc.updateRoot({ variables: variablesOf(this.doc).map((x) => (x.id === v.id ? { ...x, name } : x)) }));
  }

  async deleteVariable(id = this.selected) {
    if (!id) return;
    const v = variablesOf(this.doc).find((x) => x.id === id);
    const bound = boundTo(this.doc, id).length;
    if (bound) {
      const ok = await this.app.dialogs.confirm({ title: 'Delete Variable', message: `Delete ${v.name}? ${bound === 1 ? 'Its object stays' : `Its ${bound} objects stay`} as they are now.`, okLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    this.doc.transact('Delete Variable', () => removeVariables(this.doc, [id]));
  }

  capture() {
    this.doc.transact('Capture Data Set', () => captureDataSet(this.doc));
  }

  apply(id) {
    if (!id) return;
    this.doc.transact('Apply Data Set', () => applyDataSet(this.doc, id, setText));
  }

  step(d) {
    const sets = dataSetsOf(this.doc);
    if (sets.length < 2) return;
    const i = sets.findIndex((s) => s.id === this.doc.root.dataSet);
    this.apply(sets[(i + d + sets.length) % sets.length].id);
  }

  openMenu(anchor) {
    const doc = this.doc;
    const sets = dataSetsOf(doc);
    const cur = doc?.root.dataSet;
    const r = anchor.getBoundingClientRect();
    openMenu(
      this.app,
      [
        { type: 'cmd', label: 'Capture Data Set', enabled: Boolean(doc && variablesOf(doc).length), run: () => this.capture() },
        { type: 'cmd', label: 'Update Data Set', enabled: Boolean(cur), run: () => doc.transact('Update Data Set', () => updateDataSet(doc, cur)) },
        { type: 'cmd', label: 'Rename Data Set…', enabled: Boolean(cur), run: () => this.renameDataSet() },
        { type: 'cmd', label: 'Delete Data Set', enabled: Boolean(cur), run: () => doc.transact('Delete Data Set', () => doc.updateRoot({ dataSets: sets.filter((s) => s.id !== cur), dataSet: null })) },
        { type: 'sep' },
        { type: 'cmd', label: 'Import Data Sets (CSV)…', enabled: Boolean(doc), run: () => this.importData() },
        { type: 'cmd', label: 'Export Data Sets (CSV)…', enabled: sets.length > 0, run: () => downloadBlob(new Blob([toCSV(doc)], { type: 'text/csv' }), `${safeFileName(this.app.editor.name || 'Variables')}.csv`) },
        { type: 'sep' },
        { type: 'cmd', label: 'Export Each Data Set…', enabled: sets.length > 0, run: () => this.exportEach() },
        { type: 'sep' },
        { type: 'cmd', label: 'Select Bound Objects', enabled: Boolean(this.selected), run: () => this.pick(this.selected) },
      ],
      { x: r.left, y: r.bottom, anchor, label: 'Variables options' },
    );
  }

  async renameDataSet() {
    const doc = this.doc;
    const cur = dataSetsOf(doc).find((s) => s.id === doc.root.dataSet);
    const v = await this.app.dialogs.form({ title: 'Rename Data Set', fields: [{ key: 'name', label: 'Name', type: 'text', value: cur.name }] });
    if (v?.name?.trim()) doc.transact('Rename Data Set', () => doc.updateRoot({ dataSets: dataSetsOf(doc).map((s) => (s.id === cur.id ? { ...s, name: v.name.trim() } : s)) }));
  }

  importData() {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        let n = 0;
        this.doc.transact('Import Data Sets', () => {
          n = importCSV(this.doc, text);
        });
        const first = dataSetsOf(this.doc)[dataSetsOf(this.doc).length - n];
        if (first) this.apply(first.id);
        this.app.notify(`Imported ${n} data set${n === 1 ? '' : 's'}.`, { polite: true });
      } catch (err) {
        this.app.notify(err?.message || 'Could not import the data sets.', { error: true });
      }
    });
    document.body.append(input);
    input.click();
  }

  /** Apply each data set in turn and export the active artboard, then restore. */
  async exportEach() {
    const app = this.app;
    const ed = app.editor;
    const v = await app.dialogs.form({
      title: 'Export Each Data Set',
      fields: [
        { key: 'format', label: 'Format', type: 'select', value: 'png', options: [{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG' }, { value: 'pdf', label: 'PDF' }] },
        { key: 'zip', label: 'Put the files in one ZIP', type: 'checkbox', value: true },
      ],
    });
    if (!v) return;
    const doc = ed.doc;
    const original = doc.root.dataSet;
    const files = [];
    try {
      for (const ds of dataSetsOf(doc)) {
        doc.transact('Apply Data Set', () => applyDataSet(doc, ds.id, setText));
        const base = safeFileName(ds.name, 'Data Set');
        if (v.format === 'svg') files.push({ name: `${base}.svg`, blob: new Blob([await app.exporters.svg(ed, {})], { type: 'image/svg+xml' }) });
        else if (v.format === 'pdf') files.push({ name: `${base}.pdf`, blob: new Blob([await app.exporters.pdf(ed, {})], { type: 'application/pdf' }) });
        else files.push({ name: `${base}.png`, blob: await app.exporters.raster(ed, { format: 'png', scale: 1 }) });
      }
    } catch (err) {
      app.notify(`Export failed: ${err?.message || err}`, { error: true });
    } finally {
      if (original) doc.transact('Apply Data Set', () => applyDataSet(doc, original, setText));
    }
    if (files.length) {
      const msg = await deliverFiles(app, files, { zip: v.zip, zipName: `${safeFileName(ed.name || 'Data Sets')}.zip` });
      if (msg) app.notify(msg, { polite: true });
    }
  }
}
