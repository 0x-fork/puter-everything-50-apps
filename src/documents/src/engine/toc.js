// Generated table of contents (ECMA-376 Part 1 §17.16.5.68 TOC, §17.16.5.45
// PAGEREF). Entries are built from outline levels: each
// heading gets a hidden _Toc bookmark, each entry links to it, and its page
// number is a PAGEREF result refreshed from the current layout.
import { outlineEntries } from './outline.js';
import { bodyFieldRanges } from './body-fields.js';
import { bookmarkEntries, newBookmarkMarkers } from './bookmarks.js';
import { bodyFieldInstruction } from './docx-body-fields.js';
import { pageFieldSegments } from './docx-page-fields.js';
import { hyperlinkId } from './hyperlinks.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const length = p => p.runs.reduce((n, r) => n + r.text.length, 0);
const attr = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
let fieldCount = 0;

export const TOC_INSTRUCTION = ' TOC \\o "1-3" \\h \\z \\u ';
export const TOC_TITLES = { contents: 'Contents', table: 'Table of Contents' };

/** A new body field record, as the reader would produce for a w:fldSimple with this instruction. */
export function newBodyField(instruction, { simple = false } = {}) {
  const root = new DOMParser().parseFromString(`<w:p xmlns:w="${W}"><w:fldSimple w:instr="${attr(instruction)}"/></w:p>`, 'application/xml').documentElement;
  const [segment] = pageFieldSegments(root, bodyFieldInstruction);
  if (!segment?.field) throw new Error('Invalid field instruction.');
  return { ...segment.field, id: `newField${++fieldCount}`, ...(simple ? { simple: true } : {}) };
}

/** The first TOC field in the document with its paragraph span, or null. */
export function tableOfContents(paragraphs) {
  const range = bodyFieldRanges(paragraphs).find(r => r.field.type === 'TOC');
  if (!range) return null;
  const first = paragraphs.findIndex(p => p.id === range.startParagraph), last = paragraphs.findIndex(p => p.id === range.endParagraph);
  let at = 0; for (let i = 0; i < first; i++) at += length(paragraphs[i]) + 1;
  let end = at; for (let i = first; i <= last; i++) end += length(paragraphs[i]) + (i < last ? 1 : 0);
  // Only a TOC whose result fills whole paragraphs can be rebuilt in place.
  const whole = range.start === at && range.end === end;
  return { ...range, first, last, whole, paragraphStart: at, paragraphEnd: end };
}

/** Headings for the table: outline levels 1..levels, excluding text inside an existing TOC result. */
export function tocHeadings(paragraphs, levels = 3, exclude = null) {
  return outlineEntries(paragraphs).filter(e => e.level <= levels && e.text !== '(Empty heading)' && !(exclude && e.start >= exclude.start && e.start <= exclude.end));
}

function tocBookmark(paragraphs, tables, heading) {
  const existing = bookmarkEntries(paragraphs, tables).find(b => /^_Toc/.test(b.name) && b.startParagraph === heading.id && b.start === heading.start && b.end === heading.end);
  if (existing) return existing.name;
  const names = new Set(bookmarkEntries(paragraphs, tables).map(b => b.name));
  let name;
  do name = `_Toc${String(100000000 + Math.floor(Math.random() * 899999999))}`; while (names.has(name));
  const markers = newBookmarkMarkers(paragraphs, name), p = paragraphs.find(item => item.id === heading.id);
  (p.bookmarks ||= []).push({ ...markers[0], offset: 0 }, { ...markers[1], offset: length(p) });
  return name;
}

/**
 * Insert a table of contents at the caret (or replace `existing`) in `doc` (a TextDocument).
 * Call inside one editor transaction; page numbers start as "1" until refreshed.
 */
