import { verticalMerges, rowGrid } from './tables.js';
import { checkedCellBorders, resolveCellBorders } from './cell-borders.js';
import { checkedShading, cellShadingFill } from './backgrounds.js';
import { paragraphText } from './model.js';

/**
 * Table designs for Table Design → Table Styles: original looks in the spirit of a word processor's
 * table style gallery, applied as direct cell formatting (`w:tcBorders`, `w:shd`, `w:b`, `w:color`) so
 * every consumer shows them the same. Each design maps a cell's place to its borders, fill and text.
 *
 * Options mirror Table Style Options: headerRow, totalRow, bandedRows, firstColumn, lastColumn, bandedColumns.
 */
export const DEFAULT_TABLE_OPTIONS = Object.freeze({ headerRow: true, totalRow: false, bandedRows: true, firstColumn: true, lastColumn: false, bandedColumns: false });

const line = (color = 'auto', size = 4, style = 'single') => ({ style, size, color, space: 0 });
const NONE = { style: 'nil', size: 0, color: 'auto', space: 0 };
const ACCENTS = [
  ['Blue', '2F5F98', 'D9E3F0', 'B4C7E2'], ['Orange', 'C55A11', 'FBE4D5', 'F4B183'], ['Green', '4E7D3A', 'E2EFD9', 'A9D18E'],
  ['Gray', '595959', 'EDEDED', 'BFBFBF'], ['Gold', 'B48900', 'FFF2CC', 'FFD966'], ['Purple', '6A3F8F', 'E6DDF0', 'C7B3DD'],
];

/** cell: { row, column, rows, columns, header, total, firstColumn, lastColumn, band } → { borders, fill, bold, color } */
const designs = [
  { id: 'plain-grid', name: 'Plain Grid', format: () => ({ borders: { top: line(), left: line(), bottom: line(), right: line() }, fill: null }) },
  { id: 'light-grid', name: 'Light Grid', format: c => ({ borders: { top: line('BFBFBF'), left: line('BFBFBF'), bottom: line(c.header ? '7F7F7F' : 'BFBFBF', c.header ? 12 : 4), right: line('BFBFBF') }, fill: null, bold: c.header || c.total || c.firstColumn || c.lastColumn }) },
  { id: 'rules', name: 'Horizontal Rules', format: c => ({
    borders: { top: c.row === 0 || c.total ? line('000000', 8) : NONE, left: NONE, right: NONE, bottom: c.header || c.row === c.rows - 1 ? line('000000', 8) : NONE },
    fill: null, bold: c.header || c.total || c.firstColumn || c.lastColumn }) },
  { id: 'light-list', name: 'Light List', format: c => ({
    borders: { top: c.row === 0 ? line('7F7F7F', 8) : NONE, left: NONE, right: NONE, bottom: c.header ? line('7F7F7F', 8) : c.row === c.rows - 1 ? line('7F7F7F', 8) : NONE },
    fill: c.band ? 'F2F2F2' : null, bold: c.header || c.total || c.firstColumn || c.lastColumn }) },
  ...ACCENTS.map(([label, dark, light, mid]) => ({ id: `banded-${label.toLowerCase()}`, name: `Banded ${label}`, format: c => ({
    borders: { top: line(mid), left: line(mid), bottom: line(mid), right: line(mid) },
    fill: c.header ? dark : c.band ? light : null, bold: c.header || c.total || c.firstColumn || c.lastColumn, color: c.header ? 'FFFFFF' : null }) })),
  ...ACCENTS.slice(0, 3).map(([label, dark, light]) => ({ id: `header-${label.toLowerCase()}`, name: `Header ${label}`, format: c => ({
    borders: { top: c.row === 0 ? line(dark, 8) : NONE, left: NONE, right: NONE, bottom: c.header ? line(dark, 12) : c.row === c.rows - 1 ? line(dark, 8) : line(light, 4) },
    fill: null, bold: c.header || c.total || c.firstColumn || c.lastColumn, color: c.header ? dark : null }) })),
];
export const TABLE_DESIGNS = Object.freeze(designs);

