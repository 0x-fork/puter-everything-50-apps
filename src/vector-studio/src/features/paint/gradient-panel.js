/**
 * Gradient panel (Cmd+F9): gradient type (linear / radial), the gradient
 * slider with stops and midpoints, stop color / opacity / location, angle,
 * aspect ratio for radial gradients, reverse, and how a gradient applies
 * to a stroke (within the stroke). Edits apply to the focused fill or
 * stroke of the selection; when that paint is not a gradient yet, the
 * panel shows the last gradient used and clicking the thumbnail (or
 * editing anything) applies it.
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { iconButton, numberField, paintSwatch, updatePaintSwatch, segmented } from '../../ui/widgets.js';
import { openPopover } from '../../ui/popover.js';
import { createColorPicker } from '../../ui/color-picker.js';
import { applyStyle } from '../../ops/paint-ops.js';
import { createGradientSlider } from './gradient-slider.js';
import { DEFAULT_LINEAR, setStop, removeStop, reverseGradient, setGradientType, gradientAngle, setGradientAngle, normalizeGradient, resetGradientVector } from './gradient-model.js';
import { isGradient } from '../../model/gradients.js';
import { miniFillStroke, focusedPaint, gestureKey, paintState } from './ui-common.js';

/** Popover to edit one color: swatches plus the color picker. */
export function openColorPopover(app, anchor, { color, title = 'Color', onInput }) {
  const swatches = (app.editor?.doc.root.swatches || []).filter((s) => s.paint?.type === 'solid');
  const grid = h('div.swatch-grid', { role: 'listbox', 'aria-label': `${title} swatches` });
  const picker = createColorPicker({ value: color, label: title, onInput: (hex) => onInput(hex, { swatchId: null }) });
  for (const s of swatches) {
    grid.append(
      h('button.swatch-cell', {
        type: 'button',
        role: 'option',
        'aria-label': s.name,
        'data-tip': s.name,
        onclick: () => {
          picker.set(s.paint.color);
          onInput(s.paint.color, { swatchId: s.global ? s.id : null });
        },
      }, paintSwatch(s.paint)),
    );
  }
  openPopover(anchor, h('div.paint-popover', h('h3.popover-title', title), grid, picker.el), { label: title });
}

export class GradientPanel extends Panel {
  static id = 'gradient';
  static title = 'Gradient';
  static icon = 'paint-gradient';
  static placement = 'strip';
  static shortcut = 'Mod+F9';

  build() {
    const app = this.app;
    this.coalesce = gestureKey('gradient');
    this.fs = miniFillStroke(app);
    this.thumbSw = paintSwatch(null);
    this.thumb = h('button.gp-thumb', { type: 'button', 'aria-label': 'Apply gradient', 'data-tip': 'Gradient: click to apply', onclick: () => this.commit(this.paint, 'Apply Gradient', null) }, this.thumbSw);
    this.type = segmented(
      'Gradient type',
      [
        { value: 'linear', label: 'Linear Gradient', icon: 'gradient-linear' },
        { value: 'radial', label: 'Radial Gradient', icon: 'gradient-radial' },
      ],
      'linear',
      (v) => this.commit(setGradientType(this.paint, v), 'Gradient Type', null),
    );
    this.editBtn = h('button.btn.small', { type: 'button', onclick: () => app.setTool('gradient') }, 'Edit Gradient');
    this.strokeMode = segmented(
      'Stroke gradient',
      [
        { value: 'within', label: 'Apply gradient within stroke', icon: 'stroke-within' },
        { value: 'along', label: 'Apply gradient along stroke (not available)', icon: 'stroke-along' },
        { value: 'across', label: 'Apply gradient across stroke (not available)', icon: 'stroke-across' },
      ],
      'within',
      () => {},
    );
    this.strokeMode.el.querySelectorAll('button').forEach((b, i) => (b.disabled = i > 0));
    this.strokeRow = h('div.pp-row.gp-stroke', h('span.pp-label', 'Stroke'), this.strokeMode.el);
    this.angle = numberField({
      label: 'Angle',
      kind: 'angle',
      value: 0,
      min: -360,
      max: 360,
      width: '64px',
      onCommit: (v, o) => {
        if (!o?.live) this.coalesce = gestureKey('gradient');
        this.commit(setGradientAngle(this.paint, v), 'Gradient Angle', this.coalesce);
      },
    });
    this.aspect = numberField({
      label: 'Aspect ratio',
      kind: 'percent',
      value: 100,
      min: 0.5,
      max: 32767,
      width: '64px',
      onCommit: (v, o) => {
        if (!o?.live) this.coalesce = gestureKey('gradient');
        this.commit({ ...this.paint, aspect: v / 100 }, 'Gradient Aspect Ratio', this.coalesce);
      },
    });
    this.reverse = iconButton('arrow-left-right', 'Reverse Gradient', () => this.commit(reverseGradient(this.paint), 'Reverse Gradient', null), { className: 'small' });
    this.resetVec = iconButton('refresh-cw', 'Fit gradient to the object', () => this.commit(resetGradientVector(this.paint), 'Reset Gradient', null), { className: 'small' });
    this.slider = createGradientSlider({
      onGestureStart: () => (this.coalesce = gestureKey('gradient')),
      onSelect: (i) => {
        paintState.setStop(i);
        this.refreshStop();
      },
      onChange: (p) => this.commit(p, 'Edit Gradient', this.coalesce),
      onEditStop: (i, anchor) => this.editStopColor(i, anchor),
    });
    this.stopChip = paintSwatch(null);
    this.stopBtn = h('button.swatch-btn', { type: 'button', 'aria-label': 'Stop color', 'aria-haspopup': 'dialog', onclick: (e) => this.editStopColor(this.slider.selected, e.currentTarget) }, this.stopChip);
    this.opacity = numberField({
      label: 'Opacity',
      kind: 'percent',
      value: 100,
      min: 0,
      max: 100,
      width: '56px',
      onCommit: (v, o) => {
        if (!o?.live) this.coalesce = gestureKey('gradient');
        this.commit(setStop(this.paint, this.slider.selected, { opacity: v / 100 }), 'Stop Opacity', this.coalesce);
      },
    });
    this.location = numberField({
      label: 'Location',
      kind: 'percent',
      value: 0,
      min: 0,
      max: 100,
      width: '56px',
      onCommit: (v, o) => {
        if (!o?.live) this.coalesce = gestureKey('gradient');
        const p = normalizeGradient(setStop(this.paint, this.slider.selected, { offset: v / 100 }));
        this.commit(p, 'Stop Location', this.coalesce);
      },
    });
    this.delStop = iconButton('trash', 'Delete Stop', () => {
      if (this.paint.stops.length <= 2) return;
      const i = this.slider.selected;
      paintState.setStop(Math.max(0, i - 1));
      this.commit(removeStop(this.paint, i), 'Delete Stop', null);
    }, { className: 'small' });
    this.aspectRow = h('div.gp-field', this.aspect.el);
    this.el.append(
      h('div.gp-top', this.thumb, h('div.gp-type', h('span.pp-label', 'Type'), this.type.el), this.fs.el),
      h('div.gp-row', this.editBtn, this.reverse, this.resetVec),
      this.strokeRow,
      h('div.gp-row', h('div.gp-field', this.angle.el), this.aspectRow),
      this.slider.el,
      h('div.gp-stoprow', this.stopBtn, h('div.gp-field', this.opacity.el), h('div.gp-field', this.location.el), this.delStop),
    );
  }

