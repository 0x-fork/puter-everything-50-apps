/**
 * Pathfinder: Shape Modes (Unite, Minus Front, Intersect, Exclude) and
 * Pathfinders (Divide, Trim, Merge, Crop, Outline, Minus Back) with these
 * style rules:
 *   Unite, Intersect, Exclude, Minus Back  the frontmost object's style
 *   Minus Front                            the backmost object's style
 *   Divide                                 each face keeps the style of the topmost object covering it
 *   Trim, Merge, Crop                      fills only (strokes removed); Merge joins same-colored fills
 *   Outline                                edges stroked with their face's fill, 0 pt weight, no fill
 * Results replace the operands at the topmost operand's position; pathfinder
 * results are grouped.
 */
import { OP, runGeom } from './engine/index.js';
import { withBusy } from './busy.js';
import { geometryLeaves, shapeOf, styleOf, nodeFromSubpaths, groupOf, replaceWith, insertionPoint, fillOnly, solidKey, snapshot, unchangedSince, isOpenLine } from './nodes-io.js';

export const SHAPE_MODES = [
  { kind: 'unite', label: 'Unite', icon: 'pathfinder-unite', op: OP.UNITE },
  { kind: 'minusFront', label: 'Minus Front', icon: 'pathfinder-minus-front', op: OP.MINUS_FRONT },
  { kind: 'intersect', label: 'Intersect', icon: 'pathfinder-intersect', op: OP.INTERSECT },
  { kind: 'exclude', label: 'Exclude', icon: 'pathfinder-exclude', op: OP.EXCLUDE },
];

export const PATHFINDERS = [
  { kind: 'divide', label: 'Divide', icon: 'pathfinder-divide', op: OP.DIVIDE },
  { kind: 'trim', label: 'Trim', icon: 'pathfinder-trim', op: OP.TRIM },
  { kind: 'merge', label: 'Merge', icon: 'pathfinder-merge', op: OP.MERGE },
  { kind: 'crop', label: 'Crop', icon: 'pathfinder-crop', op: OP.CROP },
  { kind: 'outline', label: 'Outline', icon: 'pathfinder-outline', op: OP.OUTLINE },
  { kind: 'minusBack', label: 'Minus Back', icon: 'pathfinder-minus-back', op: OP.MINUS_BACK },
];

export const ALL_KINDS = [...SHAPE_MODES, ...PATHFINDERS];

/** Pathfinder options (panel menu): precision in points and unpainted-artwork removal. */
export const pathfinderOptions = { precision: 0.028, removeUnpainted: false };

/** Per-document change counters so operand lists can be cached between edits. */
const docVersions = new WeakMap();
function docVersion(doc) {
  let v = docVersions.get(doc);
  if (!v) {
    v = { n: 0 };
    docVersions.set(doc, v);
    doc.on('change', () => v.n++);
  }
  return v.n;
}
const operandCache = new WeakMap();

/** Path/compound leaves of the selection, back to front (cached until the document or selection changes). */
export function operands(editor) {
  const sig = `${docVersion(editor.doc)}|${[...editor.selection].join(',')}`;
  const hit = operandCache.get(editor);
  if (hit && hit.sig === sig) return hit.leaves;
  const leaves = geometryLeaves(editor.doc, editor.topSelection());
  operandCache.set(editor, { sig, leaves });
  return leaves;
}

/** Whether a pathfinder can run on the selection. */
export function canRun(editor, kind) {
  if (!editor) return false;
  const leaves = operands(editor);
  if (kind === 'unite' || kind === 'divide' || kind === 'outline') return leaves.length >= 2 || (leaves.length === 1 && leaves[0].type === 'compound');
  return leaves.length >= 2;
}

/**
 * Pure part: build result items from engine records. Exported for tests.
 * Returns [{ node, descendants }] to insert (one item; pathfinders return a group).
 */
export function buildResults(kind, leaves, records, { removeUnpainted = false } = {}) {
  const def = ALL_KINDS.find((k) => k.kind === kind);
  const isShapeMode = SHAPE_MODES.includes(def) || kind === 'minusBack';
  if (isShapeMode) {
    const rec = records[0];
    if (!rec || !rec.subpaths.length) return [];
    const owner = leaves[rec.owner];
    const built = nodeFromSubpaths(rec.subpaths, styleOf(owner));
    return built ? [built] : [];
  }
  const items = [];
  for (const rec of records) {
    const owner = leaves[rec.owner];
    if (!owner) continue;
    let style;
    if (kind === 'divide') {
      style = styleOf(owner);
      if (removeUnpainted && !owner.fill && !owner.stroke) continue;
    } else if (kind === 'outline') {
      if (removeUnpainted && !owner.fill) continue;
      style = { ...styleOf(owner), fill: null, stroke: owner.fill || owner.stroke || null, strokeWidth: 0, dash: [], arrowStart: null, arrowEnd: null };
    } else {
      if (!owner.fill) continue;
      style = fillOnly(styleOf(owner));
    }
    const built = nodeFromSubpaths(rec.subpaths, style);
    if (built) items.push(built);
  }
  if (!items.length) return [];
  return [groupOf(items)];
}

/** Engine shapes for the operands of a pathfinder kind. */
export function shapesFor(doc, kind, leaves) {
  const cuts = !SHAPE_MODES.some((k) => k.kind === kind) && kind !== 'minusBack';
  const keys = new Map();
  return leaves.map((n) => {
    let key = -1;
    if (kind === 'merge') {
      const k = solidKey(n);
      if (k) {
        if (!keys.has(k)) keys.set(k, keys.size);
        key = keys.get(k);
      }
    }
    return shapeOf(doc, n, { string: cuts && isOpenLine(n), key });
  });
}

/** Run a pathfinder on the editor's selection (async: big jobs use the worker). */
export async function runPathfinder(app, kind) {
  const editor = app.editor;
  if (!editor) return false;
  const def = ALL_KINDS.find((k) => k.kind === kind);
  if (!def) return false;
  const doc = editor.doc;
  const leaves = operands(editor);
  if (!canRun(editor, kind)) {
    app.notify(kind === 'unite' ? 'Select two or more paths, or a compound path.' : 'Select two or more paths.');
    return false;
  }
  app.lastPathfinder = kind;
  const snap = snapshot(doc, leaves);
  const shapes = shapesFor(doc, kind, leaves);
  const records = await withBusy(app, def.label, () => runGeom(def.op, shapes, [], { tol: pathfinderOptions.precision }));
  if (app.editor !== editor || !unchangedSince(doc, snap)) {
    app.notify(`${def.label} was canceled because the artwork changed.`);
    return false;
  }
  const items = buildResults(kind, leaves, records, pathfinderOptions);
  if (!items.length) {
    app.notify(`${def.label} produced no shapes.`);
    return false;
  }
  let ids = [];
  doc.transact(def.label, () => {
    ids = replaceWith(doc, leaves, items, insertionPoint(doc, leaves));
  });
  editor.select(ids);
  return true;
}
