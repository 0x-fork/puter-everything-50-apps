import { MAX_DOCUMENT_CHARACTERS } from '../engine/text-limits.js';
import { el, isComposing } from '../ui/dom.js';
import { iconEl } from '../ui/icons.js';

export function findReplacePanel(api) {
  const query = el('input.input', { 'aria-label': 'Find text', type: 'text', spellcheck: false, maxLength: MAX_DOCUMENT_CHARACTERS });
  const replacement = el('input.input', { 'aria-label': 'Replace with', type: 'text', spellcheck: false, maxLength: MAX_DOCUMENT_CHARACTERS });
  const matchCase = el('input', { type: 'checkbox' }), wholeWord = el('input', { type: 'checkbox' });
  const count = el('span.canvas-find-count', { role: 'status', 'aria-live': 'polite' });
  const notice = el('p.canvas-find-notice', { role: 'status', 'aria-live': 'polite' });
  const error = el('p.field-error', { role: 'alert', hidden: true });
  const options = () => ({ matchCase: matchCase.checked, wholeWord: wholeWord.checked });
  const action = (label, icon, run) => el('button.icon-btn', { type: 'button', 'aria-label': label, title: label, onclick: run }, iconEl(icon, 18));
  const previous = action('Previous match', 'arrowUp', () => navigate(-1)), next = action('Next match', 'arrowDown', () => navigate(1));
  const replace = el('button.btn', { type: 'button', onclick: () => change(false) }, 'Replace');
  const all = el('button.btn', { type: 'button', onclick: () => change(true) }, 'Replace all');
  const close = () => { if (node.hidden) return; node.hidden = true; api.highlight?.([]); api.close(); };
  const node = el('section.canvas-find', { role: 'search', 'aria-label': 'Find and replace', hidden: true, onkeydown: e => {
    if (e.key === 'Escape' && !isComposing(e)) { e.preventDefault(); e.stopPropagation(); close(); }
  } }, el('div.canvas-find-heading', {}, el('strong', {}, 'Find and replace'), action('Close find and replace', 'x', close)),
  el('label.canvas-find-field', {}, el('span', {}, 'Find'), query),
  el('div.canvas-find-row', {}, el('label', {}, matchCase, 'Match case'), el('label', {}, wholeWord, 'Whole words')),
  el('div.canvas-find-row', {}, count, previous, next),
  el('label.canvas-find-field', {}, el('span', {}, 'Replace with'), replacement),
  el('div.canvas-find-row.canvas-find-actions', {}, el('span.field-hint', {}, 'Enter: next · Shift+Enter: previous'), replace, all), notice, error);
  function refresh() {
    if (node.hidden) { api.highlight?.([]); return { matches: [], current: -1 }; }
    let matches = [];
    try { matches = api.matches(query.value, options()); error.hidden = true; }
    catch (e) { error.textContent = e.message; error.hidden = false; }
    api.highlight?.(matches);
    const [start, end] = api.range(), current = matches.findIndex(m => m.start === start && m.end === end);
    count.textContent = !query.value ? 'Enter text to find' : !matches.length ? 'No matches' : current < 0 ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : `${current + 1} of ${matches.length}`;
    previous.disabled = next.disabled = !matches.length;
    replacement.disabled = !!api.readOnly?.();
    all.disabled = replacement.disabled || !matches.length;
    replace.disabled = replacement.disabled || current < 0;
    return { matches, current };
  }
  function navigate(direction = 0) {
    const { matches, current } = refresh(); if (!matches.length) return;
    const [start] = api.range(); let index;
    if (direction && current >= 0) index = (current + direction + matches.length) % matches.length;
    else if (direction < 0) { index = matches.findLastIndex(m => m.start < start); if (index < 0) index = matches.length - 1; }
    else { index = matches.findIndex(m => m.start >= start); if (index < 0) index = 0; }
    api.select(matches[index]); refresh();
  }
  function change(every) {
    try {
      const total = api.replace(query.value, replacement.value, options(), every);
      if (!every) navigate(1); else refresh();
      notice.textContent = `Replaced ${total} ${total === 1 ? 'match' : 'matches'}.`; error.hidden = true;
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  }
  for (const input of [query, matchCase, wholeWord]) input.addEventListener('input', e => { if (!e.isComposing) { notice.textContent = ''; navigate(); } });
  query.addEventListener('compositionend', () => { notice.textContent = ''; navigate(); });
  query.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); } });
  replacement.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); if (!replace.disabled) change(false); } });
  return { node, refresh, close, open(selected = '') {
    if (node.hidden && selected && !/[\u0000-\u001f\ufffc]/u.test(selected)) query.value = selected;
    node.hidden = false; notice.textContent = ''; navigate(); query.focus(); query.select();
  } };
}
