/**
 * Simple tables: a grid of plain-text cells with an optional header row.
 * The whole table is one value on its block, saved shortly after typing.
 */
import { h, debounce, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as P from '../data/page.js';
import { openMenu } from '../ui/menu.js';

const MAX = 50;

const shapeOf = (data) => `${data.rows.length}x${data.rows[0].length}${data.header ? 'h' : ''}`;

function normalize(table) {
  const rows = Array.isArray(table?.rows) && table.rows.length ? table.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [['']];
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return { rows: rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? '')), header: table?.header !== false };
}

export function renderTable(editor, main, b) {
  const ro = editor.readOnly;
  const data = normalize(b.table);
  // Same shape as what is shown: update cell text in place, so the cell
  // being typed in keeps its caret (saving re-renders the block).
  const existing = main.querySelector('table.wiki-table');
  if (existing && existing.dataset.shape === shapeOf(data) && existing.dataset.ro === String(ro)) {
    const base = main._base || data;
    data.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        const cell = existing.rows[r]?.cells[c];
        // Cells typed in here and not saved yet keep what was typed.
        const typedHere = cell && cell.textContent !== base.rows[r]?.[c];
        if (cell && cell !== document.activeElement && !typedHere && cell.textContent !== text) cell.textContent = text;
      }),
    );
    // Typed cells keep their old base so the save still sees them as changed.
    main._base = { ...data, rows: data.rows.map((row, r) => row.map((text, c) => (existing.rows[r]?.cells[c]?.textContent !== base.rows[r]?.[c] ? base.rows[r][c] : text))) };
    return;
  }
  // A typed change not saved yet is saved before the table is rebuilt.
  main._save?.flush();
  // Saving writes only the cells typed in here onto the latest table, so
  // what others changed meanwhile (rows, other cells) is kept.
  const save = debounce(() => {
    if (!editor.blocks.has(b.id)) return;
    const base = main._base || data;
    const latest = normalize(editor.block(b.id)?.table);
    const typed = read();
    let changed = false;
    typed.rows.forEach((row, r) =>
      row.forEach((text, c) => {
        if (text !== base.rows[r]?.[c] && latest.rows[r] && c < latest.rows[r].length && latest.rows[r][c] !== text) {
          latest.rows[r][c] = text;
          changed = true;
        }
      }),
    );
    if (changed) P.setBlock(editor.doc, b.id, { table: latest });
  }, 500);
  main._save = save;
  main._base = data;
  const cellFocused = main.contains(document.activeElement) ? [document.activeElement.dataset.r, document.activeElement.dataset.c] : null;
  const table = h('table.wiki-table', { role: 'grid', 'aria-label': 'Table', 'data-shape': shapeOf(data), 'data-ro': String(ro) });
  data.rows.forEach((row, r) => {
    const tr = h('tr');
    row.forEach((text, c) => {
      const header = data.header && r === 0;
      const cell = h(header ? 'th' : 'td', { contenteditable: ro ? 'false' : 'true', 'data-r': r, 'data-c': c, role: header ? 'columnheader' : 'gridcell', tabindex: ro ? '-1' : null, spellcheck: 'true' });
      cell.textContent = text;
      cell.addEventListener('input', save);
      cell.addEventListener('keydown', (e) => key(e, r, c));
      cell.addEventListener('contextmenu', (e) => {
        if (ro) return;
        e.preventDefault();
        menu(cell, r, c);
      });
      tr.append(cell);
    });
    table.append(tr);
  });
  const read = () => ({
    rows: [...table.rows].map((tr) => [...tr.cells].map((td) => td.textContent.replace(/\n/g, ' ').slice(0, 2000))),
    header: data.header,
  });
  const commit = (next, focus) => {
    save.cancel();
    P.setBlock(editor.doc, b.id, { table: next });
    if (focus) queueMicrotask(() => main.querySelector(`[data-r="${focus[0]}"][data-c="${focus[1]}"]`)?.focus());
  };
  const addRow = (at) => {
    const cur = read();
    if (cur.rows.length >= MAX) return;
    cur.rows.splice(at, 0, cur.rows[0].map(() => ''));
    commit(cur, [at, 0]);
  };
  const addCol = (at) => {
    const cur = read();
    if (cur.rows[0].length >= 20) return;
    for (const row of cur.rows) row.splice(at, 0, '');
    commit(cur, [0, at]);
  };
  const key = (e, r, c) => {
    const cur = read();
    const rows = cur.rows.length;
    const cols = cur.rows[0].length;
    const go = (rr, cc) => main.querySelector(`[data-r="${rr}"][data-c="${cc}"]`)?.focus();
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = r * cols + c + (e.shiftKey ? -1 : 1);
      if (i >= rows * cols && !e.shiftKey) return addRow(rows);
      if (i >= 0) go(Math.floor(i / cols), i % cols);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 < rows) go(r + 1, c);
      else addRow(rows);
    } else if (e.key === 'ArrowDown' && r + 1 < rows) {
      e.preventDefault();
      go(r + 1, c);
    } else if (e.key === 'ArrowUp' && r > 0) {
      e.preventDefault();
      go(r - 1, c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      save.flush?.();
      editor.selectBlocks([b.id]);
    }
  };
  const menu = (anchor, r, c) => {
    openMenu(anchor, [
      { label: 'Insert row above', icon: 'arrowUp', run: () => addRow(r) },
      { label: 'Insert row below', icon: 'arrowDown', run: () => addRow(r + 1) },
      { label: 'Insert column left', icon: 'arrowLeft', run: () => addCol(c) },
      { label: 'Insert column right', icon: 'arrowRight', run: () => addCol(c + 1) },
      { type: 'sep' },
      { label: 'Header row', checked: data.header, run: () => commit({ ...read(), header: !data.header }) },
      { type: 'sep' },
      { label: 'Delete row', icon: 'trash', danger: true, disabled: data.rows.length <= 1, run: () => {
          const cur = read();
          cur.rows.splice(r, 1);
          commit(cur, [Math.max(0, r - 1), c]);
        } },
      { label: 'Delete column', icon: 'trash', danger: true, disabled: data.rows[0].length <= 1, run: () => {
          const cur = read();
          for (const row of cur.rows) row.splice(c, 1);
          commit(cur, [r, Math.max(0, c - 1)]);
        } },
    ], { label: 'Table cell' });
  };
  const controls = ro
    ? null
    : h(
        'div.table-controls',
        h('button.btn.small.ghost', { type: 'button', onclick: () => addRow(read().rows.length) }, icon('plus', 14), 'Row'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => addCol(read().rows[0].length) }, icon('plus', 14), 'Column'),
        h('button.btn.small.ghost', { type: 'button', 'aria-label': 'Table options', onclick: (e) => {
            const cell = main.querySelector('td:focus, th:focus');
            menu(e.currentTarget, Number(cell?.dataset.r ?? 0), Number(cell?.dataset.c ?? 0));
          } }, icon('more', 14)),
      );
  fill(main, h('div.table-scroll', table), controls);
  if (cellFocused) main.querySelector(`[data-r="${cellFocused[0]}"][data-c="${cellFocused[1]}"]`)?.focus();
}
