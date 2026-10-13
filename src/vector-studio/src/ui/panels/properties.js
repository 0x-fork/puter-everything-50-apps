/**
 * Properties panel: contextual controls for the current selection, or the
 * document when nothing is selected. Sections: Transform, shape properties
 * (live rectangles, ellipses, polygons, stars), Appearance (fill, stroke,
 * opacity), Align, and Quick Actions. Feature modules add sections through
 * `PropertiesPanel.extraSections` (e.g. Character for text, Pathfinder).
 */
import { h } from '../../lib/dom.js';
import { Panel } from './panel.js';
import { createTransformSection } from './transform-section.js';
import { numberField, paintSwatch, updatePaintSwatch, iconButton, selectField } from '../widgets.js';
import { icon } from '../icons.js';
import { commonStyle, applyStyle } from '../../ops/paint-ops.js';
import { openPaintPopover } from '../popover.js';
import { shapeAnchors } from '../../model/shapes.js';
import { defaultLabel } from '../../model/nodes.js';
import { UNITS } from '../../lib/units.js';
import { BLEND_MODES } from '../../render/draw.js';
import { liveDef } from '../../model/live.js';

export const BLEND_LABELS = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

/** Describe the selection like the panel header: "Path", "Group", "Mixed Objects". */
export function selectionKind(editor) {
  const nodes = editor.selectedNodes();
  if (!nodes.length) return 'No Selection';
  const kinds = new Set(nodes.map((n) => kindName(n)));
  if (kinds.size === 1) return [...kinds][0];
  return 'Mixed Objects';
}

function kindName(n) {
  if (n.type === 'instance') return 'Symbol Instance';
  // Live artwork names itself (Mesh, Graph, Flare, ...).
  const live = liveDef(n);
  const label = live?.label && (typeof live.label === 'function' ? live.label(n) : live.label);
  if (label) return label.replace(/^<|>$/g, '');
  if (n.type === 'path') {
    const k = n.shape?.kind;
    return k === 'rect' ? 'Rectangle' : k === 'ellipse' ? 'Ellipse' : k === 'polygon' ? 'Polygon' : k === 'star' ? 'Star' : k === 'line' ? 'Line' : 'Path';
  }
  return { compound: 'Compound Path', group: n.clip ? 'Clip Group' : 'Group', text: n.kind === 'area' ? 'Area Type' : n.kind === 'path' ? 'Type on a Path' : 'Point Type', image: 'Image', layer: 'Layer', instance: 'Symbol Instance' }[n.type] || n.type;
}

export class PropertiesPanel extends Panel {
  static id = 'properties';
  static title = 'Properties';
  static icon = 'sliders-horizontal';
  static placement = 'dock';
  /**
   * Extra sections: [{ id, title, when(editor) => bool, build(app) => { el, refresh() }, noSelection }]
   * `noSelection: true` lets a section show without a selection (e.g. tool controls).
   */
  static extraSections = [];