export function insertTableOfContents(doc, { title = TOC_TITLES.contents, levels = 3, existing = null } = {}) {
  let insertAt;
  if (existing) {
    if (!existing.whole) throw new Error('This table of contents shares its paragraphs with other text, so it cannot be rebuilt. Its page numbers can still be updated.');
    // Empty the old result but keep one of its paragraphs, so neither neighbour
    // takes on the table's paragraph formatting. Its fields go with it.
    insertAt = existing.paragraphStart;
    doc.select(existing.paragraphStart, existing.paragraphEnd);
    doc.replaceUntracked('', { checkpoint: false, removedBodyFields: fieldsWithin(doc, existing.start, existing.end) });
  } else {
    const [start] = doc.range;
    let at = 0, index = 0;
    while (index < doc.paragraphs.length - 1 && at + length(doc.paragraphs[index]) < start) at += length(doc.paragraphs[index++]) + 1;
    const p = doc.paragraphs[index];
    if (p.cellId) throw new Error('Insert a table of contents outside a table.');
    insertAt = at;
    if (start > at) { doc.select(start); doc.replaceUntracked('\n', { checkpoint: false }); insertAt = start + 1; }
  }
  // Bookmarks first: they are paragraph-relative, so inserting the table does not move them.
  const headings = tocHeadings(doc.paragraphs, levels);
  const entries = headings.map(h => ({ ...h, name: tocBookmark(doc.paragraphs, doc.tables, h) }));
  const lines = [...(title && !existing ? [title] : []), ...(entries.length ? entries.map(e => `${e.text}\t1`) : ['No table of contents entries found.'])];
  doc.select(insertAt);
  doc.replaceUntracked(lines.join('\n') + (existing ? '' : '\n'), { checkpoint: false });
  let index = 0, at = 0;
  while (at < insertAt) at += length(doc.paragraphs[index++]) + 1;
  const firstIndex = index;
  const styles = doc.styles?.definitions || {};
  const styleFor = name => Object.values(styles).find(s => s.type === 'paragraph' && s.name?.toLowerCase() === name.toLowerCase())?.id;
  const select = i => { let s = 0; for (let k = 0; k < i; k++) s += length(doc.paragraphs[k]) + 1; doc.select(s, s + length(doc.paragraphs[i])); return s; };
  const normal = doc.styles?.defaultParagraph || null;
  let row = firstIndex;
  if (title && !existing) {
    select(row);
    const heading = styleFor('TOC Heading');
    if (heading || normal) doc.setParagraphStyle(heading || normal);
    if (!heading) { doc.setRunFormat({ fontSize: 16, color: '2F5496' }); doc.setParagraphFormat({ spaceBefore: 12, spaceAfter: 6, keepNext: true }); }
    row++;
  }
  const width = Math.max(1440, doc.sectionWritingWidth);
  const order = (() => { let n = 1e6; return () => n++; })();
  const toc = newBodyField(TOC_INSTRUCTION), startOrder = order();
  const tocRows = [];
  for (const entry of entries.length ? entries : [null]) {
    const start = select(row);
    const style = entry && styleFor(`TOC ${entry.level}`) || normal;
    if (style && doc.paragraphStyle !== style) doc.setParagraphStyle(style);
    doc.setParagraphFormat({ indentLeft: entry ? (entry.level - 1) * 220 : 0, firstLine: 0, spaceBefore: 0, spaceAfter: 5, tabs: [{ position: Math.round(width), alignment: 'right', leader: 'dot' }] });
    if (entry) {
      const link = { anchor: entry.name, id: hyperlinkId() };
      doc.changeHyperlink(start, start + length(doc.paragraphs[row]), link);
      // A complex PAGEREF sits inside the entry's hyperlink, as existing documents write it.
      const pageref = newBodyField(` PAGEREF ${entry.name} \\h `);
      const textEnd = length(doc.paragraphs[row]) - 1;
      (doc.paragraphs[row].fieldMarkers ||= []).push({ type: 'start', field: pageref, offset: textEnd, order: order(), link }, { type: 'end', field: pageref, offset: textEnd + 1, order: order(), link });
    }
    tocRows.push(row); row++;
  }
  doc.paragraphs[tocRows[0]].fieldMarkers = [{ type: 'start', field: toc, offset: 0, order: startOrder }, ...(doc.paragraphs[tocRows[0]].fieldMarkers || [])];
  const last = doc.paragraphs[tocRows.at(-1)];
  (last.fieldMarkers ||= []).push({ type: 'end', field: toc, offset: length(last), order: order() });
  doc.hasBodyFields = true; doc.hasTocFields = true;
  bodyFieldRanges(doc.paragraphs);
  doc.select(insertAt);
  doc.didChange();
  return { entries: entries.length };
}

const fieldsWithin = (doc, start, end) => new Set(bodyFieldRanges(doc.paragraphs).filter(r => r.start >= start && r.end <= end).map(r => r.field.id));

/** Remove the table of contents and the title paragraph this editor puts above it. */
export function removeTableOfContents(doc) {
  const toc = tableOfContents(doc.paragraphs);
  if (!toc?.whole) return false;
  let start = toc.paragraphStart, first = toc.first;
  const before = doc.paragraphs[toc.first - 1];
  if (before && Object.values(TOC_TITLES).includes(before.runs.map(r => r.text).join(''))) { start -= length(before) + 1; first--; }
  const end = toc.paragraphEnd, removedBodyFields = fieldsWithin(doc, toc.start, toc.end);
  // Remove whole paragraphs without merging a neighbour into the table's formatting:
  // take the separator before the table, or, at the start, give the next paragraph back its own.
  if (start > 0) { doc.select(start - 1, end); doc.replaceUntracked('', { checkpoint: false, removedBodyFields }); }
  else if (end < doc.text.length) {
    const next = structuredClone(doc.paragraphs[toc.last + 1]);
    doc.select(0, end + 1); doc.replaceUntracked('', { checkpoint: false, removedBodyFields });
    const merged = doc.paragraphs[0];
    doc.paragraphs[0] = { ...next, runs: merged.runs, ...(merged.bookmarks ? { bookmarks: merged.bookmarks } : {}), ...(merged.fieldMarkers ? { fieldMarkers: merged.fieldMarkers } : {}) };
    if (!merged.bookmarks) delete doc.paragraphs[0].bookmarks;
    if (!merged.fieldMarkers) delete doc.paragraphs[0].fieldMarkers;
  } else { doc.select(0, end); doc.replaceUntracked('', { checkpoint: false, removedBodyFields }); }
  doc.select(Math.min(Math.max(0, start - 1), doc.text.length));
  doc.didChange();
  return first >= 0;
}
