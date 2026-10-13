// Footnote areas: after pagination, each page reserves room at the foot of its
// text area for the notes referenced on it, separated from the body by a short
// rule. Pagination repeats until the reservations settle (a reference pushed to
// the next page takes its note with it).
import { measurePageStory } from './page-story-measure.js';
import { footnoteNumbers, footnoteReferences, numberedParagraphs, footnoteStoryPath } from './footnotes.js';

export const FOOTNOTE_SEPARATOR = 16; // px: the separator paragraph, about one 12pt line
const SEPARATOR_RULE = 192; // px: the separator spans two inches of the text width

/** Notes referenced from the body, with their display numbers, or null. */
export function footnotePlan(definition, paragraphs) {
  const settings = definition?.footnotes;
  if (!settings) return null;
  const refs = footnoteReferences(paragraphs);
  if (!refs.length) return null;
  const numbers = footnoteNumbers(paragraphs, settings);
  const stories = new Map();
  for (const id of numbers.keys()) {
    const story = definition.stories[footnoteStoryPath(settings.part, id)];
    if (story) stories.set(id, story);
  }
  return { refs, numbers, stories, part: settings.part };
}

/** The page of each reference: Map(page -> [ids]) in reference order. */
export function assignFootnotes(placed, refs) {
  const pages = new Map(), seen = new Set();
  const lines = placed.lines.filter(line => !line.virtual && !line.pageStory);
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    const line = lines.find(l => l.paragraphId === ref.paragraphId && l.start <= ref.position && ref.position < l.end)
      || lines.find(l => l.paragraphId === ref.paragraphId && l.start <= ref.position && ref.position <= l.end);
    if (!line) continue;
    seen.add(ref.id);
    if (!pages.has(line.page)) pages.set(line.page, []);
    pages.get(line.page).push(ref.id);
  }
  return pages;
}

/** Measure one note at the page's text width, showing its number. */
export function measureNote(story, display, numbers, geometry, measure, numbering, options = {}) {
  const paragraphs = numberedParagraphs(story.paragraphs, numbers, display);
  return measurePageStory({ ...story, paragraphs }, { ...geometry, storyKind: 'footnote', top: 0, bottom: 0 }, measure, numbering,
    { pageNumber: 1, pageCount: 1, sectionPageCount: 1 }, { styles: options.styles, drawingLayouts: options.drawingLayouts, onUnsupported: options.bestEffort ? () => {} : undefined });
}

/**
 * Lay out with footnote reservations. `layout(reserve)` paginates with `reserve[page]` px kept
 * free above the bottom margin. Returns the final layout with `footnoteAreas`.
 */
export function layoutWithFootnotes(plan, layout, measure, numbering, options) {
  const heights = new Map();
  const noteHeight = (id, geometry) => {
    const key = `${id}/${geometry.width}/${geometry.left}/${geometry.right}`;
    if (!heights.has(key)) {
      try { heights.set(key, measureNote(plan.stories.get(id), plan.numbers.get(id), plan.numbers, geometry, measure, numbering, options).placed.endY); }
      catch (error) { if (!options.bestEffort) throw error; heights.set(key, 0); }
    }
    return heights.get(key);
  };
  const needed = (placed, pages) => {
    const next = {};
    for (const [page, ids] of pages) {
      const geometry = placed.pages[page] || placed.page;
      const notes = ids.filter(id => plan.stories.has(id));
      if (notes.length) next[page] = Math.ceil(FOOTNOTE_SEPARATOR + notes.reduce((sum, id) => sum + noteHeight(id, geometry), 0));
    }
    return next;
  };
  // A reference that only fits without its note's reservation moves to the next
  // page and takes the note along; that can alternate. When a state repeats,
  // reserve the union so the final layout and its note areas agree.
  let reserve = {}, placed, pages;
  const seen = new Set();
  for (let attempt = 0; attempt < 8; attempt++) {
    placed = layout(reserve);
    pages = assignFootnotes(placed, plan.refs);
    const next = needed(placed, pages), key = JSON.stringify(next);
    if (key === JSON.stringify(reserve)) break;
    if (seen.has(key) || attempt === 7) {
      const union = { ...reserve };
      for (const [page, height] of Object.entries(next)) union[page] = Math.max(union[page] || 0, height);
      reserve = union;
      placed = layout(reserve);
      pages = assignFootnotes(placed, plan.refs);
      break;
    }
    seen.add(JSON.stringify(reserve));
    reserve = next;
  }
  const final = needed(placed, pages);
  placed.footnoteAreas = [];
  for (const [page, ids] of pages) {
    const geometry = placed.pages[page] || placed.page, notes = ids.filter(id => plan.stories.has(id));
    if (!notes.length || !final[page]) continue;
    // Never draw notes over body text: start the area below the body's reserved space.
    const height = Math.max(final[page], reserve[page] || 0);
    const top = geometry.height - geometry.bottom - height;
    placed.footnoteAreas.push({ page, top, notes: notes.map(id => ({ id, path: footnoteStoryPath(plan.part, id), display: plan.numbers.get(id) })) });
    (placed.columnSeparators ||= []).push({ page, x: geometry.left, y: top + FOOTNOTE_SEPARATOR / 2, width: Math.min(SEPARATOR_RULE, geometry.width - geometry.left - geometry.right), height: 0.75, footnote: true });
  }
  return placed;
}
