import { el } from '../ui/dom.js';
import { openModal } from '../ui/modal.js';
import { PAPER_SIZES, validatePageSettings } from '../engine/page-settings.js';

/** Keep untouched measurements exact, including imported paper sizes rounded by other producers. */
export function openPageSetup(settings, apply) {
  const inputs = {}, originals = {};
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const write = (key, twips) => {
    const text = String(Number((twips / 1440).toFixed(5)));
    inputs[key].value = text;
    originals[key] = { text, twips };
  };
  const read = key => inputs[key].value === originals[key].text ? originals[key].twips : Math.round(Number(inputs[key].value) * 1440);
  const orientation = el('select.input', { 'aria-label': 'Page orientation', onchange: () => {
    const w = read('width'), h = read('height');
    write('width', h); write('height', w);
  } }, ...['portrait', 'landscape'].map(value => el('option', { value, selected: value === settings.orientation }, value[0].toUpperCase() + value.slice(1))));
  const paper = el('select.input', { 'aria-label': 'Paper size', onchange: () => {
    const size = PAPER_SIZES[paper.value];
    if (!size) return;
    const [w, h] = orientation.value === 'landscape' ? [...size].reverse() : size;
    write('width', w); write('height', h);
  } }, ...[...Object.keys(PAPER_SIZES), 'Custom'].map(value => el('option', { value }, value)));
  paper.value = Object.entries(PAPER_SIZES).find(([, dims]) => {
    const [w, h] = settings.orientation === 'landscape' ? [...dims].reverse() : dims;
    return Math.abs(w - settings.width) <= 2 && Math.abs(h - settings.height) <= 2;
  })?.[0] || 'Custom';
  const fields = [['width', 'Width'], ['height', 'Height'], ['top', 'Top margin'], ['bottom', 'Bottom margin'], ['left', 'Left margin'], ['right', 'Right margin'], ['gutter', 'Gutter']].map(([key, label]) => {
    inputs[key] = el('input.input', { type: 'number', required: true, step: 'any', min: ['top', 'bottom'].includes(key) ? -22 : ['width', 'height'].includes(key) ? 1 : 0, max: 22, 'aria-label': `${label} (in)`, oninput: () => {
      if (['width', 'height'].includes(key)) paper.value = 'Custom';
    } });
    write(key, settings[key]);
    return el('label.field', {}, el('span.field-label', {}, `${label} (in)`), inputs[key]);
  });
  const content = el('form', { onsubmit: e => {
    e.preventDefault();
    try {
      const next = validatePageSettings({ ...settings, ...Object.fromEntries(Object.keys(inputs).map(key => [key, read(key)])), orientation: orientation.value });
      if (apply(next) === false) throw new Error('These page settings cannot fit the current text. Adjust the margins or page size.');
      modal.close();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  } },
  el('div.canvas-page-fields', {},
    el('label.field', {}, el('span.field-label', {}, 'Paper size'), paper),
    el('label.field', {}, el('span.field-label', {}, 'Orientation'), orientation), fields),
  ...((settings.bookFoldPrinting || settings.bookFoldRevPrinting) ? [el('p.field-hint', {}, 'Booklet printing is preserved. Width and height describe each reading page. Without a top gutter, landscape booklets alternate margins and add the gutter to the saved right margin.')] : []),
  el('p.field-hint', {}, `Applies to the whole document. Gutter adds space at the ${settings.gutterAtTop ? 'top' : 'left'}. Negative top/bottom margins retain their saved sign and use the same distance from the page edge.`),
  error,
  el('div.row.row-end', {},
    el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
    el('button.btn.btn-primary', { type: 'submit' }, 'Apply')));
  const modal = openModal({ title: 'Page setup', content, onClose: () => {
    const root = modal.panel.closest('.modal-root');
    root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
  } });
  return modal;
}