/** The place of every cell in a table's grid, with the options' regions resolved. */
export function cellPlaces(table, options = DEFAULT_TABLE_OPTIONS) {
  const owners = verticalMerges(table), rows = table.rows.length, columns = table.grid.length, places = [];
  table.rows.forEach((row, rowIndex) => {
    for (const { cell, column, span } of rowGrid(row)) {
      const owner = owners.get(cell.id), endRow = owner.endRow ?? rowIndex;
      const header = options.headerRow && rowIndex === 0, total = options.totalRow && endRow === rows - 1 && rows > 1;
      const firstColumn = options.firstColumn && column === 0, lastColumn = options.lastColumn && column + span === columns && columns > 1;
      const bodyRow = rowIndex - (options.headerRow ? 1 : 0);
      const band = !header && !total && (options.bandedRows && bodyRow >= 0 && bodyRow % 2 === 0 || options.bandedColumns && column % 2 === 0);
      places.push({ cell, owner: owner.cell, row: rowIndex, column, span, rows, columns, header, total, firstColumn, lastColumn, band });
    }
  });
  return places;
}

/**
 * Apply a design to the table containing the selection, in one undo step: every cell side gets an
 * explicit border (or none), fills are set or cleared, and header/total/first/last column text is bolded
 * or colored as the design asks. Returns whether anything changed.
 */
export function applyTableDesign(model, designId, options = DEFAULT_TABLE_OPTIONS) {
  const design = TABLE_DESIGNS.find(d => d.id === designId);
  if (!design) throw new Error('Choose a table design.');
  const context = model.tableContext; if (!context) throw new Error('Put the cursor in a table to apply a design.');
  const table = context.table, places = cellPlaces(table, options);
  // Text formatting the previous design applied is undone where this one does not apply it, so a body
  // cell keeps the user's own bold and color.
  const previous = table.design && TABLE_DESIGNS.find(d => d.id === table.design.id);
  const before = new Map(previous ? cellPlaces(table, table.design.options).map(place => [place.cell.id, previous.format(place)]) : []);
  const { anchor, focus } = model.selection;
  model.checkpoint();
  const textFormats = [];
  for (const place of places) {
    const look = design.format(place), cell = place.cell, old = before.get(cell.id) || {};
    const borders = checkedCellBorders(look.borders);
    cell.directBorders = { ...cell.directBorders, ...borders }; cell.borderChanges = { ...cell.borderChanges, ...structuredClone(borders) };
    cell.borders = resolveCellBorders(cell.inheritedBorders, cell.directBorders);
    const shading = look.fill ? checkedShading(look.fill) : null;
    if (shading || cell.shadingExplicit) {
      cell.shading = shading ?? cell.inheritedShading ?? 'auto'; cell.fill = cellShadingFill(cell.shading);
      cell.shadingExplicit = !!shading; cell.shadingNil = false; cell.shadingChanged = true;
    }
    const patch = {};
    if (look.bold) patch.bold = true; else if (old.bold) patch.bold = false;
    if (look.color) patch.color = look.color; else if (old.color) patch.color = 'auto';
    if (Object.keys(patch).length) textFormats.push({ cellId: cell.id, patch });
  }
  model.didChange();
  // Text formatting goes through the run operation, per cell, so styles and links stay intact.
  for (const { cellId, patch } of textFormats) {
    const index = model.paragraphs.findIndex(p => p.cellId === cellId);
    if (index < 0) continue;
    let last = index;
    while (model.paragraphs[last + 1]?.cellId === cellId) last++;
    const start = model.paragraphOffset(index), end = model.paragraphOffset(last) + paragraphText(model.paragraphs[last]).length;
    if (start === end) continue;
    model.select(start, end);
    try { model.setRunFormat(patch); } catch { /* a cell with only pictures takes no text formatting */ }
  }
  model.select(anchor, focus);
  table.design = { id: designId, options: { ...options } };
  return true;
}
