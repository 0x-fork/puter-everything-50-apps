// Measuring body paragraphs is nearly all of a layout's work, and an edit changes only a few of
// them. A measurer can carry this cache of measured paragraphs from earlier layouts. An entry is
// keyed by every input measurement reads besides the measurer: the paragraph's content, its page
// geometry, list label, numbering, revision view and boundary rule. Results do not depend on
// where the paragraph starts, apart from the document offsets they carry, so a paragraph that
// only moved (text was typed before it) is reused with its offsets shifted. Measured paragraphs
// are read-only (readOnlyMeasurement), so every layout and pagination pass shares the remembered
// one; a moved paragraph is copied once, at its new offsets. The measurer's owner replaces the
// cache when its measurements can change (fonts loaded or replaced).

// Fields of measured lines and their parts that hold document offsets. Caret stops (including
// those of reordered bidi fragments and their shaping positions) carry theirs as `offset`;
// elsewhere `offset` is a distance, such as an underline's position below the baseline.
const OFFSET_KEYS = new Set(['start', 'end', 'trailingStart', 'drawingSegmentStart']);
const STOP_LISTS = new Set(['stops', 'caretStops', 'textOffsets']);

// A long document moves most of its paragraphs on every keystroke, so this stays a plain loop.
function shifted(value, delta, list) {
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      copy[i] = item && typeof item === 'object' ? shifted(item, delta, list) : item;
    }
    return copy;
  }
  const copy = {}, stops = STOP_LISTS.has(list);
  for (const key in value) {
    const item = value[key];
    copy[key] = typeof item === 'number' ? delta && (OFFSET_KEYS.has(key) || stops && key === 'offset') ? item + delta : item
      : item && typeof item === 'object' ? shifted(item, delta, key) : item;
  }
  return copy;
}

// Development and test builds freeze measured paragraphs, so a layout stage that changes one
// in place fails loudly instead of corrupting the paragraphs every later layout shares. Pictures
// are the document's own objects, which editing changes; they stay as they are.
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const key in value) if (key !== 'image') freeze(value[key]);
}
/** A measured paragraph, which later layout stages read but never change (they copy what they adjust). */
export function readOnlyMeasurement(measured) {
  if (import.meta.env?.DEV) freeze(measured);
  return measured;
}

// What pagination reads of a measured block: everything but its document offsets (an empty line,
// whose start is its end, breaks pages differently) and, for body text, the horizontal detail of
// its lines, which typing changes without moving any line. Table cells keep their fragments, which
// clip a cell's content.
const FLOW_OFFSETS = new Set([...OFFSET_KEYS, ...STOP_LISTS]);
const FLOW_HORIZONTAL = new Set(['fragments', 'underlines', 'strikes', 'backgrounds', 'leaders', 'x', 'width', 'contentWidth', 'ignoredTrailingWidth', 'ignoredTabWidth', 'justificationSpacing']);
function flowJson(measured, horizontal) {
  return JSON.stringify(measured, function (key, value) {
    // A cell's source content is the document's (with its offsets); its measured blocks follow.
    if (FLOW_OFFSETS.has(key) || key === 'content' && Array.isArray(this.blocks)) return undefined;
    const line = Array.isArray(this.stops);
    if (horizontal && line && FLOW_HORIZONTAL.has(key)) return undefined;
    if (value && typeof value === 'object' && Array.isArray(value.stops) && typeof value.start === 'number' && !('empty' in value)) return { ...value, empty: value.start === value.end };
    return value;
  });
}

export class ParagraphMeasureCache {
  constructor(limit = 10000) { this.limit = limit; this.entries = new Map(); this.generation = 0; this.names = new Map(); this.nextName = 0; this.flowNames = new WeakMap(); this.flows = new Map(); this.stories = new Map(); }
  /** A page story measured earlier with the same inputs (page-story-measure.js), or undefined. */
  story(key) {
    const entry = this.stories.get(key);
    if (!entry) return undefined;
    entry.used = this.generation;
    return entry.value;
  }
  rememberStory(key, value) { this.stories.set(key, { value, used: this.generation }); }
  /**
   * A short name for what pagination reads of measured blocks (a body paragraph's measurement
   * or a table's rows): equal names paginate alike wherever their text and offsets differ.
   */
  flowName(blocks, table = false) {
    if (table) return this.intern(flowJson(blocks, false));
    let name = this.flowNames.get(blocks);
    if (!name) this.flowNames.set(blocks, name = this.#name(flowJson(blocks, true)));
    else {
      // Still in use: keep it, so a paragraph measured again alike gets the same name.
      name.used = this.generation;
      if (!this.names.has(name.text)) this.names.set(name.text, name);
    }
    return name.id;
  }
  /**
   * A short name for a long key part (page geometry, numbering, what pagination reads), the same
   * while layouts keep using it. A name is never given to other text, even once forgotten.
   */
  intern(text) { return this.#name(text).id; }
  #name(text) {
    let name = this.names.get(text);
    if (!name) this.names.set(text, name = { id: this.nextName++, text, used: 0 });
    name.used = this.generation;
    return name;
  }
  /**
   * The owner starts a new layout of its document: forget the paragraphs that none of the last
   * few layouts used (versions replaced by edits), so memory follows the document's size.
   */
  nextGeneration(keep = 4) {
    this.generation++;
    for (const [key, entry] of this.entries) if (entry.used < this.generation - keep) this.entries.delete(key);
    for (const [text, name] of this.names) if (name.used < this.generation - keep) this.names.delete(text);
    for (const [key, entry] of this.stories) if (entry.used < this.generation - keep) this.stories.delete(key);
  }
  /** The measured paragraph for `key` at document `offset`, measuring it with `measure()` on a miss. */
  measure(key, offset, measure) {
    const entry = this.entries.get(key);
    if (entry) {
      // Most recently used entries stay; the oldest go first if the cache is ever full.
      this.entries.delete(key); this.entries.set(key, entry); entry.used = this.generation;
      if (entry.offset !== offset) {
        const moved = readOnlyMeasurement(shifted(entry.measured, offset - entry.offset)), name = this.flowNames.get(entry.measured);
        if (name) this.flowNames.set(moved, name);
        entry.measured = moved; entry.offset = offset;
      }
      return entry.measured;
    }
    const measured = readOnlyMeasurement(measure());
    this.entries.set(key, { offset, measured, used: this.generation });
    // Past the limit the least recently used entry goes, unless this layout used it too: a document with
    // more paragraphs than the limit would otherwise evict each before its next use, and every keystroke
    // would measure the whole document again. nextGeneration() still forgets what layouts stop using.
    if (this.entries.size > this.limit) {
      const [oldest, entry] = this.entries.entries().next().value;
      if (entry.used < this.generation) this.entries.delete(oldest);
    }
    return measured;
  }
  clear() { this.entries.clear(); this.names.clear(); this.flowNames = new WeakMap(); this.flows.clear(); this.stories.clear(); }
}
