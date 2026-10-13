/**
 * References and page furniture: table of contents, headers and footers that do not exist yet,
 * and page numbers, offered on the Insert and References tabs. Engine
 * code loads on demand, like the rest of the editor's engine.
 */
import { openMenu } from '../ui/menu.js';
import { openModal } from '../ui/modal.js';
import { el } from '../ui/dom.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A page field record for header/footer stories, as the DOCX reader produces one. */
async function pageField(type) {
  const { pageFieldSegments } = await import('../engine/docx-page-fields.js');
  const root = new DOMParser().parseFromString(`<w:p xmlns:w="${W}"><w:fldSimple w:instr=" ${type} "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>`, 'application/xml').documentElement;
  const [segment] = pageFieldSegments(root);
  return { ...segment.field, cachedText: '1' };
}

export function createReferences({ editor, pkg, error, base = {}, onChange = () => {} }) {
  const ready = () => { const engine = editor(); return engine && !pkg()?.readOnly ? engine : null; };
  const fail = e => { error(e); editor()?.focus(); };

  /** Which header/footer variant a page shows: first, even or default (§17.10.5). */
  function variantFor(engine, page) {
    const definition = engine.pageStories, section = engine.sectionOfPage(page);
    const firstPage = engine.layout.pageSections?.indexOf(section) ?? 0;
    if (page === firstPage && definition?.sections[section]?.firstPageDifferent) return 'first';
    return definition?.evenAndOdd && (page + 1) % 2 === 0 ? 'even' : 'default';
  }
  const currentPage = engine => engine.session.path !== null ? engine.storyPage ?? 0 : engine.caretPageIndex ?? 0;

  /** The editable header/footer story of `kind` for the current page, creating it (in the right variant) when missing. */
  async function story(kind, page = null) {
    const engine = ready(); if (!engine) return null;
    engine.finishComposition();
    page ??= currentPage(engine);
    const section = engine.sectionOfPage(page), variant = variantFor(engine, page);
    const existing = engine.pageStories?.sections[section]?.[kind]?.[variant];
    if (existing) {
      if (!engine.pageStories.stories[existing]?.editable) throw new Error(`This document's ${kind} cannot be edited yet.`);
      engine.editStory(existing, page); return existing;
    }
    const { TextDocument, paragraph } = await import('../engine/model.js');
    const body = engine.session.body;
    const styleId = Object.values(body.styles.definitions || {}).find(s => s.type === 'paragraph' && s.name?.toLowerCase() === kind)?.id;
    const draft = new TextDocument([paragraph('', styleId ? { styleId } : {})], body.pageSettings, body.numbering, body.styles, [], body.assets);
    const path = pkg().addPageStory(kind, { variant, section });
    engine.attachPageStory(path, kind, draft.paragraphs, { variant, section });
    engine.onChange();
    engine.editStory(path, page);
    return path;
  }
  async function setStoryOption(option, on) {
    try {
      const engine = ready(); if (!engine) return;
      const kind = activeStoryKind(), page = currentPage(engine), section = engine.sectionOfPage(page);
      if (option === 'first') { pkg().setTitlePage(section, on); engine.setStoryOptions({ section, firstPageDifferent: on }); }
      else { pkg().setEvenAndOdd(on); engine.setStoryOptions({ evenAndOdd: on }); }
      engine.onChange();
      if (kind === 'header' || kind === 'footer') await story(kind, page);
      onChange();
    } catch (e) { fail(e); }
  }

  async function editHeader(kind) {
    try { await story(kind); } catch (e) { fail(e); }
  }

  async function insertPageNumber(where, alignment, style = 'plain') {
    try {
      const engine = ready(); if (!engine) return;
      if (where !== 'current') await story(where === 'top' ? 'header' : 'footer');
      else if (engine.session.path === null) throw new Error('Page numbers can be inserted in a header or footer. Double-click the top or bottom of a page, or use Top of Page or Bottom of Page.');
      const [page, total] = await Promise.all([pageField('PAGE'), pageField('NUMPAGES')]);
      engine.execute(() => {
        const model = engine.model;
        if (where !== 'current') {
          if (model.text.trim()) { model.select(model.text.length); model.replace('\n'); }
          else model.select(0, model.text.length);
          model.setParagraphFormat({ alignment });
        }
        if (style === 'pageOf') { model.replace('Page '); model.insertFieldRun(page); model.replace(' of '); model.insertFieldRun(total); }
        else model.insertFieldRun(page);
        return true;
      });
      engine.focus();
    } catch (e) { fail(e); }
  }

  function pageNumberItems() {
    const placements = where => ['left', 'center', 'right'].flatMap(alignment => [
      { label: `Plain Number ${alignment === 'left' ? '1' : alignment === 'center' ? '2' : '3'} (${alignment[0].toUpperCase() + alignment.slice(1)})`, onSelect: () => insertPageNumber(where, alignment) },
    ]).concat([{ separator: true }, { label: 'Page X of Y', onSelect: () => insertPageNumber(where, 'center', 'pageOf') }]);
    return [
      { label: 'Top of Page', items: placements('top') },
      { label: 'Bottom of Page', items: placements('bottom') },
      { label: 'Current Position', disabled: editor()?.session.path === null, items: [{ label: 'Plain Number', onSelect: () => insertPageNumber('current') }, { label: 'Page X of Y', onSelect: () => insertPageNumber('current', null, 'pageOf') }] },
    ];
  }

  /* ---- Table of contents ---- */
  async function withBody(action) {
    const engine = ready(); if (!engine) return;
    engine.finishComposition();
    if (engine.session.path !== null) engine.editStory(null);
    const [toc, refresh] = await Promise.all([import('../engine/toc.js'), import('../engine/page-reference-refresh.js')]);
    const body = engine.session.body, tracking = body.trackChanges;
    body.trackChanges = false;
    try {
      engine.execute(() => {
        const result = action(body, toc);
        refresh.refreshPageReferences(body, model => engine.layoutModel(model), engine.pageStories, { checkpoint: false });
        return result;
      });
    } finally { body.trackChanges = tracking; }
    engine.focus(); onChange();
  }
  const insertToc = title => withBody((body, toc) => toc.insertTableOfContents(body, { title, existing: toc.tableOfContents(body.paragraphs) }));
  const hasToc = () => (editor()?.session.body.paragraphs || []).some(p => p.fieldMarkers?.some(m => m.field.type === 'TOC'));

  /* ---- Footnotes ---- */
  async function insertFootnote() {
    try {
      const engine = ready(); if (!engine) return;
      engine.finishComposition();
      if (engine.session.path !== null) {
        if (engine.pageStories?.stories[engine.session.path]?.kind === 'footnote') throw new Error('Footnotes cannot contain other footnotes.');
        engine.editStory(null);
      }
      const { TextDocument, paragraph } = await import('../engine/model.js');
      const body = engine.session.body, styles = body.styles.definitions || {};
      const named = (type, name) => Object.values(styles).find(s => s.type === type && s.name?.toLowerCase() === name)?.id;
      const textStyle = named('paragraph', 'footnote text'), referenceStyle = named('character', 'footnote reference');
      const note = pkg().addFootnote();
      if (!engine.execute(() => body.insertFootnoteReference(note.id))) return;
      // The note opens with its own number mark, then a space, as existing documents start one.
      const draft = new TextDocument([paragraph('', textStyle ? { styleId: textStyle } : {})], body.pageSettings, body.numbering, body.styles, [], body.assets);
      const { footnoteOpeningRuns } = await import('../engine/footnotes.js');
      draft.paragraphs[0].runs = footnoteOpeningRuns(draft.typingRun(0), referenceStyle);
      if (!textStyle) { draft.select(0, 2); draft.setRunFormat({ fontSize: 10 }); draft.setParagraphFormat({ spaceBefore: 0, spaceAfter: 0, lineRule: 'auto', lineSpacing: 1 }); }
      engine.attachPageStory(note.path, 'footnote', draft.paragraphs, { footnotes: note.settings, story: { noteId: note.id } });
      const area = engine.layout.footnoteAreas?.find(a => a.notes.some(n => n.path === note.path));
      engine.editStory(note.path, area?.page ?? 0);
      engine.model.select(engine.model.text.length);
      engine.focus(); engine.revealCaret?.(); onChange();
    } catch (e) { fail(e); }
  }

  /* ---- Captions, cross-references and field updates ---- */
  async function bodyAction(action) {
    const engine = ready(); if (!engine) return false;
    engine.finishComposition();
    if (engine.session.path !== null) engine.editStory(null);
    const [captions, refresh] = await Promise.all([import('../engine/captions.js'), import('../engine/page-reference-refresh.js')]);
    const ok = engine.execute(() => {
      const result = action(engine.session.body, captions);
      refresh.refreshPageReferences(engine.session.body, model => engine.layoutModel(model), engine.pageStories, { checkpoint: false });
      return result;
    });
    engine.focus(); onChange(); return ok;
  }
  async function updateAllFields() {
    const { updateSequenceFields } = await import('../engine/field-update.js');
    const issues = [];
    await bodyAction(body => { updateSequenceFields(body, { onIssue: issue => issues.push(issue) }); return true; });
    if (issues.length) error(new Error([...new Set(issues.map(issue => issue.message))].join(' ')));
  }
  function captionDialog() {
    const engine = ready(); if (!engine) return;
    const { CAPTION_LABELS } = { CAPTION_LABELS: ['Figure', 'Table', 'Equation'] };
    const label = el('select.input', { 'aria-label': 'Label' }, ...CAPTION_LABELS.map(l => el('option', { value: l }, l)));
    label.value = engine.model.tableContext ? 'Table' : 'Figure';
    const text = el('input.input', { type: 'text', 'aria-label': 'Caption text', placeholder: 'Optional description' });
    const position = el('select.input', { 'aria-label': 'Position' }, el('option', { value: 'below' }, 'Below selected item'), el('option', { value: 'above' }, 'Above selected item'));
    const preview = el('p.field-hint');
    const sync = () => { preview.textContent = `${label.value} N${text.value ? `: ${text.value}` : ''}`; };
    label.addEventListener('change', sync); text.addEventListener('input', sync); sync();
    let modal;
    const field = (name, control) => el('label.field', {}, el('span.field-label', {}, name), control);
    modal = openModal({ title: 'Caption', onClose: () => queueMicrotask(() => editor()?.focus()), content: el('form.ed-dialog-body', { onsubmit: e => {
      e.preventDefault(); modal.close();
      bodyAction((body, captions) => captions.insertCaption(body, { label: label.value, text: text.value.trim(), above: position.value === 'above' }));
    } }, field('Caption text', text), preview, field('Label', label), field('Position', position),
    el('div.modal-actions', {}, el('button.btn.btn-outline', { type: 'button', onclick: () => modal.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'submit' }, 'OK'))) });
    text.focus();
  }
  async function crossReferenceDialog() {
    const engine = ready(); if (!engine) return;
    if (engine.session.path !== null) engine.editStory(null);
    const { referenceTargets } = await import('../engine/captions.js');
    const targets = referenceTargets(engine.session.body);
    const kinds = [['heading', 'Heading', targets.headings], ...[...new Set(targets.captions.map(c => c.kind))].map(k => [k, k, targets.captions.filter(c => c.kind === k)]), ['bookmark', 'Bookmark', targets.bookmarks]];
    const type = el('select.input', { 'aria-label': 'Reference type' }, ...kinds.map(([id, name]) => el('option', { value: id }, name)));
    const show = el('select.input', { 'aria-label': 'Insert reference to' });
    const list = el('select.input.ed-xref-list', { 'aria-label': 'For which item', size: 8 });
    const fill = () => {
      const kind = kinds.find(k => k[0] === type.value), caption = !['heading', 'bookmark'].includes(type.value);
      show.replaceChildren(el('option', { value: 'text' }, caption ? 'Only label and number' : type.value === 'heading' ? 'Heading text' : 'Bookmark text'), el('option', { value: 'page' }, 'Page number'));
      list.replaceChildren(...kind[2].map((item, i) => el('option', { value: String(i) }, item.label)));
      if (kind[2].length) list.value = '0';
      insert.disabled = !kind[2].length;
    };
    const insert = el('button.btn.btn-primary', { type: 'submit' }, 'Insert');
    type.addEventListener('change', fill);
    let modal;
    const field = (name, control) => el('label.field', {}, el('span.field-label', {}, name), control);
    modal = openModal({ title: 'Cross-reference', onClose: () => queueMicrotask(() => editor()?.focus()), content: el('form.ed-dialog-body', { onsubmit: e => {
      e.preventDefault();
      const target = kinds.find(k => k[0] === type.value)[2][Number(list.value)];
      if (!target) return;
      modal.close();
      bodyAction((body, captions) => { captions.insertCrossReference(body, target, { show: show.value }); return true; });
    } }, field('Reference type', type), field('Insert reference to', show), field('For which item', list),
    el('div.modal-actions', {}, el('button.btn.btn-outline', { type: 'button', onclick: () => modal.close() }, 'Cancel'), insert)) });
    fill(); type.focus();
  }
  function extendTab(tabId, kit) {
    if (tabId !== 'references') return [];
    const caption = kit.command('Insert Caption', 'caption', () => captionDialog(), { size: 'large', text: 'Insert Caption' });
    const xref = kit.command('Cross-reference', 'crossReference', () => crossReferenceDialog(), { text: 'Cross-reference' });
    const update = kit.command('Update Fields', 'updateFields', () => updateAllFields(), { text: 'Update Fields', shortcut: 'F9' });
    for (const b of [caption, xref, update]) { b.addEventListener('mousedown', e => e.preventDefault()); kit.when(b, () => !!ready()); }
    return [{ id: 'captions', label: 'Captions', icon: 'caption', priority: 4, after: 'footnotes', items: [caption, kit.rows([xref], [update])] }];
  }

  const commands = {
    insertFootnote,
    canInsertFootnote: () => !!ready() && editor()?.session.path === null,
    canEditHeader: () => !!ready(),
    editHeader,
    canInsertPageNumber: () => !!ready(),
    insertPageNumber(event, button) {
      const anchor = button || document.querySelector('#ribbon-panel-insert button[aria-label="Page Number"]') || document.activeElement;
      // A menu the mouse opened closes back into the document; one the keyboard opened returns to its button.
      openMenu({ anchor, label: 'Page Number', minWidth: 220, items: pageNumberItems(), pointer: !!event?.detail, onClose: event?.detail ? () => editor()?.focus() : null });
    },
    pageNumberItems,
    tocItems: () => [
      { header: 'Built-In' },
      { label: 'Automatic Table 1', hint: 'Contents', icon: 'toc', disabled: !ready(), onSelect: () => insertToc('Contents') },
      { label: 'Automatic Table 2', hint: 'Table of Contents', icon: 'toc', disabled: !ready(), onSelect: () => insertToc('Table of Contents') },
      { separator: true },
      { label: 'Update Table', disabled: !ready() || !hasToc(), onSelect: () => commands.updateFields() },
      { label: 'Remove Table of Contents', disabled: !ready() || !hasToc(), onSelect: () => withBody((body, toc) => toc.removeTableOfContents(body)) },
    ],
    canUpdateFields: () => !!ready() && (hasToc() || !!base.canUpdateFields?.()),
    updateFields() {
      if (!hasToc()) { base.updateFields?.(); return; }
      withBody((body, toc) => {
        const existing = toc.tableOfContents(body.paragraphs);
        if (existing?.whole) return toc.insertTableOfContents(body, { existing });
        return true; // Page numbers still refresh below.
      });
    },
  };
  /* ---- Contextual Header & Footer tab, shown while a header or footer is active ---- */
  const activeStoryKind = () => { const engine = editor(); return engine?.session.path ? engine.pageStories?.stories[engine.session.path]?.kind : null; };
  function contextTabs(kit) {
    const { command, rows, when, menuButton, commandIconEl } = kit;
    const IN = 1440;
    const header = command('Header', 'header', () => editHeader('header'), { size: 'large' });
    const footer = command('Footer', 'footer', () => editHeader('footer'), { size: 'large' });
    const pageNumber = menuButton('Page Number', 'pageNumber', pageNumberItems);
    const goHeader = command('Go to Header', 'goToHeader', () => editHeader('header'), { text: 'Go to Header' });
    const goFooter = command('Go to Footer', 'goToFooter', () => editHeader('footer'), { text: 'Go to Footer' });
    const close = command('Close Header and Footer', 'close', () => { const engine = editor(); if (engine) { engine.editStory(null); engine.focus(); onChange(); } }, { size: 'large', text: 'Close Header and Footer' });
    close.classList.add('ribbon-wide'); // 'Close Header and Footer' in two lines
    for (const b of [header, footer, goHeader, goFooter, close]) b.addEventListener('mousedown', e => e.preventDefault());
    when(goHeader, () => activeStoryKind() !== 'header'); when(goFooter, () => activeStoryKind() !== 'footer');
    const distance = (key, label) => {
      const input = document.createElement('input');
      Object.assign(input, { type: 'number', step: 0.05, min: 0, max: 22, className: 'canvas-spacing ribbon-number' });
      input.setAttribute('aria-label', `${label} (in)`);
      input.addEventListener('change', () => {
        const engine = ready(); if (!engine || !input.checkValidity() || input.value === '') { input.reportValidity(); return; }
        try { engine.finishComposition(); engine.setPageSettings({ [key]: Math.round(Number(input.value) * IN) }); } catch (e) { fail(e); }
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.dispatchEvent(new Event('change')); editor()?.focus(); } });
      when(input, () => !!ready());
      kit.states?.push?.({ control: input, enabled: () => !!ready(), value: () => Math.round((editor()?.session.body.pageSettings[key] ?? 720) / IN * 100) / 100 });
      const wrap = document.createElement('label'); wrap.className = 'ribbon-spin'; wrap.title = label;
      wrap.append(commandIconEl(key === 'header' ? 'spaceBefore' : 'spaceAfter', 16), Object.assign(document.createElement('span'), { className: 'ribbon-spin-label', textContent: label }), input, Object.assign(document.createElement('span'), { className: 'ribbon-spin-unit', textContent: 'in' }));
      input.value = String(Math.round((editor()?.session.body.pageSettings[key] ?? 720) / IN * 100) / 100);
      return { wrap, input };
    };
    const top = distance('header', 'Header from Top'), bottom = distance('footer', 'Footer from Bottom');
    const spinGroup = Object.assign(document.createElement('div'), { className: 'ribbon-spin-group' });
    spinGroup.append(top.wrap, bottom.wrap);
    const definition = () => editor()?.pageStories;
    const firstPage = kit.check('Different First Page', () => !!definition()?.sections[editor()?.sectionOfPage(currentPage(editor())) ?? 0]?.firstPageDifferent, on => setStoryOption('first', on));
    const oddEven = kit.check('Different Odd & Even Pages', () => !!definition()?.evenAndOdd, on => setStoryOption('evenOdd', on));
    const sync = () => { const p = editor()?.session.body.pageSettings; if (!p) return; for (const [d, key] of [[top, 'header'], [bottom, 'footer']]) if (document.activeElement !== d.input) d.input.value = String(Math.round(p[key] / IN * 100) / 100); };
    when(close, () => { sync(); return true; });
    return [{ id: 'headerFooter', label: 'Header & Footer', contextual: 'headerFooter', selectOnAppear: true, groups: [
      { id: 'hfHeaderFooter', label: 'Header & Footer', icon: 'header', priority: 6, items: [header, footer, pageNumber] },
      { id: 'hfNavigation', label: 'Navigation', icon: 'next', priority: 4, items: [rows([goHeader], [goFooter])] },
      { id: 'hfOptions', label: 'Options', icon: 'header', priority: 7, items: [rows([firstPage], [oddEven])] },
      { id: 'hfPosition', label: 'Position', icon: 'margins', priority: 5, items: [spinGroup] },
      { id: 'hfClose', label: 'Close', icon: 'close', priority: 9, items: [close] },
    ] }];
  }

  // Cmd+Option+F on a Mac, Ctrl+Alt+F elsewhere.
  const keyAbort = new AbortController();
  window.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || !e.target?.matches?.('.canvas-input')) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    if (e.code === 'KeyF' && e.altKey && !e.shiftKey && (mac ? e.metaKey : e.ctrlKey)) { e.preventDefault(); insertFootnote(); }
    else if (e.key === 'F9' && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); updateAllFields(); }
  }, { signal: keyAbort.signal });
  return { commands, contextTabs, extendTab, activeStoryKind, updateAllFields, destroy: () => keyAbort.abort() };
}
