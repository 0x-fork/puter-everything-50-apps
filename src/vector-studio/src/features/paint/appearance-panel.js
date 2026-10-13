/**
 * Appearance panel (Shift+F6) and Graphic Styles panel.
 *
 * Appearance lists the selected object's attributes like a stack: Stroke
 * (swatch and weight), Fill, effects (eye toggle, click to edit, delete,
 * drag or Alt+Up/Down to reorder) and Opacity. Objects have a single fill and
 * stroke, so Add New Stroke / Add New Fill turn them on (and bring them to
 * the front) rather than stacking extra ones.
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { iconButton, paintSwatch, numberField } from '../../ui/widgets.js';
import { icon } from '../../ui/icons.js';
import { openPaintPopover } from '../../ui/popover.js';
import { applyStyle, commonStyle, paintTargets } from '../../ops/paint-ops.js';
import { selectionKind, BLEND_LABELS } from '../../ui/panels/properties.js';
import { EFFECTS, effectLabel } from './effects-model.js';
import { effectDialog, effectTargets } from './effects-ui.js';
import { drawThumbnail, standaloneDoc } from './thumbs.js';
import { graphicStylesOf, setGraphicStyles, styleOfNode, applyGraphicStyle, newStyleId } from './graphic-styles.js';
import { createPath } from '../../model/nodes.js';
import { rectangle } from '../../model/shapes.js';
import { gestureKey } from './ui-common.js';

export class AppearancePanel extends Panel {
  static id = 'appearance';
  static title = 'Appearance';
  static icon = 'sparkles';
  static placement = 'strip';
  static shortcut = 'Shift+F6';

  build() {
    const app = this.app;
    this.selectedRow = null;
    this.thumb = h('canvas.ap-thumb', { width: 32, height: 32, 'aria-hidden': 'true' });
    this.kind = h('span.ap-kind');
    this.list = h('div.ap-list', { role: 'list', 'aria-label': 'Appearance attributes' });
    this.strokeW = numberField({
      label: 'Stroke weight',
      ariaLabel: 'Stroke weight',
      value: 1,
      min: 0,
      width: '64px',
      onCommit: (v, o) => {
        if (!o?.live) this.wkey = gestureKey('ap-weight');
        applyStyle(app.editor, { strokeWidth: v }, 'Stroke Weight', this.wkey);
      },
    });
    this.strokeW.el.querySelector('label').textContent = '';
    const btn = (ic, label, fn) => iconButton(ic, label, fn, { className: 'small' });
    this.footer = h(
      'div.ap-footer',
      btn('add-stroke', 'Add New Stroke', () => this.addPaint('stroke')),
      btn('add-fill', 'Add New Fill', () => this.addPaint('fill')),
      btn('fx', 'Add New Effect', (e) => this.effectMenu(e.currentTarget)),
      h('span.sw-spacer'),
      btn('ban', 'Clear Appearance', () => this.clearAppearance()),
      btn('reduce-basic', 'Reduce to Basic Appearance', () => this.reduceBasic()),
      (this.dupBtn = btn('copy', 'Duplicate Selected Item', () => this.duplicateItem())),
      (this.delBtn = btn('trash', 'Delete Selected Item', () => this.deleteItem())),
    );
    this.el.append(h('div.ap-head', this.thumb, this.kind), this.list, this.footer);
  }

  targets() {
    return this.app.editor ? effectTargets(this.app.editor) : [];
  }

  /** Effects shown in the list: the single object's, or the shared list when all match. */
  sharedEffects() {
    const t = this.targets();
    if (!t.length) return { effects: this.app.editor?.style.effects || [], mixed: false };
    const first = JSON.stringify(t[0].effects || []);
    if (t.every((n) => JSON.stringify(n.effects || []) === first)) return { effects: t[0].effects || [], mixed: false };
    return { effects: [], mixed: true };
  }

  setEffects(fn, label) {
    const ed = this.app.editor;
    const t = this.targets();
    if (!ed) return;
    if (!t.length) {
      ed.setStyle({ effects: fn(ed.style.effects || []) });
      return;
    }
    ed.doc.transact(label, () => {
      for (const n of t) ed.doc.update(n.id, { effects: fn(n.effects || []) });
    });
  }

  addPaint(key) {
    const ed = this.app.editor;
    if (!ed) return;
    const cur = commonStyle(ed, key);
    if (!cur) {
      const patch = { [key]: { type: 'solid', color: key === 'fill' ? '#ffffff' : '#000000' } };
      if (key === 'stroke' && !(commonStyle(ed, 'strokeWidth') > 0)) patch.strokeWidth = 1;
      applyStyle(ed, patch, key === 'fill' ? 'Add New Fill' : 'Add New Stroke');
    }
    ed.focusPaint = key;
    ed.emit('style');
    this.selectedRow = key;
  }

  effectMenu(anchor) {
    // The effects feature offers the whole Effect menu here when installed.
    if (this.app.showEffectMenu) return this.app.showEffectMenu(anchor);
    const items = Object.entries(EFFECTS).map(([type, def]) => ({
      label: `${def.label}...`,
      enabled: this.targets().length > 0,
      run: () => effectDialog(this.app, type),
    }));
    this.app.showMenuAt(anchor, items, 'Add New Effect');
  }

  clearAppearance() {
    const ed = this.app.editor;
    if (!ed) return;
    const t = this.targets();
    applyStyle(ed, { fill: null, stroke: null }, 'Clear Appearance');
    if (t.length) {
      ed.doc.transact('Clear Appearance', () => {
        for (const n of t) ed.doc.update(n.id, { effects: [], opacity: 1, blendMode: 'normal' });
      });
    } else ed.setStyle({ effects: [], opacity: 1, blendMode: 'normal' });
  }

  reduceBasic() {
    this.setEffects(() => [], 'Reduce to Basic Appearance');
  }

  duplicateItem() {
    const r = this.selectedRow;
    if (typeof r !== 'number') return;
    this.setEffects((list) => (list[r] ? [...list.slice(0, r + 1), { ...list[r] }, ...list.slice(r + 1)] : list), 'Duplicate Effect');
    this.selectedRow = r + 1;
  }

  deleteItem() {
    const r = this.selectedRow;
    const ed = this.app.editor;
    if (!ed || r == null) return;
    if (typeof r === 'number') {
      this.setEffects((list) => list.filter((_, i) => i !== r), 'Delete Effect');
      this.selectedRow = null;
    } else if (r === 'fill' || r === 'stroke') {
      applyStyle(ed, { [r]: null }, r === 'fill' ? 'Delete Fill' : 'Delete Stroke');
    }
  }

  editEffect(i) {
    const t = this.targets();
    const ed = this.app.editor;
    if (!ed) return;
    const fx = (t[0]?.effects || [])[i];
    if (!fx) return;
    if (t.length === 1) effectDialog(this.app, fx.type, { edit: { id: t[0].id, index: i } });
    else effectDialog(this.app, fx.type, { params: fx });
  }

  /** Effect rows reorder by dragging (Alt+Up/Down from the keyboard). */
  draggable(r, i, count) {
    if (count < 2) return;
    r.draggable = true;
    const clear = () => this.list.querySelectorAll('.fx-drop-before, .fx-drop-after').forEach((el) => el.classList.remove('fx-drop-before', 'fx-drop-after'));
    r.addEventListener('dragstart', (e) => {
      this.dragFrom = i;
      e.dataTransfer?.setData('text/plain', String(i));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    r.addEventListener('dragover', (e) => {
      if (this.dragFrom == null) return;
      e.preventDefault();
      const after = e.offsetY > r.offsetHeight / 2;
      clear();
      r.classList.add(after ? 'fx-drop-after' : 'fx-drop-before');
    });
    r.addEventListener('dragleave', clear);
    r.addEventListener('dragend', () => {
      this.dragFrom = null;
      clear();
    });
    r.addEventListener('drop', (e) => {
      const from = this.dragFrom;
      this.dragFrom = null;
      clear();
      if (from == null) return;
      e.preventDefault();
      let to = i + (e.offsetY > r.offsetHeight / 2 ? 1 : 0);
      if (from < to) to--;
      if (to === from) return;
      this.setEffects((list) => {
        const out = list.slice();
        const [fx] = out.splice(from, 1);
        out.splice(to, 0, fx);
        return out;
      }, 'Reorder Effects');
      this.selectedRow = to;
    });
  }

  row({ id, label, swatch, extra, eye, onEye, onActivate, onDelete, hiddenFx = false }) {
    const selected = this.selectedRow === id;
    const r = h('div.ap-row', { role: 'listitem', tabindex: '0', 'aria-label': label.textContent || label, 'aria-current': selected ? 'true' : null });
    r.classList.toggle('selected', selected);
    r.classList.toggle('fx-hidden', hiddenFx);
    const eyeBtn = eye != null ? iconButton(eye ? 'eye' : 'eye-off', eye ? 'Hide effect' : 'Show effect', (e) => {
      e.stopPropagation();
      onEye();
    }, { className: 'small ap-eye' }) : h('span.ap-eye-pad');
    r.append(eyeBtn, swatch || h('span.ap-sw-pad'), h('span.ap-label', label));
    if (extra) r.append(extra);
    if (onDelete) r.append(iconButton('x', `Delete ${label.textContent || label}`, (e) => {
      e.stopPropagation();
      onDelete();
    }, { className: 'small ap-del' }));
    r.addEventListener('click', () => {
      this.selectedRow = id;
      this.update(true);
    });
    r.addEventListener('keydown', (e) => {
      const rows = [...this.list.querySelectorAll('.ap-row')];
      const i = rows.indexOf(r);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && typeof id === 'number') {
        e.preventDefault();
        e.stopPropagation();
        const j = id + (e.key === 'ArrowDown' ? 1 : -1);
        this.setEffects((list) => {
          if (j < 0 || j >= list.length) return list;
          const out = list.slice();
          [out[id], out[j]] = [out[j], out[id]];
          return out;
        }, 'Reorder Effects');
        this.selectedRow = j;
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        rows[(i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onActivate?.(r);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && onDelete) {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
      }
    });
    return r;
  }

  update(force = false) {
    const ed = this.app.editor;
    this.el.classList.toggle('disabled', !ed);
    if (!ed) {
      this.list.replaceChildren();
      return;
    }
    const app = this.app;
    const t = this.targets();
    const leaves = paintTargets(ed);
    const fill = commonStyle(ed, 'fill');
    const stroke = commonStyle(ed, 'stroke');
    const sw = commonStyle(ed, 'strokeWidth');
    const { effects, mixed } = this.sharedEffects();
    const op = t.length ? (t.every((n) => (n.opacity ?? 1) === (t[0].opacity ?? 1)) ? t[0].opacity ?? 1 : 'mixed') : ed.style.opacity ?? 1;
    const bm = t.length ? (t.every((n) => (n.blendMode || 'normal') === (t[0].blendMode || 'normal')) ? t[0].blendMode || 'normal' : 'mixed') : ed.style.blendMode || 'normal';
    const key = JSON.stringify([t.map((n) => n.id), fill, stroke, sw, effects, mixed, op, bm, this.selectedRow, ed.focusPaint, leaves.length]);
    if (!force && key === this.renderKey) return;
    this.renderKey = key;
    this.kind.textContent = t.length ? selectionKind(ed) : 'No Selection';
    const tctx = this.thumb.getContext('2d');
    if (tctx) {
      tctx.clearRect(0, 0, 32, 32);
      if (t.length === 1) drawThumbnail(tctx, ed.doc, t[0], 32, 2);
    }
    const rows = [];
    const hasGroup = t.some((n) => n.type === 'group');
    if (hasGroup) rows.push(this.row({ id: 'contents', label: 'Contents', onActivate: () => {} }));
    const paintRows = leaves.length > 0 || !t.length;
    if (paintRows && !hasGroup) {
      const strokeSw = paintSwatch(stroke === 'mixed' ? null : stroke, { mixed: stroke === 'mixed' });
      const strokeBtn = h('button.swatch-btn.small', { type: 'button', 'aria-label': 'Stroke color', 'aria-haspopup': 'dialog', onclick: (e) => {
        e.stopPropagation();
        openPaintPopover(app, e.currentTarget, 'stroke');
      } }, strokeSw);
      this.strokeW.setUnit(ed.doc.root.units);
      this.strokeW.set(sw === 'mixed' ? 'mixed' : sw ?? 0);
      const sLabel = h('button.link-label', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        app.openPanel('stroke');
      } }, 'Stroke');
      rows.push(this.row({ id: 'stroke', label: sLabel, swatch: strokeBtn, extra: stroke ? this.strokeW.el : null, onActivate: () => strokeBtn.click(), onDelete: stroke ? () => applyStyle(ed, { stroke: null }, 'Delete Stroke') : null }));
      const fillSw = paintSwatch(fill === 'mixed' ? null : fill, { mixed: fill === 'mixed' });
      const fillBtn = h('button.swatch-btn.small', { type: 'button', 'aria-label': 'Fill color', 'aria-haspopup': 'dialog', onclick: (e) => {
        e.stopPropagation();
        openPaintPopover(app, e.currentTarget, 'fill');
      } }, fillSw);
      rows.push(this.row({ id: 'fill', label: 'Fill', swatch: fillBtn, onActivate: () => fillBtn.click(), onDelete: fill ? () => applyStyle(ed, { fill: null }, 'Delete Fill') : null }));
    }
    if (mixed) rows.push(h('p.ap-mixed.muted', 'Mixed Appearances'));
    effects.forEach((fx, i) => {
      const lbl = h('button.link-label', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        this.selectedRow = i;
        this.editEffect(i);
      } }, effectLabel(fx));
      rows.push(
        this.row({
          id: i,
          label: lbl,
          swatch: h('span.ap-fx', { 'aria-hidden': 'true' }, icon('fx', 14)),
          eye: !fx.hidden,
          hiddenFx: Boolean(fx.hidden),
          onEye: () => this.setEffects((list) => list.map((e, j) => (j === i ? toggleHidden(e) : e)), fx.hidden ? 'Show Effect' : 'Hide Effect'),
          onActivate: () => this.editEffect(i),
          onDelete: () => this.setEffects((list) => list.filter((_, j) => j !== i), 'Delete Effect'),
        }),
      );
      this.draggable(rows[rows.length - 1], i, effects.length);
    });
    const opText = `Opacity: ${op === 'mixed' ? 'Mixed' : op === 1 ? 'Default' : `${Math.round(op * 100)}%`}${bm !== 'normal' && bm !== 'mixed' ? ` ${BLEND_LABELS[bm] || bm}` : ''}`;
    rows.push(this.row({ id: 'opacity', label: h('button.link-label', { type: 'button', onclick: (e) => {
      e.stopPropagation();
      app.openPanel('transparency');
    } }, opText), onActivate: () => app.openPanel('transparency') }));
    this.list.replaceChildren(...rows);
    this.dupBtn.disabled = typeof this.selectedRow !== 'number';
    this.delBtn.disabled = this.selectedRow == null || this.selectedRow === 'opacity' || this.selectedRow === 'contents';
  }
}

