// Original footnote model (ECMA-376 Part 1 §17.11). A body reference is one
// object character carrying `noteMark = { kind: 'footnoteReference', id }`;
// each note is a story keyed `<part>#<id>` whose own number is a footnoteRef
// mark. Numbers are derived from reference order, never stored as text.
import { formatPageNumber } from './page-numbering.js';
import { OBJECT } from './images.js';

export const isFootnoteReference = run => run?.noteMark?.kind === 'footnoteReference';
export const footnoteStoryPath = (part, id) => `${part}#${id}`;
export const footnoteStoryId = path => /#(-?\d+)$/.exec(path || '')?.[1] ?? null;

/** Body references in document order: [{ id, position, paragraphId }]. */
export function footnoteReferences(paragraphs) {
  const refs = []; let at = 0;
  for (const p of paragraphs) {
    let offset = at;
    for (const run of p.runs) { if (isFootnoteReference(run)) refs.push({ id: run.noteMark.id, position: offset, paragraphId: p.id }); offset += run.text.length; }
    at = offset + 1;
  }
  return refs;
}

/** Displayed number for each referenced note id, in reference order. */
export function footnoteNumbers(paragraphs, { format = 'decimal', start = 1 } = {}) {
  const numbers = new Map(); let n = start;
  for (const ref of footnoteReferences(paragraphs)) if (!numbers.has(ref.id)) numbers.set(ref.id, formatPageNumber(n++, format));
  return numbers;
}

/** Copies of paragraphs whose note marks show `numbers` (body references) or `own` (a note's footnoteRef). */
export function numberedParagraphs(paragraphs, numbers, own = null) {
  return paragraphs.map(p => p.runs.some(r => r.noteMark?.display !== undefined) ? { ...p, runs: p.runs.map(r => {
    if (r.noteMark?.display === undefined) return r;
    const display = r.noteMark.kind === 'footnoteReference' ? numbers.get(r.noteMark.id) : own;
    return { ...r, noteMark: { ...r.noteMark, display: display ?? '?' } };
  }) } : p);
}

/** A new body reference run, formatted from `base` (the typing run), as superscript. */
export function footnoteReferenceRun(base, id) {
  const run = { ...base, text: OBJECT, noteMark: { kind: 'footnoteReference', id, text: OBJECT, display: '' }, verticalAlign: 'superscript', overrides: { ...base.overrides, verticalAlign: 'superscript' } };
  delete run.revision; delete run.link;
  return run;
}

/** The runs a new note starts with: its own number mark (superscript) and a space, both from `base`. */
export function footnoteOpeningRuns(base, referenceStyle = null) {
  const mark = { ...base, text: OBJECT, noteMark: { kind: 'footnoteRef', text: OBJECT, display: '' }, verticalAlign: 'superscript', overrides: { ...base.overrides, verticalAlign: 'superscript' } };
  if (referenceStyle) { mark.styleId = referenceStyle; mark.styleChanged = true; }
  delete mark.revision; delete mark.link;
  const space = { ...base, text: ' ' };
  delete space.revision; delete space.link;
  return [mark, space];
}
