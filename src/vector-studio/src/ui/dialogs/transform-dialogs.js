/**
 * Object > Transform dialogs: Move, Rotate, Reflect, Scale, Shear,
 * Transform Each, plus Path > Average. Each has a live Preview (an open
 * transaction re-applied on every edit), Copy (transform a duplicate) and
 * OK; Cancel rolls the preview back.
 */
import { formDialog } from './dialog.js';
import { rotate, scale, shear, translate } from '../../lib/matrix.js';
import { transformNodes, usesPatternPaint } from '../../model/geometry.js';
import { reflectAcross } from '../../tools/transform-tools.js';
import { applyTransform, transformEach } from '../../commands/core.js';
import { average } from '../../ops/object-ops.js';

function selectionCenter(editor) {
  const b = editor.selectionBounds(false);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2, b } : null;
}

function matrixFor(kind, v, origin) {
  const { x, y } = origin;
  switch (kind) {
    case 'move':
      return translate(v.dx, v.dy);
    case 'rotate':
      return rotate(-v.angle, x, y);
    case 'reflect':
      return v.axis === 'horizontal' ? reflectAcross(x, y, 0) : v.axis === 'vertical' ? reflectAcross(x, y, 90) : reflectAcross(x, y, -v.angle);
    case 'scale':
      return v.uniform ? scale(v.uniformPct / 100, v.uniformPct / 100, x, y) : scale(v.sx / 100, v.sy / 100, x, y);
    case 'shear':
      return v.axis === 'horizontal' ? shear(v.angle, 0, x, y) : v.axis === 'vertical' ? shear(0, v.angle, x, y) : shear(v.angle, 0, x, y);
    default:
      return null;
  }
}

const LAST = {
  move: { dx: 0, dy: 0 },
  rotate: { angle: 0 },
  reflect: { axis: 'vertical', angle: 90 },
  scale: { uniform: true, uniformPct: 100, sx: 100, sy: 100, strokes: false, corners: false },
  shear: { angle: 0, axis: 'horizontal' },
  each: { scaleX: 100, scaleY: 100, moveX: 0, moveY: 0, angle: 0, reflectX: false, reflectY: false, random: false, refX: 0.5, refY: 0.5 },
};