  /** Current gradient (from the focused paint, or the last / default one). */
  current() {
    const ed = this.app.editor;
    const { paint } = ed ? focusedPaint(ed) : { paint: null };
    if (paint && paint !== 'mixed' && isGradient(paint)) return { paint, applied: true };
    return { paint: paintState.lastGradient || ed?.lastGradient || DEFAULT_LINEAR, applied: false };
  }

  commit(paint, label, coalesce) {
    const ed = this.app.editor;
    if (!ed) return;
    const next = { ...paint };
    delete next.swatchId;
    this.paint = next;
    paintState.lastGradient = next;
    ed.lastGradient = resetGradientVector(next);
    applyStyle(ed, { [ed.focusPaint]: next }, label, coalesce);
  }

  editStopColor(i, anchor) {
    const s = this.paint.stops[i];
    if (!s) return;
    paintState.setStop(i);
    const coalesce = gestureKey('gradient-stop');
    openColorPopover(this.app, anchor, {
      color: s.color,
      title: `Stop ${i + 1} Color`,
      onInput: (hex, { swatchId }) => {
        const stop = { color: hex };
        const p = setStop(this.paint, i, stop);
        const out = { ...p, stops: p.stops.map((x, j) => {
          if (j !== i) return x;
          const y = { ...x };
          if (swatchId) y.swatchId = swatchId;
          else delete y.swatchId;
          return y;
        }) };
        this.commit(out, 'Stop Color', coalesce);
      },
    });
  }

  refreshStop() {
    const p = this.paint;
    if (!p) return;
    const s = p.stops[this.slider.selected] || p.stops[0];
    updatePaintSwatch(this.stopChip, { type: 'solid', color: s.color });
    this.opacity.set((s.opacity ?? 1) * 100);
    this.location.set(s.offset * 100);
    this.delStop.disabled = p.stops.length <= 2;
  }

  update() {
    const ed = this.app.editor;
    this.el.classList.toggle('disabled', !ed);
    if (!ed) return;
    this.fs.refresh();
    const { paint, applied } = this.current();
    this.paint = paint;
    this.el.classList.toggle('not-applied', !applied);
    updatePaintSwatch(this.thumbSw, paint);
    this.type.set(paint.type);
    this.angle.set(gradientAngle(paint));
    this.aspect.set((paint.aspect ?? 1) * 100);
    this.aspectRow.hidden = paint.type !== 'radial';
    this.strokeRow.hidden = ed.focusPaint !== 'stroke';
    this.resetVec.disabled = paint.x1 === undefined;
    const sel = Math.min(paintState.stop, paint.stops.length - 1);
    this.slider.set(paint, sel);
    this.refreshStop();
  }

  shown() {
    super.shown();
    if (!this.offStop) this.offStop = paintState.on('stop', () => this.visible && this.update());
  }
}
