import { imageTransform } from '../core/charts.js';
import { pictureGeometry } from '../core/picture-geometry.js';
import { el } from './dom.js';
import { drawingSvg } from '../core/drawingml-svg.js';

/** Use the same source/fill mapping on screen and in print, without flattening image bytes. */
export function pictureNode(obj) {
  const drawing = obj.drawingShape && !obj.srcRect && !obj.fillRect && drawingSvg(obj.src);
  if (drawing) {
    drawing.setAttribute('role', obj.decorative ? 'presentation' : 'img');
    if (obj.decorative) drawing.setAttribute('aria-hidden', 'true');
    else drawing.setAttribute('aria-label', obj.title || 'Image');
    drawing.style.transform = imageTransform(obj);
    return drawing;
  }
  if (!obj.srcRect && !obj.fillRect) return el('img', { src: obj.src, alt: obj.decorative ? '' : obj.title || 'Image', draggable: false, style: { transform: imageTransform(obj), borderRadius: 'inherit' } });
  const svg = (name, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const root = svg('svg', { viewBox: '0 0 1 1', preserveAspectRatio: 'none', ...(obj.decorative ? { role: 'presentation', 'aria-hidden': 'true' } : { role: 'img', 'aria-label': obj.title || 'Image' }) });
  root.style.transform = imageTransform(obj);
  root.style.overflow = 'hidden';
  root.style.borderRadius = 'inherit';
  const g = pictureGeometry(obj);
  if (g) {
    const { source: s, fill: f } = g;
    const crop = svg('svg', { x: f.x, y: f.y, width: f.w, height: f.h, viewBox: `${s.x} ${s.y} ${s.w} ${s.h}`, preserveAspectRatio: 'none', overflow: 'hidden' });
    // Override generic chart/print SVG sizing for this nested viewport.
    crop.style.width = `${f.w * 100}%`;
    crop.style.height = `${f.h * 100}%`;
    crop.append(svg('image', { href: obj.src, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'none' }));
    root.append(crop);
  }
  return root;
}