export async function transformDialog(app, kind, args = {}) {
  const editor = app.editor;
  if (!editor?.selection.size) return;
  const c = args.origin ? { ...args.origin } : selectionCenter(editor);
  if (!c) return;
  const doc = editor.doc;
  const titles = { move: 'Move', rotate: 'Rotate', reflect: 'Reflect', scale: 'Scale', shear: 'Shear', each: 'Transform Each' };
  const last = LAST[kind];
  // Move starts from the last move however it was made (drag, nudge, dialog).
  const lm = editor.lastTransform?.matrix;
  if (kind === 'move' && lm && Math.abs(lm[0] - 1) < 1e-9 && Math.abs(lm[3] - 1) < 1e-9 && Math.abs(lm[1]) < 1e-9 && Math.abs(lm[2]) < 1e-9) {
    last.dx = lm[4];
    last.dy = lm[5];
  }
  const fields = {
    move: [
      { key: 'dx', label: 'Horizontal', type: 'length', value: last.dx },
      { key: 'dy', label: 'Vertical', type: 'length', value: last.dy },
    ],
    rotate: [{ key: 'angle', label: 'Angle', type: 'angle', value: last.angle }],
    reflect: [
      {
        key: 'axis',
        label: 'Axis',
        type: 'radio',
        value: last.axis,
        options: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
          { value: 'angle', label: 'Angle' },
        ],
      },
      { key: 'angle', label: 'Angle', type: 'angle', value: last.angle },
    ],
    scale: [
      { key: 'uniform', label: 'Uniform', type: 'checkbox', value: last.uniform },
      { key: 'uniformPct', label: 'Scale', type: 'percent', value: last.uniformPct },
      { key: 'sx', label: 'Horizontal (non-uniform)', type: 'percent', value: last.sx },
      { key: 'sy', label: 'Vertical (non-uniform)', type: 'percent', value: last.sy },
      { key: 'corners', label: 'Scale Corners', type: 'checkbox', value: app.prefs.get('scaleCorners') },
      { key: 'strokes', label: 'Scale Strokes & Effects', type: 'checkbox', value: app.prefs.get('scaleStrokes') },
    ],
    shear: [
      { key: 'angle', label: 'Shear Angle', type: 'angle', value: last.angle },
      {
        key: 'axis',
        label: 'Axis',
        type: 'radio',
        value: last.axis,
        options: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
        ],
      },
    ],
    each: [
      { type: 'heading', label: 'Scale' },
      { key: 'scaleX', label: 'Horizontal', type: 'percent', value: last.scaleX },
      { key: 'scaleY', label: 'Vertical', type: 'percent', value: last.scaleY },
      { type: 'heading', label: 'Move' },
      { key: 'moveX', label: 'Horizontal', type: 'length', value: last.moveX },
      { key: 'moveY', label: 'Vertical', type: 'length', value: last.moveY },
      { type: 'heading', label: 'Rotate' },
      { key: 'angle', label: 'Angle', type: 'angle', value: last.angle },
      { key: 'reflectX', label: 'Reflect X', type: 'checkbox', value: last.reflectX },
      { key: 'reflectY', label: 'Reflect Y', type: 'checkbox', value: last.reflectY },
      { key: 'random', label: 'Random', type: 'checkbox', value: last.random },
    ],
  }[kind];
  // Pattern-painted objects choose what the transform moves: the objects, their patterns, or both.
  const patterns = kind !== 'each' && usesPatternPaint(doc, editor.topSelection());
  if (patterns) {
    fields.push(
      { key: 'objects', label: 'Transform Objects', type: 'checkbox', value: true },
      { key: 'patterns', label: 'Transform Patterns', type: 'checkbox', value: app.prefs.get('transformPatterns') ?? true },
    );
  }
  fields.push({ key: 'preview', label: 'Preview', type: 'checkbox', value: false });

  let tx = null;
  const optsFor = (v) => ({
    scaleStrokes: kind === 'scale' ? v.strokes : app.prefs.get('scaleStrokes'),
    scaleCorners: kind === 'scale' ? v.corners : app.prefs.get('scaleCorners'),
    transformPatterns: patterns ? v.patterns : (app.prefs.get('transformPatterns') ?? true),
    ...(patterns && !v.objects ? { transformObjects: false } : {}),
  });
  const rollback = () => {
    if (tx) {
      tx.cancel();
      tx = null;
    }
  };
  const preview = (v) => {
    rollback();
    if (!v.preview) return;
    tx = doc.begin(titles[kind]);
    if (kind === 'each') transformEach(editor, { ...v, random: false });
    else transformNodes(doc, editor.topSelection(), matrixFor(kind, v, c), optsFor(v));
  };
  const result = await formDialog(app, {
    title: titles[kind],
    fields,
    onChange: preview,
    extraButtons: [{ label: 'Copy', action: 'copy', left: true }],
  });
  rollback();
  if (!result) return;
  const copy = result.__action === 'copy';
  if (kind === 'scale') {
    app.prefs.set('scaleStrokes', result.strokes);
    app.prefs.set('scaleCorners', result.corners);
  }
  if (patterns && result.objects) app.prefs.set('transformPatterns', result.patterns);
  Object.assign(LAST[kind], result);
  if (kind === 'each') {
    doc.transact('Transform Each', () => transformEach(editor, result, copy));
    editor.lastTransform = { each: { ...result }, copy };
    return;
  }
  applyTransform(editor, titles[kind], matrixFor(kind, result, c), { copy, opts: optsFor(result) });
}

export async function averageDialog(app) {
  const v = await formDialog(app, {
    title: 'Average',
    fields: [
      {
        key: 'axis',
        label: 'Axis',
        type: 'radio',
        value: 'both',
        options: [
          { value: 'h', label: 'Horizontal' },
          { value: 'v', label: 'Vertical' },
          { value: 'both', label: 'Both' },
        ],
      },
    ],
  });
  if (v) average(app.editor, v.axis);
}
