import { el } from './dom.js';
import { TABLE_DESIGNS, DEFAULT_TABLE_OPTIONS, cellPlaces } from '../engine/table-designs.js';

const OPTIONS = [['headerRow', 'Header Row'], ['firstColumn', 'First Column'], ['totalRow', 'Total Row'], ['lastColumn', 'Last Column'], ['bandedRows', 'Banded Rows'], ['bandedColumns', 'Banded Columns']];

/** A design drawn on a small five-by-five table, as the gallery shows it. */
export function drawDesignThumbnail(canvas, design, options, { width = 62, height = 46 } = {}) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  // A browser may refuse another 2D context (canvas memory limits); leave the thumbnail blank.
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  const rows = 5, columns = 5, pad = 4, cw = (width - pad * 2) / columns, rh = (height - pad * 2) / rows;
  const table = { rows: Array.from({ length: rows }, () => ({ cells: Array.from({ length: columns }, (_, i) => ({ id: `t${i}`, span: 1 })) })), grid: Array(columns).fill(1) };
  table.rows.forEach((row, r) => row.cells.forEach((cell, c) => { cell.id = `r${r}c${c}`; }));
  let places;
  try { places = cellPlaces(table, options); } catch { return; }
  for (const place of places) {
    const look = design.format(place), x = pad + place.column * cw, y = pad + place.row * rh;
    if (look.fill) { ctx.fillStyle = `#${look.fill}`; ctx.fillRect(x, y, cw, rh); }
    // A short text stroke in each cell shows the text color and weight.
    ctx.fillStyle = look.color && look.color !== 'auto' ? `#${look.color}` : '#555';
    ctx.fillRect(x + 2, y + rh / 2 - (look.bold ? 1 : 0.5), cw * 0.55, look.bold ? 2 : 1);
    for (const [side, border] of Object.entries(look.borders)) {
      if (!border || border.style === 'nil' || border.style === 'none') continue;
      ctx.fillStyle = border.color === 'auto' ? '#000' : `#${border.color}`;
      const t = Math.max(0.75, border.size / 8);
      if (side === 'top') ctx.fillRect(x, y, cw, t);
      else if (side === 'bottom') ctx.fillRect(x, y + rh - t, cw, t);
      else if (side === 'left') ctx.fillRect(x, y, t, rh);
      else ctx.fillRect(x + cw - t, y, t, rh);
    }
  }
}

/**
 * Table Design → Table Style Options and the Table Styles gallery. Options apply at once to a table that
 * has a design from this gallery, and to the next design chosen otherwise.
 */
export function createTableDesignControls({ current, apply, enabled, onMenu }) {
  let pending = { ...DEFAULT_TABLE_OPTIONS };
  const options = () => current()?.options || pending;
  const boxes = OPTIONS.map(([key, label]) => {
    const input = el('input', { type: 'checkbox', checked: DEFAULT_TABLE_OPTIONS[key], onchange: () => {
      const next = { ...options(), [key]: input.checked };
      if (current()) apply(current().id, next); else pending = next;
      refresh();
    } });
    return { key, input, node: el('label.ribbon-check', {}, input, label) };
  });
  const optionsGrid = el('div.ribbon-check-grid', {}, ...boxes.map(b => b.node));
  const gallery = el('div.ribbon-gallery.table-design-gallery', { role: 'listbox', 'aria-label': 'Table Styles', 'aria-orientation': 'horizontal', dataset: { shrinkMin: '2', shrinkMax: '460' } });
  const items = TABLE_DESIGNS.map(design => {
    const canvas = el('canvas', { 'aria-hidden': 'true' });
    const button = el('button.ribbon-table-design', { type: 'button', role: 'option', title: design.name, 'aria-label': design.name, 'aria-selected': 'false', onclick: () => apply(design.id, options()) }, canvas);
    button.addEventListener('mousedown', e => e.preventDefault());
    return { design, button, canvas };
  });
  gallery.append(...items.map(i => i.button));
  let drawn = '';
  function refresh() {
    const on = enabled(), opts = options(), signature = JSON.stringify(opts);
    for (const { input, key } of boxes) { input.disabled = !on; input.checked = !!opts[key]; }
    for (const { design, button, canvas } of items) {
      button.disabled = !on;
      button.setAttribute('aria-selected', String(current()?.id === design.id));
      if (signature !== drawn) drawDesignThumbnail(canvas, design, opts);
    }
    drawn = signature;
  }
  const menuItems = () => TABLE_DESIGNS.map(design => ({ label: design.name, radio: true, checked: current()?.id === design.id, disabled: !enabled(), onSelect: () => apply(design.id, options()) }));
  return { optionsGrid, gallery, refresh, menuItems, onMenu };
}
