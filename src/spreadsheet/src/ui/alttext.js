/**
 * Alt Text (an object's right-click menu ▸ Edit Alt Text…, or Review ▸ Alt Text): the description a
 * screen reader gives for a picture, chart or text box, or Mark as decorative for artwork that carries
 * no meaning. Saved as the drawing's description (cNvPr@descr) and decorative extension in XLSX.
 */
import { el } from './dom.js';
import { openModal } from './modal.js';

export const ALT_TEXT_MAX = 2000;

export function openAltTextDialog(ctx, chartId) {
  const obj = ctx.wb.chartById(ctx.sheetId(), chartId);
  if (!obj) return null;
  const current = obj.description ?? (obj.type === 'image' ? obj.title : '') ?? '';
  const text = el('textarea.input.alt-text-input', { rows: 5, maxlength: ALT_TEXT_MAX, 'aria-label': 'Alt text description', placeholder: 'Describe this for someone who can\'t see it' });
  text.value = current || '';
  const decorative = el('input', { type: 'checkbox' });
  decorative.checked = obj.decorative === true;
  const sync = () => { text.disabled = decorative.checked; };
  decorative.addEventListener('change', sync);
  sync();
  const submit = (e) => {
    e?.preventDefault();
    const description = text.value.trim().slice(0, ALT_TEXT_MAX);
    ctx.wb.updateChart(ctx.sheetId(), chartId, decorative.checked ? { decorative: true } : { decorative: false, description }, 'Edit alt text');
    modal.close();
  };
  const content = el('form', { onsubmit: submit },
    el('p.small.muted', {}, 'How would you describe this object and its context to someone who is blind or has low vision?'),
    text,
    el('label.find-option', {}, decorative, el('span', {}, 'Mark as decorative')),
    el('p.small.muted', {}, 'Decorative objects add visual interest but aren\'t informative (for example, stylistic borders). People using screen readers will hear that these are decorative.'),
    el('div.row.row-end', {},
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
      el('button.btn.btn-primary', { type: 'submit' }, 'OK')));
  const modal = openModal({ title: 'Alt Text', content, initialFocus: text, onClose: () => ctx.grid?.focus?.() });
  return modal;
}