  build() {
    const app = this.app;
    this.header = h('p.props-kind');
    this.transform = createTransformSection(app);
    this.sections = {};

    // ---- Document (no selection) ----
    const unitSel = selectField('Units', Object.entries(UNITS).map(([v, u]) => ({ value: v, label: u.label })), 'pt', (v) =>
      app.editor?.doc.transact('Change Units', () => app.editor.doc.updateRoot({ units: v })),
    );
    const boardSel = h('select.select', { 'aria-label': 'Active artboard', onchange: () => app.editor?.setActiveArtboard(Number(boardSel.value)) });
    const toggles = (items) => h('div.toggle-row', items.map(([cmd, ic, label]) => {
      const b = iconButton(ic, label, () => app.commands.run(cmd), { pressed: false });
      b.dataset.cmd = cmd;
      return b;
    }));
    this.docToggles = [
      toggles([
        ['view.rulers', 'ruler', 'Show Rulers'],
        ['view.grid', 'grid', 'Show Grid'],
        ['view.transparencyGrid', 'layout-grid', 'Show Transparency Grid'],
      ]),
      toggles([
        ['view.guides', 'square-dashed', 'Show Guides'],
        ['view.alignmentGuides', 'crosshair', 'Alignment Guides'],
        ['view.lockGuides', 'lock', 'Lock Guides'],
      ]),
      toggles([
        ['view.snapPoint', 'target', 'Snap to Point'],
        ['view.snapGrid', 'magnet', 'Snap to Grid'],
        ['view.snapPixel', 'scaling', 'Snap to Pixel'],
      ]),
    ];
    const incr = numberField({ label: 'Keyboard Increment', value: app.prefs.get('keyboardIncrement'), unit: 'pt', min: 0.001, onCommit: (v) => app.prefs.set('keyboardIncrement', v), width: '72px' });
    const check = (key, label) => {
      const id = `pref-${key}`;
      const input = h('input', { type: 'checkbox', id, checked: Boolean(app.prefs.get(key)), onchange: () => app.prefs.set(key, input.checked) });
      return h('div.check-row', input, h('label', { for: id }, label));
    };
    this.unitSel = unitSel;
    this.boardSel = boardSel;
    this.docSection = h(
      'div.props-doc',
      section('Document', row('Units', unitSel.el), row('Artboard', boardSel), h('button.btn.block', { type: 'button', onclick: () => app.setTool('artboard') }, 'Edit Artboards')),
      section('Rulers & Grids', this.docToggles[0]),
      section('Guides', this.docToggles[1]),
      section('Snap Options', this.docToggles[2]),
      section('Preferences', h('div.pref-incr', h('span', 'Keyboard Increment'), incr.el), check('previewBounds', 'Use Preview Bounds'), check('scaleCorners', 'Scale Corners'), check('scaleStrokes', 'Scale Strokes & Effects')),
      section(
        'Quick Actions',
        h(
          'div.quick-actions',
          h('button.btn', { type: 'button', onclick: () => app.commands.run('file.documentSetup') }, 'Document Setup'),
          h('button.btn', { type: 'button', onclick: () => app.commands.run('edit.preferences') }, 'Preferences'),
        ),
      ),
    );

    // ---- Shape properties ----
    this.shapeBody = h('div.shape-props');
    this.shapeSection = section('Shape', this.shapeBody);

    // ---- Appearance ----
    this.fillSw = paintSwatch(null);
    this.strokeSw = paintSwatch(null, { className: 'stroke-swatch' });
    const fillBtn = h('button.swatch-btn', { type: 'button', 'aria-label': 'Fill color', 'aria-haspopup': 'dialog', onclick: (e) => openPaintPopover(app, e.currentTarget, 'fill') }, this.fillSw);
    const strokeBtn = h('button.swatch-btn', { type: 'button', 'aria-label': 'Stroke color', 'aria-haspopup': 'dialog', onclick: (e) => openPaintPopover(app, e.currentTarget, 'stroke') }, this.strokeSw);
    this.strokeW = numberField({ label: 'Stroke weight', ariaLabel: 'Stroke weight', value: 1, unit: 'pt', min: 0, width: '72px', onCommit: (v, o) => applyStyle(app.editor, { strokeWidth: v }, 'Stroke Weight', o?.live ? 'stroke-weight' : null) });
    this.strokeW.el.querySelector('label').textContent = '';
    this.opacity = numberField({ label: 'Opacity', kind: 'percent', value: 100, min: 0, max: 100, width: '64px', onCommit: (v, o) => applyStyle(app.editor, { opacity: v / 100 }, 'Opacity', o?.live ? 'opacity' : null) });
    this.opacity.el.querySelector('label').textContent = '';
    this.blend = selectField('Blending mode', BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] || m })), 'normal', (v) => applyStyle(app.editor, { blendMode: v }, 'Blending Mode'));
    this.appearance = section(
      'Appearance',
      h('div.app-row', fillBtn, h('span.app-label', 'Fill')),
      h('div.app-row', strokeBtn, h('button.link-label', { type: 'button', onclick: () => app.openPanel('stroke') }, 'Stroke'), this.strokeW.el),
      h('div.app-row', h('span.opacity-icon', { 'aria-hidden': 'true' }, icon('contrast', 16)), h('button.link-label', { type: 'button', onclick: () => app.openPanel('transparency') }, 'Opacity'), this.opacity.el),
      h('div.app-row', h('span.app-label.indent', 'Blending'), this.blend.el),
      h(
        'div.app-row.fx-row',
        h('button.btn.small', { type: 'button', onclick: () => app.openPanel('appearance') }, icon('sparkles', 14), 'Effects'),
        // Choose an effect for the selection (when the effects feature is installed).
        h('button.icon-btn.small', { type: 'button', 'aria-label': 'Add New Effect', 'data-tip': 'Add New Effect', 'aria-haspopup': 'menu', onclick: (e) => (app.showEffectMenu ? app.showEffectMenu(e.currentTarget) : app.openPanel('appearance')) }, icon('fx', 16)),
      ),
    );

    // ---- Align ----
    const alignBtns = [
      ['align.left', 'align-left', 'Horizontal Align Left'],
      ['align.hcenter', 'align-hcenter', 'Horizontal Align Center'],
      ['align.right', 'align-right', 'Horizontal Align Right'],
      ['align.top', 'align-top', 'Vertical Align Top'],
      ['align.vcenter', 'align-vcenter', 'Vertical Align Center'],
      ['align.bottom', 'align-bottom', 'Vertical Align Bottom'],
    ].map(([cmd, ic, label]) => iconButton(ic, label, () => app.commands.run(cmd)));
    const distBtns = [
      ['distribute.hspace', 'distribute-hspace', 'Horizontal Distribute Space'],
      ['distribute.vspace', 'distribute-vspace', 'Vertical Distribute Space'],
      ['distribute.hcenter', 'distribute-hcenter', 'Horizontal Distribute Center'],
      ['distribute.vcenter', 'distribute-vcenter', 'Vertical Distribute Center'],
    ].map(([cmd, ic, label]) => iconButton(ic, label, () => app.commands.run(cmd)));
    this.alignTo = selectField('Align to', [
      { value: 'selection', label: 'Align to Selection' },
      { value: 'artboard', label: 'Align to Artboard' },
    ], 'selection', (v) => (app.alignTo = v));
    this.distBtns = distBtns;
    this.alignSection = section('Align', h('div.icon-row', alignBtns), h('div.icon-row', distBtns, this.alignTo.el));

    // ---- Extra sections from feature modules ----
    this.extra = PropertiesPanel.extraSections.map((def) => {
      const inst = def.build(app);
      const sec = section(def.title, inst.el);
      return { def, inst, sec };
    });

    // ---- Quick actions ----
    this.quick = h('div.quick-actions');
    this.quickSection = section('Quick Actions', this.quick);

    this.empty = h('p.panel-empty', 'Open or create a document to see its properties.');
    this.el.append(this.empty, this.header, this.docSection, section('Transform', this.transform.el), this.shapeSection, this.appearance, ...this.extra.map((e) => e.sec), this.alignSection, this.quickSection);
    this.transformSection = this.transform.el.parentElement;
  }

  update() {
    const app = this.app;
    const ed = app.editor;
    this.empty.hidden = Boolean(ed);
    for (const c of this.el.children) if (c !== this.empty) c.hidden = !ed;
    if (!ed) return;
    const hasSel = ed.selection.size > 0;
    this.header.textContent = selectionKind(ed);
    this.docSection.hidden = hasSel;
    this.transformSection.hidden = !hasSel;
    this.alignSection.hidden = !hasSel;
    this.quickSection.hidden = !hasSel;
    this.appearance.hidden = !hasSel;
    if (!hasSel) {
      this.unitSel.set(ed.doc.root.units);
      const boards = ed.doc.artboards;
      this.boardSel.replaceChildren(...boards.map((a, i) => h('option', { value: i, selected: i === ed.activeArtboard }, `${i + 1} ${a.name}`)));
      for (const row of this.docToggles) for (const b of row.querySelectorAll('[data-cmd]')) b.setAttribute('aria-pressed', String(app.commands.isChecked(b.dataset.cmd)));
    }
    this.transform.refresh();
    this.#updateShape(ed);
    // Appearance.
    const fill = commonStyle(ed, 'fill');
    const stroke = commonStyle(ed, 'stroke');
    updatePaintSwatch(this.fillSw, fill === 'mixed' ? null : fill, fill === 'mixed');
    updatePaintSwatch(this.strokeSw, stroke === 'mixed' ? null : stroke, stroke === 'mixed');
    const sw = commonStyle(ed, 'strokeWidth');
    // Stroke weights show in the Stroke units preference (points by default), not the document units.
    this.strokeW.setUnit(this.app.prefs.get('strokeUnits') || 'pt');
    this.strokeW.set(sw === 'mixed' ? 'mixed' : sw ?? 0);
    const op = commonStyle(ed, 'opacity');
    this.opacity.set(op === 'mixed' ? 'mixed' : (op ?? 1) * 100);
    const bm = commonStyle(ed, 'blendMode');
    this.blend.set(bm === 'mixed' ? '' : bm || 'normal');
    // Align: distribute needs 3+ objects.
    const count = ed.topSelection().length;
    for (const b of this.distBtns) b.disabled = count < 3;
    for (const e of this.extra) {
      const on = (hasSel || e.def.noSelection) && e.def.when(ed);
      e.sec.hidden = !on;
      if (on) e.inst.refresh();
    }
    if (hasSel) this.#updateQuick(ed);
  }

  #updateShape(ed) {
    const nodes = ed.selectedNodes();
    const n = nodes.length === 1 ? nodes[0] : null;
    const shape = n?.type === 'path' ? n.shape : null;
    this.shapeSection.hidden = !shape || shape.kind === 'line';
    if (this.shapeSection.hidden) return;
    const key = `${n.id}:${shape.kind}`;
    const setShape = (patch, live) => {
      const cur = ed.doc.get(n.id);
      if (!cur?.shape) return;
      const next = { ...cur.shape, ...patch };
      const anchors = shapeAnchors(next);
      if (!anchors) return;
      ed.doc.transact('Change Shape', () => ed.doc.update(n.id, { shape: next, anchors }), { coalesce: live ? `shape-${n.id}` : null });
    };
    if (this.shapeKey !== key) {
      this.shapeKey = key;
      const unit = ed.doc.root.units;
      const fields = [];
      if (shape.kind === 'rect') {
        fields.push(numberField({ label: 'Corner radius', icon: 'square-dashed', value: shape.radii?.[0] || 0, unit, min: 0, onCommit: (v, o) => setShape({ radii: [v, v, v, v] }, o?.live) }));
      } else if (shape.kind === 'polygon') {
        fields.push(numberField({ label: 'Sides', kind: 'number', value: shape.sides, min: 3, max: 1000, onCommit: (v, o) => setShape({ sides: Math.round(v) }, o?.live) }));
        fields.push(numberField({ label: 'Radius', value: shape.r, unit, min: 0, onCommit: (v, o) => setShape({ r: v }, o?.live) }));
      } else if (shape.kind === 'star') {
        fields.push(numberField({ label: 'Points', kind: 'number', value: shape.points, min: 3, max: 1000, onCommit: (v, o) => setShape({ points: Math.round(v) }, o?.live) }));
        fields.push(numberField({ label: 'Radius 1', value: shape.r1, unit, min: 0, onCommit: (v, o) => setShape({ r1: v }, o?.live) }));
        fields.push(numberField({ label: 'Radius 2', value: shape.r2, unit, min: 0, onCommit: (v, o) => setShape({ r2: v }, o?.live) }));
      } else if (shape.kind === 'ellipse') {
        fields.push(numberField({ label: 'Width', value: shape.w, unit, min: 0, onCommit: (v, o) => setShape({ w: v }, o?.live) }));
        fields.push(numberField({ label: 'Height', value: shape.h, unit, min: 0, onCommit: (v, o) => setShape({ h: v }, o?.live) }));
      }
      this.shapeFields = { kind: shape.kind, fields };
      this.shapeBody.replaceChildren(...fields.map((f) => f.el), h('button.btn.small', { type: 'button', onclick: () => ed.doc.transact('Expand Shape', () => ed.doc.update(n.id, { shape: undefined })) }, 'Expand Shape'));
    } else {
      const f = this.shapeFields.fields;
      if (shape.kind === 'rect') f[0].set(shape.radii?.[0] || 0);
      if (shape.kind === 'polygon') {
        f[0].set(shape.sides);
        f[1].set(shape.r);
      }
      if (shape.kind === 'star') {
        f[0].set(shape.points);
        f[1].set(shape.r1);
        f[2].set(shape.r2);
      }
      if (shape.kind === 'ellipse') {
        f[0].set(shape.w);
        f[1].set(shape.h);
      }
    }
  }

  #updateQuick(ed) {
    const app = this.app;
    const nodes = ed.selectedNodes();
    const actions = [];
    const add = (cmd, label) => {
      if (app.commands.get(cmd) && app.commands.isEnabled(cmd)) actions.push(h('button.btn', { type: 'button', onclick: () => app.commands.run(cmd) }, label || app.commands.label(cmd)));
    };
    if (nodes.some((n) => n.type === 'group')) add('object.ungroup', 'Ungroup');
    if (ed.topSelection().length > 1) add('object.group', 'Group');
    if (nodes.some((n) => n.type === 'group')) add('object.isolate', 'Isolate Group');
    if (nodes.some((n) => n.type === 'text')) add('type.createOutlines', 'Create Outlines');
    if (nodes.some((n) => n.type === 'path' || n.type === 'compound')) add('path.offset', 'Offset Path');
    if (ed.topSelection().length > 1) add('object.clipMake', 'Make Clipping Mask');
    if (nodes.some((n) => n.type === 'group' && n.clip)) add('object.clipRelease', 'Release Clipping Mask');
    add('color.recolor', 'Recolor');
    add('object.lock', 'Lock');
    const arrange = h('button.btn', { type: 'button', 'aria-haspopup': 'menu', onclick: (e) => app.showMenuAt(e.currentTarget, ['object.bringToFront', 'object.bringForward', 'object.sendBackward', 'object.sendToBack', '-', 'object.sendToLayer'], 'Arrange') }, 'Arrange');
    actions.push(arrange);
    this.quick.replaceChildren(...actions);
  }
}

function section(title, ...children) {
  return h('section.panel-section', h('h3.section-title', title), ...children);
}

function row(label, control) {
  return h('div.prop-row', h('span.prop-label', label), control);
}
