import { prepareCanvasMeasure, measurePreparedText } from './canvas-text.js';
import { localFontVersion } from './local-fonts.js';
import { ParagraphMeasureCache } from './paragraph-measure-cache.js';

// Fields layout writes onto the style objects it measures with; measurement never reads them.
export const LAYOUT_OUTPUT = new Set(['text', 'x', 'start', 'end', 'width', 'contentWidth', 'origin', 'ascent', 'descent', 'lineAscent', 'lineDescent', 'textParts', 'textOffsetX', 'textTransform', 'underline', 'strike', 'background', 'group', 'followingSpace', 'fastSpaces', 'lastSpace', 'spaceMetrics', 'trailingStart', 'numberEnd', 'numberDone', 'decimal', 'hasTextShadow', 'discretionaryOnly', 'colors']);

/**
 * A layout measurer over one canvas context. Every layout measures the same text with the same
 * styles thousands of times. Remember each measurement by style and exact text. A style object's
 * key is computed once (layout writes only its own output fields onto it, never ones measurement
 * reads), and so is what measuring reads of the style itself (prepareCanvasMeasure); callers get
 * a copy. Measured paragraphs (paragraph-measure-cache.js) follow the same memory: `clear()`
 * drops both, and so does a change of local fonts.
 *
 * The text memory is bounded by `limit` entries. Past it only the text memory starts over: the
 * measured paragraphs stay, since one layout of a long document can measure more texts than the
 * limit and every later layout would otherwise measure the whole document again.
 *
 * Measuring text that needs a deferred script or separator face prepares it; once prepared, the
 * memory is cleared and `measurer.onFontsReady()` is called so the current owner lays out again.
 * Opening a document validates its layout with one measurer and hands it to the editor, whose
 * first layout then reuses what validation measured.
 */
export function createCanvasMeasurer(context, { limit = 200000 } = {}) {
  const paragraphs = new ParagraphMeasureCache();
  let byStyle = new WeakMap(), byKey = new Map(), entries = 0, measuredFonts = localFontVersion();
  const forgetTexts = () => { byStyle = new WeakMap(); byKey = new Map(); entries = 0; };
  const clear = () => { forgetTexts(); paragraphs.clear(); };
  const checkFonts = () => {
    const fonts = localFontVersion();
    if (fonts !== measuredFonts) { clear(); measuredFonts = fonts; }
  };
  const fontsReady = () => { clear(); measurer.onFontsReady(); };
  // Each style's texts, and what measuring reads of the style itself (prepared on first use).
  const measurer = (text, style) => {
    checkFonts();
    let measured = byStyle.get(style);
    if (!measured) {
      const key = JSON.stringify(style, (name, value) => LAYOUT_OUTPUT.has(name) ? undefined : value);
      measured = byKey.get(key);
      if (!measured) byKey.set(key, measured = { texts: new Map(), prepared: null });
      byStyle.set(style, measured);
    }
    let result = measured.texts.get(text);
    if (!result) {
      result = measurePreparedText(context, measured.prepared ||= prepareCanvasMeasure(context, style), text, fontsReady);
      if (++entries > limit) { forgetTexts(); return { ...result }; }
      measured.texts.set(text, result);
    }
    return { ...result };
  };
  measurer.paragraphCache = () => { checkFonts(); return paragraphs; };
  measurer.clear = clear;
  measurer.onFontsReady = () => {};
  return measurer;
}
