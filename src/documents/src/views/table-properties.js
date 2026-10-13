import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';

export function openTableProperties(table, displayedWidths, selectedColumn, apply) {
  // A rejected edit restores the model; retain the original baseline for a retry.
  table = structuredClone(table);
  const decimal = n => String(Number(n.toFixed(5)));
  const field = (label, input) => el('label.field', {}, el('span.field-label', {}, label), input);
  const select = (label, values, value) => el('select.input', { 'aria-label': label }, ...values.map(([id, text]) => el('option', { value: id, selected: id === value }, text)));
  const layout = select('Table layout', [['autofit', 'AutoFit'], ['fixed', 'Fixed widths']], table.layout);
  const originalType = ['dxa', 'pct'].includes(table.width?.type) ? table.width.type : 'auto';
  const type = select('Table width unit', [['auto', 'Automatic'], ['dxa', 'Inches'], ['pct', 'Percent']], originalType);
  const originalWidth = decimal(originalType === 'pct' ? table.width.value / 50 : originalType === 'dxa' ? table.width.value / 1440 : displayedWidths.reduce((a,b) => a+b, 0) / 1440);
  const width = el('input.input', { type: 'number', step: 'any', min: .01, required: true, 'aria-label': 'Preferred table width', value: originalWidth, disabled: originalType === 'auto' });
  type.addEventListener('change', () => { width.disabled = type.value === 'auto'; width.value = type.value === 'pct' ? '100' : decimal(displayedWidths.reduce((a,b) => a+b, 0) / 1440); });
  const rowAlignments = new Set(table.rows.map(row => row.alignment ?? table.alignment));
  const originalAlignment = rowAlignments.size === 1 ? [...rowAlignments][0] : 'mixed';
  const alignment = select('Table alignment', [...(originalAlignment === 'mixed' ? [['mixed', 'Mixed']] : []), ['left', 'Left'], ['center', 'Center'], ['right', 'Right']], originalAlignment);
  if (originalAlignment === 'mixed') alignment.querySelector('option[value="mixed"]').disabled = true;
  const originalIndent = decimal(table.indent / 1440), indent = el('input.input', { type: 'number', step: 'any', min: -22, max: 22, required: true, 'aria-label': 'Table indent (in)', value: originalIndent, disabled: originalAlignment !== 'left' });
  alignment.addEventListener('change', () => { indent.disabled = alignment.value !== 'left'; });
  const initialColumns = table.grid.map((w, i) => decimal((w || displayedWidths[i]) / 1440)), values = [...initialColumns];
  const column = select('Table column', table.grid.map((_, i) => [String(i), String(i + 1)]), String(selectedColumn));
  const columnWidth = el('input.input', { type: 'number', min: 0, max: 22, step: 'any', required: true, 'aria-label': 'Column width (in)', value: values[selectedColumn] });
  columnWidth.addEventListener('input', () => { values[Number(column.value)] = columnWidth.value; });
  column.addEventListener('change', () => { columnWidth.value = values[Number(column.value)]; });
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    const patch = {};
    if (layout.value !== table.layout) patch.layout = layout.value;
    if (alignment.value !== originalAlignment) patch.alignment = alignment.value;
    if (indent.value !== originalIndent) patch.indent = Math.round(Number(indent.value) * 1440);
    if (type.value !== originalType || type.value !== 'auto' && width.value !== originalWidth) patch.width = { type: type.value, value: type.value === 'auto' ? 0 : type.value === 'pct' ? Number(width.value) * 50 : Math.round(Number(width.value) * 1440) };
    if (values.some((v, i) => v !== initialColumns[i]) || patch.layout === 'fixed' && table.grid.some(w => !w)) {
      // Round measured fallback widths up so a single grapheme still fits after fixing the grid.
      patch.columns = values.map((v, i) => v === initialColumns[i] ? table.grid[i] || Math.ceil(displayedWidths[i]) : Math.round(Number(v) * 1440));
      patch.width ||= table.width || { type: 'auto', value: 0 };
    }
    if (apply(patch) !== false) modal.close();
    else { error.textContent = 'These settings cannot fit the table. Adjust its width, columns or indentation.'; error.hidden = false; }
  } }, el('div.canvas-page-fields', {}, field('Layout', layout), field('Alignment', alignment), field('Width unit', type), field('Preferred width', width), field('Indent (in)', indent), field('Column', column), field('Column width (in)', columnWidth)),
  el('p.field-hint', {}, 'Widths are preferences. AutoFit can adjust them to fit the cell text.' + (table.parentCellId ? ' Percent widths use the containing cell’s writing width. Nested tables do not repeat their own header rows; imported header flags are preserved until removed.' : '')), error,
  el('div.row.row-end', {}, el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Table properties', content }); return modal;
}
