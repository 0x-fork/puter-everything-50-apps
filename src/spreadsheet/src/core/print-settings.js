/** Worksheet page setup, independent of browser/account print preferences. */
import { MAX_ROW, MAX_COL } from './refs.js';

export const PRINT_MARGINS = { left: .7, right: .7, top: .75, bottom: .75, header: .3, footer: .3 };
const TOKENS = { page: 'P', pages: 'N', date: 'D', time: 'T', tab: 'A', file: 'F' };
const nativeText = text => text.replace(/&&|&\[(page|pages|date|time|tab|file)\]/gi, (match, name) => name ? `&${TOKENS[name.toLowerCase()]}` : match).slice(0, 255);

export function normalizePrintSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  const margins = Object.fromEntries(Object.entries(PRINT_MARGINS).map(([key, fallback]) => [key, number(raw.margins?.[key], fallback, 0, 100)]));
  const areas = (Array.isArray(raw.areas) ? raw.areas : []).slice(0, 1024).filter(r => r &&
    ['r1', 'r2', 'c1', 'c2'].every(k => Number.isInteger(r[k])) && r.r1 >= 0 && r.c1 >= 0 &&
    r.r2 >= r.r1 && r.c2 >= r.c1 && r.r2 <= MAX_ROW && r.c2 <= MAX_COL).map(({ r1, c1, r2, c2 }) => ({ r1, c1, r2, c2 }));
  const titles = {};
  for (const [key, max] of [['titleRows', MAX_ROW], ['titleCols', MAX_COL]]) {
    const range = raw[key];
    if (Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0] && range[1] <= max) titles[key] = [...range];
  }
  return { areas, ...titles, margins, pageOrder: raw.pageOrder === 'overThenDown' ? 'overThenDown' : 'downThenOver', orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    // An omitted paper size uses the reader's locale/printer default, which need not
    // equal an explicit Letter selection (MS-OI29500 §2.1.638(h)). Preserve it.
    paperSize: raw.paperSize == null ? null : Math.trunc(number(raw.paperSize, 1, 1, 118)), scale: number(raw.scale, 100, 10, 400),
    // SpreadsheetML uses unsignedInt, including zero. Retain a dormant start
    // value when automatic numbering is selected.
    firstPageNumber: Number.isInteger(raw.firstPageNumber) ? number(raw.firstPageNumber, 1, 0, 4294967295) : 1,
    useFirstPageNumber: raw.useFirstPageNumber === true,
    fitToPage: raw.fitToPage === true, fitWidth: Math.trunc(number(raw.fitWidth, 1, 0, 32767)), fitHeight: Math.trunc(number(raw.fitHeight, 1, 0, 32767)),
    horizontalCentered: raw.horizontalCentered === true, verticalCentered: raw.verticalCentered === true,
    gridlines: raw.gridlines === true, headings: raw.headings === true,
    differentFirst: raw.differentFirst === true, differentOddEven: raw.differentOddEven === true,
    alignWithMargins: raw.alignWithMargins !== false,
    scaleWithDoc: raw.scaleWithDoc !== false,
    ...Object.fromEntries(['header', 'footer', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter']
      .filter(key => typeof raw[key] === 'string').map(key => [key, nativeText(raw[key])])),
    ...(typeof raw.title === 'boolean' ? { title: raw.title } : {}),
    ...(typeof raw.repeatFrozen === 'boolean' ? { repeatFrozen: raw.repeatFrozen } : {}) };
}

/** Structural edits keep the saved print areas attached to their cells. */
export function mapPrintAreas(sheet, map, axis) {
  if (!sheet.printSettings) return;
  const p = { ...sheet.printSettings, areas: sheet.printSettings.areas.map(map).filter(Boolean) };
  // Title ranges are whole lines: an edit on the other axis cannot change them.
  const key = axis === 'row' ? 'titleRows' : 'titleCols', range = p[key];
  if (range) {
    const moved = map(axis === 'row' ? { r1: range[0], r2: range[1], c1: 0, c2: MAX_COL }
      : { c1: range[0], c2: range[1], r1: 0, r2: MAX_ROW });
    p[key] = moved ? axis === 'row' ? [moved.r1, moved.r2] : [moved.c1, moved.c2] : null;
  }
  sheet.printSettings = normalizePrintSettings(p);
}
