import { paintParagraphBorder } from './canvas-paragraph-borders.js';
import { tableBorderColor } from './colors.js';

export function paintTableBorder(ctx, stroke) {
  if (!stroke.guide) {
    paintParagraphBorder(ctx, stroke, stroke.crossingCuts?.map(cut => ({...cut, x: cut.x + stroke.x, y: cut.y + stroke.y})), tableBorderColor(stroke.border.color));
    return;
  }
  const { x, y, width, height, horizontal } = stroke;
  ctx.save(); ctx.strokeStyle = '#d5d8dc'; ctx.lineWidth = .5; ctx.setLineDash([2, 3]);
  if (stroke.cellClip) {
    ctx.beginPath(); ctx.rect(Math.max(x - 1, stroke.cellClip.left ?? -Infinity), stroke.cellClip.top, Math.max(0, Math.min(x + width + 1, stroke.cellClip.right ?? Infinity) - Math.max(x - 1, stroke.cellClip.left ?? -Infinity)), stroke.cellClip.bottom - stroke.cellClip.top); ctx.clip();
  }
  ctx.beginPath();
  ctx.moveTo(x + (horizontal ? 0 : width / 2), y + (horizontal ? height / 2 : 0));
  ctx.lineTo(x + (horizontal ? width : width / 2), y + (horizontal ? height / 2 : height));
  ctx.stroke(); ctx.restore();
}
