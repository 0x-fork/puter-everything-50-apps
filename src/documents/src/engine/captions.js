// Captions and cross-references as DOCX fields express them: a caption is a paragraph
// "<Label> <SEQ Label>" (§17.16.5.56); a cross-reference is a REF or PAGEREF
// field (§17.16.5.51, §17.16.5.45) pointing at a hidden _Ref bookmark.
import { bodyFieldRanges } from './body-fields.js';
import { bookmarkEntries, newBookmarkMarkers } from './bookmarks.js';
import { outlineEntries } from './outline.js';
import { hyperlinkId } from './hyperlinks.js';
import { newBodyField } from './toc.js';
import { sequenceInstruction, updateSequenceFields } from './field-update.js';

export const CAPTION_LABELS = ['Figure', 'Table', 'Equation'];
const length = p => p.runs.reduce((n, r) => n + r.text.length, 0);
const offsetOf = (doc, index) => { let at = 0; for (let i = 0; i < index; i++) at += length(doc.paragraphs[i]) + 1; return at; };
let order = 2e6;
const paragraphAt = (doc, position) => { let i = 0, pos = 0; while (i < doc.paragraphs.length - 1 && pos + length(doc.paragraphs[i]) < position) pos += length(doc.paragraphs[i++]) + 1; return i; };

function addFieldMarkers(p, field, start, end, link) {
  (p.fieldMarkers ||= []).push({ type: 'start', field, offset: start, order: order++, ...(link ? { link } : {}) }, { type: 'end', field, offset: end, order: order++, ...(link ? { link } : {}) });
}

/** Insert a caption paragraph below (or above) the selected picture, the table at the caret, or the current paragraph. */
export function insertCaption(doc, { label = 'Figure', text = '', above = false } = {}) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(label)) throw new Error('Use a label of letters and numbers, such as Figure or Table.');
  let index;
  if (doc.tableContext && !doc.selectedImage) {
    doc.insertTableParagraph(!above);
    index = paragraphAt(doc, doc.range[0]);
  } else {
    const at = doc.range[0];
    let i = 0, pos = 0;
    while (i < doc.paragraphs.length - 1 && pos + length(doc.paragraphs[i]) < at) pos += length(doc.paragraphs[i++]) + 1;
    if (above) { doc.select(pos); doc.replaceUntracked('\n', { checkpoint: false }); index = i; }
    else { doc.select(pos + length(doc.paragraphs[i])); doc.replaceUntracked('\n', { checkpoint: false }); index = i + 1; }
  }
  const start = offsetOf(doc, index);
  doc.select(start, start + length(doc.paragraphs[index]));
  const styles = doc.styles?.definitions || {};
  const caption = Object.values(styles).find(s => s.type === 'paragraph' && s.name?.toLowerCase() === 'caption')?.id;
  if (caption) doc.setParagraphStyle(caption);
  else if (doc.styles?.defaultParagraph) doc.setParagraphStyle(doc.styles.defaultParagraph);
  const body = `${label} 1${text ? `${/^[\s:.\-–—]/.test(text) ? '' : ': '}${text}` : ''}`;
  doc.select(start);
  doc.replaceUntracked(body, { checkpoint: false });
  if (!caption) { doc.select(start, start + body.length); doc.setRunFormat({ italic: true, fontSize: 9, color: '44546A' }); doc.setParagraphFormat({ spaceBefore: 0, spaceAfter: 10, keepNext: above }); }
  const p = doc.paragraphs[index];
  addFieldMarkers(p, newBodyField(` SEQ ${label} \\* ARABIC `, { simple: true }), label.length + 1, label.length + 2);
  doc.hasBodyFields = true;
  bodyFieldRanges(doc.paragraphs);
  updateSequenceFields(doc);
  const after = offsetOf(doc, index) + length(doc.paragraphs[index]);
  doc.select(after);
  doc.didChange();
  return index;
}

/** What can be cross-referenced: headings, captions and named bookmarks. */
export function referenceTargets(doc) {
  const text = doc.text, ranges = bodyFieldRanges(doc.paragraphs);
  const headings = outlineEntries(doc.paragraphs).filter(e => e.text !== '(Empty heading)').map(e => ({ kind: 'heading', label: e.text, start: e.start, end: e.end, paragraphId: e.id }));
  const captions = [];
  for (const r of ranges) {
    if (r.field.type !== 'SEQ') continue;
    const seq = sequenceInstruction(r.field.instruction);
    if (!seq) continue;
    const pIndex = doc.paragraphs.findIndex(p => p.id === r.startParagraph), start = offsetOf(doc, pIndex);
    const whole = text.slice(start, start + length(doc.paragraphs[pIndex]));
    captions.push({ kind: seq.id, label: whole.trim(), start, end: r.end, numberLabel: text.slice(start, r.end), paragraphId: r.startParagraph });
  }
  const bookmarks = bookmarkEntries(doc.paragraphs, doc.tables).filter(b => !b.name.startsWith('_')).map(b => ({ kind: 'bookmark', label: b.name, name: b.name, start: b.start, end: b.end }));
  return { headings, captions, bookmarks };
}

function refBookmark(doc, target) {
  if (target.name) return target.name;
  const existing = bookmarkEntries(doc.paragraphs, doc.tables).find(b => /^_Re?f/.test(b.name) && b.start === target.start && b.end === target.end);
  if (existing) return existing.name;
  const names = new Set(bookmarkEntries(doc.paragraphs, doc.tables).map(b => b.name));
  let name; do name = `_Ref${String(100000000 + Math.floor(Math.random() * 899999999))}`; while (names.has(name));
  const markers = newBookmarkMarkers(doc.paragraphs, name);
  const pIndex = doc.paragraphs.findIndex(p => p.id === target.paragraphId), base = offsetOf(doc, pIndex), p = doc.paragraphs[pIndex];
  (p.bookmarks ||= []).push({ ...markers[0], offset: target.start - base }, { ...markers[1], offset: target.end - base });
  return name;
}

/** Insert a REF (text) or PAGEREF (page number) cross-reference at the caret, as a hyperlink. */
export function insertCrossReference(doc, target, { show = 'text' } = {}) {
  const name = refBookmark(doc, target);
  const type = show === 'page' ? 'PAGEREF' : 'REF';
  const placeholder = show === 'page' ? '1' : (target.numberLabel || target.label || name);
  const at = doc.range[0];
  doc.replaceUntracked(placeholder, { checkpoint: false });
  let i = 0, pos = 0;
  while (i < doc.paragraphs.length - 1 && pos + length(doc.paragraphs[i]) < at) pos += length(doc.paragraphs[i++]) + 1;
  const link = { anchor: name, id: hyperlinkId() };
  doc.changeHyperlink(at, at + placeholder.length, link);
  addFieldMarkers(doc.paragraphs[i], newBodyField(` ${type} ${name} \\h `), at - pos, at - pos + placeholder.length, link);
  doc.hasBodyFields = true;
  bodyFieldRanges(doc.paragraphs);
  doc.select(at + placeholder.length);
  doc.didChange();
  return name;
}
