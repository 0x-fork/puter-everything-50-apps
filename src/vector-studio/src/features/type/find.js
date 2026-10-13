/**
 * Edit > Find and Replace across the document's text objects. Matches are
 * shown by editing the text object with the match selected.
 */
import { h } from '../../lib/dom.js';
import { replaceRange } from '../../model/text-runs.js';

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All matches of `query` in `text`: [{ start, end }]. */
export function findMatches(text, query, { matchCase = false, wholeWord = false } = {}) {
  if (!query) return [];
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${escapeRe(query)}(?![\\p{L}\\p{N}_])` : escapeRe(query), `g${matchCase ? '' : 'i'}u`);
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function textNodes(doc, { includeLocked = false, includeHidden = false } = {}) {
  return doc.leaves().filter((n) => n.type === 'text' && (includeLocked || !doc.isLocked(n.id)) && (includeHidden || !doc.isHidden(n.id)));
}

/** The last Find and Replace settings, so Edit > Find Next can repeat the search. */
export const lastFind = { query: '', replace: '', matchCase: false, wholeWord: false, includeLocked: false, includeHidden: false, current: null };

function showMatch(app, m) {
  lastFind.current = m;
  const tool = app.getTool('type');
  if (app.toolId !== 'type') app.setTool('type');
  const sess = tool.editText(m.id, null);
  sess?.setSelection(m.start, m.end);
}

/**
 * Select the next match of the last query after the current match (or the
 * caret), wrapping around the document. Returns 'found', 'none' or 'empty'
 * (no query or no text objects).
 */
export function findNext(app) {
  const ed = app.editor;
  const q = lastFind.query;
  if (!ed || !q) return 'empty';
  const nodes = textNodes(ed.doc, lastFind);
  if (!nodes.length) return 'empty';
  const sess = app.typeSession && !app.typeSession.ended ? app.typeSession : null;
  let current = lastFind.current;
  // A match the caret has since moved away from no longer anchors the search.
  if (current && sess && (sess.id !== current.id || sess.range()[0] !== current.start)) current = null;
  const startNode = Math.max(0, nodes.findIndex((n) => n.id === (current?.id || sess?.id)));
  const from = current ? current.end : sess ? sess.range()[1] : 0;
  const opts = { matchCase: lastFind.matchCase, wholeWord: lastFind.wholeWord };
  for (let k = 0; k <= nodes.length; k++) {
    const n = nodes[(startNode + k) % nodes.length];
    // The starting object is searched after the caret first, and before it last (after wrapping).
    const ms = findMatches(n.text, q, opts).filter((m) => (k === 0 ? m.start >= from : k < nodes.length || m.end <= from));
    if (ms.length) {
      showMatch(app, { id: n.id, ...ms[0] });
      return 'found';
    }
  }
  lastFind.current = null;
  return 'none';
}

export function openFindReplace(app) {
  const ed = app.editor;
  if (!ed) return;
  const s = app.typeSession;
  const selected = s && !s.ended ? s.selectedText() : '';
  const findIn = h('input', { type: 'text', id: 'fr-find', value: selected || lastFind.query, autocomplete: 'off', spellcheck: false });
  const replIn = h('input', { type: 'text', id: 'fr-repl', value: lastFind.replace, autocomplete: 'off', spellcheck: false });
  const caseBox = h('input', { type: 'checkbox', id: 'fr-case', checked: lastFind.matchCase });
  const wordBox = h('input', { type: 'checkbox', id: 'fr-word', checked: lastFind.wholeWord });
  const lockedBox = h('input', { type: 'checkbox', id: 'fr-locked', checked: lastFind.includeLocked });
  const hiddenBox = h('input', { type: 'checkbox', id: 'fr-hidden', checked: lastFind.includeHidden });
  const status = h('p.fr-status', { role: 'status', 'aria-live': 'polite' });
  lastFind.current = null;

  const opts = () => ({ matchCase: caseBox.checked, wholeWord: wordBox.checked });
  const nodeOpts = () => ({ includeLocked: lockedBox.checked, includeHidden: hiddenBox.checked });
  const sync = () => Object.assign(lastFind, { query: findIn.value, replace: replIn.value, ...opts(), ...nodeOpts() });

  const doFind = () => {
    sync();
    const r = findNext(app);
    status.textContent = r === 'found' ? '' : r === 'none' ? 'No matches found.' : findIn.value ? 'No text objects to search.' : 'Enter text to find.';
    return r === 'found';
  };

  const replace = () => {
    sync();
    const current = lastFind.current;
    if (!current) return false;
    const n = ed.doc.get(current.id);
    if (!n) return false;
    const found = n.text.slice(current.start, current.end);
    const ok = findMatches(found, findIn.value, opts()).length > 0;
    if (!ok) return false;
    ed.doc.transact('Replace', () => ed.doc.update(n.id, replaceRange(n, current.start, current.end, replIn.value)));
    lastFind.current = { ...current, end: current.start + replIn.value.length };
    app.typeSession?.setSelection(lastFind.current.start, lastFind.current.end);
    return true;
  };

  const replaceAll = () => {
    sync();
    const q = findIn.value;
    if (!q) return;
    let count = 0;
    app.getTool('type')?.endEditing?.({ select: false });
    ed.doc.transact('Replace All', () => {
      for (const n0 of textNodes(ed.doc, nodeOpts())) {
        let n = ed.doc.get(n0.id);
        const ms = findMatches(n.text, q, opts());
        for (let i = ms.length - 1; i >= 0; i--) {
          n = { ...n, ...replaceRange(n, ms[i].start, ms[i].end, replIn.value) };
          count++;
        }
        if (ms.length) ed.doc.update(n.id, { text: n.text, runs: n.runs, paras: n.paras, char: n.char, fill: n.fill, stroke: n.stroke, strokeWidth: n.strokeWidth });
      }
    });
    lastFind.current = null;
    status.textContent = count ? `Replaced ${count} ${count === 1 ? 'match' : 'matches'}.` : 'No matches found.';
  };

  const btn = (label, fn) => h('button.btn', { type: 'button', onclick: fn }, label);
  const body = h(
    'div.find-replace',
    h('div.form-row', h('label', { for: 'fr-find' }, 'Find'), findIn),
    h('div.form-row', h('label', { for: 'fr-repl' }, 'Replace With'), replIn),
    h(
      'div.fr-checks',
      h('div.form-row.check', caseBox, h('label', { for: 'fr-case' }, 'Match Case')),
      h('div.form-row.check', wordBox, h('label', { for: 'fr-word' }, 'Find Whole Word')),
      h('div.form-row.check', lockedBox, h('label', { for: 'fr-locked' }, 'Check Locked Layers')),
      h('div.form-row.check', hiddenBox, h('label', { for: 'fr-hidden' }, 'Check Hidden Layers')),
    ),
    h(
      'div.fr-actions',
      btn('Find Next', doFind),
      btn('Replace', () => {
        if (!replace()) doFind();
      }),
      btn('Replace & Find', () => {
        replace();
        doFind();
      }),
      btn('Replace All', replaceAll),
    ),
    status,
  );
  findIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      doFind();
    }
  });
  for (const el of [findIn, replIn, caseBox, wordBox, lockedBox, hiddenBox]) el.addEventListener('change', sync);
  return app.dialogs.open({ title: 'Find and Replace', body, className: 'find-replace-dialog', buttons: [{ label: 'Done', value: true, primary: true }] });
}
