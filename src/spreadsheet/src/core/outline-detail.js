/**
 * Data ▸ Outline ▸ Show Detail / Hide Detail: expand or collapse the outline group at the active
 * cell. Hide Detail collapses the innermost open group holding the cell, or the one whose summary
 * line (the line just after it) the cell is on; Show Detail opens the outermost closed group whose
 * summary line the cell is on (or that holds it), one level at a time, as the outline buttons do.
 */

function pick(wb, sheetId, axis, index, show) {
  const groups = wb.outlineGroups(sheetId, axis).filter((g) => (show ? g.collapsed : !g.collapsed));
  const holding = groups.filter((g) => g.from <= index && g.to >= index);
  const summary = groups.filter((g) => g.to + 1 === index);
  const pool = show ? (summary.length ? summary : holding) : (holding.length ? holding : summary);
  if (!pool.length) return null;
  return pool.reduce((best, g) => (show ? g.level < best.level : g.level > best.level) ? g : best);
}

/**
 * The group Show Detail (show = true) or Hide Detail would act on for a selection: { axis, from, to }
 * or null. Whole columns selected work on column groups; otherwise row groups first, then columns.
 */
export function detailGroup(wb, sheetId, { active, wholeColumns = false }, show) {
  const axes = wholeColumns ? ['col'] : ['row', 'col'];
  for (const axis of axes) {
    const g = pick(wb, sheetId, axis, axis === 'row' ? active.r : active.c, show);
    if (g) return { axis, from: g.from, to: g.to };
  }
  return null;
}

/** Show or hide detail at the selection; false when there is no outline group there. */
export function toggleDetail(wb, sheetId, selection, show) {
  const g = detailGroup(wb, sheetId, selection, show);
  if (!g) return false;
  wb.toggleGroup(sheetId, g.axis, g.from, g.to);
  return true;
}
