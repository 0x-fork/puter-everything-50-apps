/**
 * Graphic styles: named appearances (fill, stroke and stroke options,
 * opacity, blending and effects) stored in doc.root.graphicStyles. New
 * documents show the built-in defaults until the list is edited.
 */
import { pickStyle } from '../../model/nodes.js';
import { applyStyleDeep } from '../../tools/navigation.js';
import { uid } from '../../lib/ids.js';
import { createEffect } from './effects-model.js';

const solid = (color) => ({ type: 'solid', color });

export const DEFAULT_GRAPHIC_STYLES = [
  { id: 'gs-default', name: 'Default Graphic Style', style: { fill: solid('#ffffff'), stroke: solid('#000000'), strokeWidth: 1, dash: [], opacity: 1, blendMode: 'normal', effects: [] } },
  { id: 'gs-soft-shadow', name: 'Soft Shadow', style: { fill: solid('#ffffff'), stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [createEffect('dropShadow', { x: 4, y: 6, blur: 8, opacity: 0.35 })] } },
  { id: 'gs-neon', name: 'Neon Glow', style: { fill: null, stroke: solid('#29e3ff'), strokeWidth: 4, strokeJoin: 'round', strokeCap: 'round', opacity: 1, blendMode: 'normal', effects: [createEffect('outerGlow', { color: '#29e3ff', blur: 6, opacity: 0.9, mode: 'normal' })] } },
  {
    id: 'gs-sunset',
    name: 'Sunset Fade',
    style: {
      fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffb347', opacity: 1 }, { offset: 1, color: '#e0457b', opacity: 1 }] },
      stroke: null,
      strokeWidth: 0,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
    },
  },
  { id: 'gs-dashed', name: 'Dashed Outline', style: { fill: null, stroke: solid('#333333'), strokeWidth: 2, dash: [6, 4], dashAlign: 'corners', strokeCap: 'round', opacity: 1, blendMode: 'normal', effects: [] } },
  { id: 'gs-button', name: 'Soft Button', style: { fill: solid('#3d7bfd'), stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [createEffect('roundCorners', { radius: 8 }), createEffect('innerGlow', { color: '#ffffff', opacity: 0.45, blur: 6, mode: 'screen' }), createEffect('dropShadow', { x: 0, y: 3, blur: 4, opacity: 0.3 })] } },
  { id: 'gs-haze', name: 'Haze', style: { fill: solid('#7f5af0'), stroke: null, strokeWidth: 0, opacity: 0.8, blendMode: 'multiply', effects: [createEffect('blur', { radius: 4 })] } },
  { id: 'gs-paper', name: 'Paper Cutout', style: { fill: solid('#f4efe6'), stroke: solid('#d9cfc0'), strokeWidth: 1, opacity: 1, blendMode: 'normal', effects: [createEffect('dropShadow', { x: 2, y: 2, blur: 1, opacity: 0.4 })] } },
];

export function graphicStylesOf(doc) {
  return doc.root.graphicStyles || DEFAULT_GRAPHIC_STYLES;
}

/** Style fields of a node, including the extra stroke options this feature adds. */
export function styleOfNode(doc, node) {
  if (node.type === 'group') {
    // Groups contribute their own effects/opacity and the first leaf's paint.
    let leaf = null;
    const find = (n) => {
      if (leaf || !n) return;
      if (n.type === 'group') for (const c of n.children) find(doc.get(c));
      else if (n.type === 'path' || n.type === 'compound' || n.type === 'text') leaf = n;
    };
    find(node);
    const base = leaf ? styleOfNode(doc, leaf) : {};
    return { ...base, opacity: node.opacity ?? 1, blendMode: node.blendMode || 'normal', effects: structuredClone(node.effects || []) };
  }
  const s = structuredClone(pickStyle(node));
  if (node.dashAlign) s.dashAlign = node.dashAlign;
  return s;
}

/**
 * Stroke options a style replaces even when it does not list them, so a
 * style's appearance replaces the object's whole appearance (no leftover
 * dashes or arrowheads from before).
 */
const STROKE_RESET = { strokeCap: 'butt', strokeJoin: 'miter', miterLimit: 10, strokeAlign: 'center', dash: [], dashOffset: 0, dashAlign: undefined, arrowStart: null, arrowEnd: null };

/** Apply a graphic style to the top-level selection. */
export function applyGraphicStyle(editor, style) {
  const doc = editor.doc;
  const top = editor.topSelection().map((id) => doc.get(id)).filter((n) => n && n.type !== 'layer');
  const paintPatch = { ...STROKE_RESET, ...style };
  delete paintPatch.effects;
  delete paintPatch.opacity;
  delete paintPatch.blendMode;
  editor.setStyle(structuredClone(style));
  if (!top.length) return;
  doc.transact('Apply Graphic Style', () => {
    for (const n of top) {
      const own = { effects: structuredClone(style.effects || []), opacity: style.opacity ?? 1, blendMode: style.blendMode || 'normal' };
      if (n.type === 'group') {
        for (const c of n.children) applyStyleDeep(doc, doc.get(c), structuredClone(paintPatch));
        doc.update(n.id, own);
      } else if (n.type === 'image') doc.update(n.id, own);
      else applyStyleDeep(doc, n, { ...structuredClone(paintPatch), ...own });
    }
  });
}

/** Write the list (materializing the defaults on first edit). */
export function setGraphicStyles(doc, list) {
  doc.updateRoot({ graphicStyles: list });
}

export function newStyleId() {
  return uid('gs');
}