function toggleHidden(e) {
  const out = { ...e };
  if (out.hidden) delete out.hidden;
  else out.hidden = true;
  return out;
}

// ---- Graphic Styles ----

const previewShape = (() => {
  let node = null;
  return (style) => {
    if (!node) node = createPath(rectangle(4, 4, 40, 40, 0), true);
    return { ...node, ...style, id: 'gs-preview' };
  };
})();

export class GraphicStylesPanel extends Panel {
  static id = 'graphicStyles';
  static title = 'Graphic Styles';
  static icon = 'graphic-styles';
  static placement = 'strip';
  static shortcut = 'Shift+F5';

  build() {
    this.selected = null;
    this.grid = h('div.gst-grid', { role: 'listbox', 'aria-label': 'Graphic styles' });
    this.grid.addEventListener('keydown', (e) => {
      const items = [...this.grid.children];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = 5;
      let j = null;
      if (e.key === 'ArrowRight') j = i + 1;
      else if (e.key === 'ArrowLeft') j = i - 1;
      else if (e.key === 'ArrowDown') j = i + cols;
      else if (e.key === 'ArrowUp') j = i - cols;
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSelected();
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      const t = items[Math.max(0, Math.min(items.length - 1, j))];
      items.forEach((x) => (x.tabIndex = -1));
      t.tabIndex = 0;
      t.focus();
    });
    this.footer = h(
      'div.ap-footer',
      h('span.sw-spacer'),
      iconButton('plus', 'New Graphic Style', () => this.newStyle(), { className: 'small' }),
      (this.delBtn = iconButton('trash', 'Delete Graphic Style', () => this.deleteSelected(), { className: 'small' })),
    );
    this.el.append(this.grid, this.footer);
  }

