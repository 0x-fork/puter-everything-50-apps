/**
 * Page Break Preview: where each printed page of a sheet begins and ends, from the sheet's page setup
 * (paper, orientation, margins, scale or fit to pages), its print area or used range, and the sizes of
 * its rows and columns, laid out as the print path lays them out (printBands).
 */
import { PRINT_DEFAULTS, sheetPrintPrefs, printableWidth, printableHeight } from './print.js';
import { printBands } from './print-pagination.js';

/** { area, rows: [[r1, r2]...], cols: [[c1, c2]...], order } for a sheet, or null when there is nothing to print. */
export function pageBreaks(wb, sheetId) {
  const sheet = wb.sheet(sheetId);
  if (!sheet || sheet.kind === 'chart') return null;
  const prefs = { ...PRINT_DEFAULTS, ...sheetPrintPrefs(sheet) };
  const area = sheet.printSettings?.areas?.[0] || wb.usedRange(sheetId);
  if (!area) return null;
  const rowSizes = [], colSizes = [];
  for (let r = area.r1; r <= area.r2; r++) rowSizes.push(sheet.hiddenRows.has(r) || sheet.filterHidden.has(r) ? 0 : wb.rowHeight(sheetId, r));
  for (let c = area.c1; c <= area.c2; c++) colSizes.push(sheet.hiddenCols.has(c) ? 0 : wb.colWidth(sheetId, c));
  const width = printableWidth(prefs), height = printableHeight(prefs);
  const totalW = colSizes.reduce((a, b) => a + b, 0), totalH = rowSizes.reduce((a, b) => a + b, 0);
  // The print scale: a fixed percentage, actual size, or the largest that fits the pages asked for.
  let scale = 1;
  if (prefs.fit === 'scale') scale = (Number(prefs.scale) || 100) / 100;
  else if (prefs.fit === 'width') scale = Math.min(1, width / Math.max(1, totalW));
  else if (prefs.fit === 'pages') {
    const w = Number(prefs.fitWidth) > 0 ? (width * prefs.fitWidth) / Math.max(1, totalW) : Infinity;
    const h = Number(prefs.fitHeight) > 0 ? (height * prefs.fitHeight) / Math.max(1, totalH) : Infinity;
    scale = Math.min(1, w, h);
  }
  scale = Math.max(0.1, scale);
  const bands = (sizes, capacity, from) => (printBands(sizes, capacity)?.bands || [{ start: 0, end: sizes.length }])
    .filter((b) => b.end > b.start).map((b) => [from + b.start, from + b.end - 1]);
  return { area: { ...area }, rows: bands(rowSizes, height / scale, area.r1), cols: bands(colSizes, width / scale, area.c1), order: prefs.pageOrder || 'downThenOver' };
}

/** The pages in print order, each { r1, c1, r2, c2, n }. */
export function pagesOf(breaks) {
  if (!breaks) return [];
  const out = [];
  let n = 1;
  if (breaks.order === 'overThenDown') {
    for (const [r1, r2] of breaks.rows) for (const [c1, c2] of breaks.cols) out.push({ r1, r2, c1, c2, n: n++ });
  } else {
    for (const [c1, c2] of breaks.cols) for (const [r1, r2] of breaks.rows) out.push({ r1, r2, c1, c2, n: n++ });
  }
  return out;
}
