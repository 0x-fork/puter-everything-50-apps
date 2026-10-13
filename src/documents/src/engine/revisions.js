// Original tracked-change model (ECMA-376 Part 1 §17.13.5). Inserted and
// deleted text stay in the paragraphs as ordinary runs carrying
// `run.revision = { type: 'ins' | 'del', author, date }`; a paragraph mark that
// was inserted or deleted carries `paragraph.markRevision`. Deleted text keeps
// its document positions until the change is accepted, as an all-markup view
// shows it.
const length = p => p.runs.reduce((n, r) => n + r.text.length, 0);

export const REVISION_COLORS = ['B5082E', '2E6EB5', '2F8A3A', '8A3FB0', 'C25E00', '00838F', 'A0306E', '5B6B00'];

/** A stable display color per author, as hex without '#'. */
export function revisionColor(author, authors = []) {
  const index = authors.indexOf(author);
  if (index >= 0) return REVISION_COLORS[index % REVISION_COLORS.length];
  let hash = 0;
  for (const ch of String(author || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return REVISION_COLORS[hash % REVISION_COLORS.length];
}

export const sameRevision = (a, b) => !a && !b || !!a && !!b && a.type === b.type && a.author === b.author && a.date === b.date;

/** Split runs so that a paragraph-local offset falls on a run boundary; returns the run index starting there. */
function splitAt(p, offset) {
  let at = 0;
  for (let i = 0; i < p.runs.length; i++) {
    const run = p.runs[i], end = at + run.text.length;
    if (offset === at) return i;
    if (offset < end) {
      p.runs.splice(i, 1, { ...run, text: run.text.slice(0, offset - at) }, { ...run, text: run.text.slice(offset - at) });
      return i + 1;
    }
    at = end;
  }
  return p.runs.length;
}

/**
 * Visit the run pieces and paragraph marks within [start, end):
 * visit({ paragraph, index, run }) for runs (after splitting at the bounds) and
 * visit({ paragraph, mark: true }) for each separator inside the range.
 */
export function eachRevisionTarget(paragraphs, start, end, visit) {
  let at = 0;
  for (const p of paragraphs) {
    const size = length(p), pStart = at, pEnd = at + size;
    if (pEnd >= start && pStart <= end) {
      const from = Math.max(0, start - pStart), to = Math.min(size, end - pStart);
      if (to > from) {
        const first = splitAt(p, from), last = splitAt(p, to);
        for (let i = first; i < last; i++) visit({ paragraph: p, index: i, run: p.runs[i] });
      }
      if (pEnd >= start && pEnd < end) visit({ paragraph: p, mark: true });
    }
    at = pEnd + 1;
    if (at > end) break;
  }
}

// Formatting revisions stay inside the retained property XML (§17.13.5.30
// rPrChange, §17.13.5.29 pPrChange). Only their presence and author matter here.
const CHANGE = { run: /<(?:\w+:)?rPrChange\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?rPrChange>)/g, paragraph: /<(?:\w+:)?pPrChange\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?pPrChange>)/g };
function formatChange(xml, kind) {
  if (!xml || !xml.includes(kind === 'run' ? 'rPrChange' : 'pPrChange')) return null;
  const match = xml.match(CHANGE[kind])?.[0];
  if (!match) return null;
  const attr = name => match.match(new RegExp(`\\b(?:\\w+:)?${name}="([^"]*)"`))?.[1] || '';
  return { type: 'format', author: attr('author'), date: attr('date') };
}
export const runFormatChange = run => formatChange(run.properties, 'run');
export const paragraphFormatChange = p => formatChange(p.shell, 'paragraph') || formatChange(p.markProperties, 'run');
/** Drop the recorded formatting change from a run's or paragraph's retained XML (accepting it). */
export function acceptFormatChange(target, kind) {
  if (kind === 'run') { if (target.properties) target.properties = target.properties.replace(CHANGE.run, ''); return; }
  if (target.shell) target.shell = target.shell.replace(CHANGE.paragraph, '');
  if (target.markProperties) { target.markProperties = target.markProperties.replace(CHANGE.run, ''); target.markPropertiesChanged = true; }
}

/** Revised ranges in document order: [{ type, author, date, start, end, mark? }]; adjacent same-revision runs merge. */
export function revisionRanges(paragraphs) {
  const ranges = []; let at = 0;
  const push = (revision, start, end, mark = false) => {
    const last = ranges.at(-1);
    if (last && last.end === start && sameRevision(last, revision)) { last.end = end; if (mark) last.marks = (last.marks || 0) + 1; return; }
    ranges.push({ type: revision.type, author: revision.author, date: revision.date, start, end, ...(mark ? { marks: 1 } : {}) });
  };
  for (const p of paragraphs) {
    let offset = at;
    const paragraphChange = paragraphFormatChange(p);
    for (const run of p.runs) {
      if (run.revision && run.text) push(run.revision, offset, offset + run.text.length);
      else if (run.text && !paragraphChange) { const change = runFormatChange(run); if (change) push(change, offset, offset + run.text.length); }
      offset += run.text.length;
    }
    if (p.markRevision) push(p.markRevision, offset, offset + 1, true);
    if (paragraphChange) push(paragraphChange, at, offset + 1, true);
    at = offset + 1;
  }
  return ranges;
}

export const hasRevisions = paragraphs => paragraphs.some(p => p.markRevision || paragraphFormatChange(p) || p.runs.some(r => r.revision || runFormatChange(r)));

/** The authors who made changes, in first-appearance order. */
export function revisionAuthors(paragraphs) {
  const authors = [];
  for (const range of revisionRanges(paragraphs)) if (!authors.includes(range.author)) authors.push(range.author);
  return authors;
}

/** Inline display of a revised run for a view: { hidden } or style overrides. */
export function revisionDisplay(revision, view, color) {
  if (!revision || revision.type === 'format') return null;
  if (view === 'original') return revision.type === 'ins' ? { hidden: true } : {};
  if (view === 'none' || view === 'simple') return revision.type === 'del' ? { hidden: true } : {};
  return revision.type === 'ins'
    ? { color, underline: true, underlineStyle: 'single', underlineColor: color }
    : { color, strikethrough: 'single' };
}

/** How the canvas shows tracked changes: 'all' (All Markup), 'simple', 'none' (No Markup) or 'original'. */
// showHidden: hidden text (w:vanish) is laid out when formatting marks are shown.
export const revisionView = { mode: 'all', authors: [], showHidden: false };