  update() {
    const ed = this.app.editor;
    this.el.classList.toggle('disabled', !ed);
    if (!ed) {
      this.grid.replaceChildren();
      return;
    }
    const list = graphicStylesOf(ed.doc);
    if (list === this.lastList && this.selected === this.lastSelected) return;
    this.lastList = list;
    this.lastSelected = this.selected;
    this.grid.replaceChildren(
      ...list.map((gs, i) => {
        const c = h('canvas', { width: 48, height: 48, 'aria-hidden': 'true' });
        const node = previewShape(gs.style);
        const ctx = c.getContext('2d');
        if (ctx) drawThumbnail(ctx, standaloneDoc([node]), node, 48, 6);
        const b = h('button.gst-item', {
          type: 'button',
          role: 'option',
          tabindex: i === 0 ? '0' : '-1',
          'aria-selected': String(gs.id === this.selected),
          'aria-label': gs.name,
          'data-tip': gs.name,
          onclick: () => {
            this.selected = gs.id;
            applyGraphicStyle(this.app.editor, gs.style);
            this.update();
          },
          ondblclick: () => this.rename(gs),
        }, c);
        return b;
      }),
    );
    this.delBtn.disabled = !this.selected;
  }

  async newStyle() {
    const ed = this.app.editor;
    if (!ed) return;
    const top = ed.topSelection().map((id) => ed.doc.get(id)).filter(Boolean);
    const style = top.length ? styleOfNode(ed.doc, top[0]) : structuredClone(ed.style);
    const list = graphicStylesOf(ed.doc);
    const res = await this.app.dialogs.form({ title: 'Graphic Style Options', fields: [{ key: 'name', label: 'Style Name', type: 'text', value: `Graphic Style ${list.length + 1}` }] });
    if (!res) return;
    const gs = { id: newStyleId(), name: res.name.trim() || `Graphic Style ${list.length + 1}`, style };
    ed.doc.transact('New Graphic Style', () => setGraphicStyles(ed.doc, [...list, gs]));
    this.selected = gs.id;
  }

  async rename(gs) {
    const ed = this.app.editor;
    const res = await this.app.dialogs.form({ title: 'Graphic Style Options', fields: [{ key: 'name', label: 'Style Name', type: 'text', value: gs.name }] });
    if (!res || !res.name.trim()) return;
    ed.doc.transact('Rename Graphic Style', () => setGraphicStyles(ed.doc, graphicStylesOf(ed.doc).map((x) => (x.id === gs.id ? { ...x, name: res.name.trim() } : x))));
  }

  async deleteSelected() {
    const ed = this.app.editor;
    if (!ed || !this.selected) return;
    const ok = await this.app.dialogs.confirm({ title: 'Delete Graphic Style', message: 'Delete the graphic style selection?', okLabel: 'Delete', danger: true });
    if (!ok) return;
    const id = this.selected;
    ed.doc.transact('Delete Graphic Style', () => setGraphicStyles(ed.doc, graphicStylesOf(ed.doc).filter((x) => x.id !== id)));
    this.selected = null;
  }
}
