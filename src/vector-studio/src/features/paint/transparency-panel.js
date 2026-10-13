/**
 * Transparency panel (Shift+Cmd+F10): blending mode, opacity, Isolate
 * Blending and Knockout Group. Unlike fill and stroke, these apply to the
 * selected objects themselves (a selected group gets the opacity as a
 * whole, so its children do not show through each other).
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { numberField, selectField } from '../../ui/widgets.js';
import { BLEND_MODES } from '../../render/draw.js';
import { BLEND_LABELS } from '../../ui/panels/properties.js';
import { gestureKey } from './ui-common.js';
import { drawThumbnail } from './thumbs.js';

/** Objects that carry opacity/blending: the top-level selection (any type). */
export function transparencyTargets(editor) {
  return editor.topSelection().map((id) => editor.doc.get(id)).filter((n) => n && n.type !== 'layer');
}

export function commonTop(editor, key, dflt) {
  const nodes = transparencyTargets(editor);
  if (!nodes.length) return editor.style[key] ?? dflt;
  const first = nodes[0][key] ?? dflt;
  return nodes.every((n) => (n[key] ?? dflt) === first) ? first : 'mixed';
}

/** Set a transparency attribute on the selected objects (and the current style). */
export function setTransparency(editor, patch, label, coalesce = null) {
  const nodes = transparencyTargets(editor);
  const stylePatch = {};
  if ('opacity' in patch) stylePatch.opacity = patch.opacity;
  if ('blendMode' in patch) stylePatch.blendMode = patch.blendMode;
  if (Object.keys(stylePatch).length) editor.setStyle(stylePatch);
  if (!nodes.length) return;
  editor.doc.transact(
    label,
    () => {
      for (const n of nodes) {
        const p = { ...patch };
        if (n.type !== 'group' && n.type !== 'layer') {
          delete p.isolate;
          delete p.knockout;
        }
        if (Object.keys(p).length) editor.doc.update(n.id, p);
      }
    },
    { coalesce },
  );
}

export class TransparencyPanel extends Panel {
  static id = 'transparency';
  static title = 'Transparency';
  static icon = 'contrast';
  static placement = 'strip';
  static shortcut = 'Shift+Mod+F10';

  build() {
    const app = this.app;
    this.key = gestureKey('opacity');
    this.blend = selectField('Blending mode', BLEND_MODES.map((m) => ({ value: m, label: BLEND_LABELS[m] || m })), 'normal', (v) => app.editor && setTransparency(app.editor, { blendMode: v }, 'Blending Mode'));
    this.opacity = numberField({
      label: 'Opacity',
      kind: 'percent',
      value: 100,
      min: 0,
      max: 100,
      width: '64px',
      onCommit: (v, o) => {
        if (!o?.live) this.key = gestureKey('opacity');
        if (app.editor) setTransparency(app.editor, { opacity: v / 100 }, 'Opacity', this.key);
      },
    });
    this.range = h('input.tp-range', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Opacity slider' });
    this.range.addEventListener('pointerdown', () => (this.key = gestureKey('opacity')));
    this.range.addEventListener('keydown', (e) => {
      this.key = gestureKey('opacity');
      e.stopPropagation();
    });
    this.range.addEventListener('input', () => app.editor && setTransparency(app.editor, { opacity: Number(this.range.value) / 100 }, 'Opacity', this.key));
    const check = (id, label, key) => {
      const input = h('input', { type: 'checkbox', id, onchange: () => app.editor && setTransparency(app.editor, { [key]: input.checked || undefined }, label) });
      return { input, el: h('div.check-row', input, h('label', { for: id }, label)) };
    };
    this.isolate = check('tp-isolate', 'Isolate Blending', 'isolate');
    this.knockout = check('tp-knockout', 'Knockout Group', 'knockout');
    this.thumb = h('canvas.tp-thumb', { width: 56, height: 56, 'aria-hidden': 'true' });
    this.note = h('p.tp-note.muted', 'Isolate Blending and Knockout Group apply to groups.');
    this.el.append(
      h('div.tp-top', this.blend.el, this.opacity.el),
      this.range,
      h('div.tp-mid', this.thumb, h('div.tp-checks', this.isolate.el, this.knockout.el)),
      this.note,
    );
  }

  update() {
    const ed = this.app.editor;
    this.el.classList.toggle('disabled', !ed);
    if (!ed) return;
    const bm = commonTop(ed, 'blendMode', 'normal');
    this.blend.set(bm === 'mixed' ? '' : bm);
    const op = commonTop(ed, 'opacity', 1);
    this.opacity.set(op === 'mixed' ? 'mixed' : op * 100);
    if (document.activeElement !== this.range) this.range.value = String(op === 'mixed' ? 100 : Math.round(op * 100));
    const groups = transparencyTargets(ed).filter((n) => n.type === 'group');
    for (const [c, key] of [[this.isolate, 'isolate'], [this.knockout, 'knockout']]) {
      c.input.disabled = !groups.length;
      const vals = groups.map((g) => Boolean(g[key]));
      c.input.checked = vals.length > 0 && vals.every(Boolean);
      c.input.indeterminate = vals.some(Boolean) && !vals.every(Boolean);
    }
    this.note.hidden = groups.length > 0;
    this.drawThumb(ed);
  }

  drawThumb(ed) {
    const ctx = this.thumb.getContext('2d');
    if (!ctx) return;
    const sel = transparencyTargets(ed);
    // Redraw only when the selected object changed (nodes are immutable).
    const key = sel.length === 1 ? sel[0] : sel.length;
    if (key === this.thumbKey) return;
    this.thumbKey = key;
    const w = this.thumb.width;
    ctx.clearRect(0, 0, w, w);
    // Checkerboard shows transparency.
    for (let y = 0; y < w; y += 7) for (let x = 0; x < w; x += 7) {
      ctx.fillStyle = ((x + y) / 7) % 2 ? '#d9d9d9' : '#ffffff';
      ctx.fillRect(x, y, 7, 7);
    }
    const nodes = transparencyTargets(ed);
    if (nodes.length !== 1) return;
    drawThumbnail(ctx, ed.doc, nodes[0], w);
  }
}
