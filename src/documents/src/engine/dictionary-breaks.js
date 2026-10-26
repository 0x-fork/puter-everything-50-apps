// Thai, Lao, Khmer and Myanmar are written without spaces between words
// (UAX #14 line-break class SA), so only a dictionary can find where a line may
// break. Intl.Segmenter carries one for each of these scripts. Word boundaries
// count only between two such characters: punctuation, Latin text and spaces
// adjacent to them keep the ordinary rules. Other paragraphs are not segmented.
// All four scripts lie in the BMP, so one code unit identifies each side.
const COMPLEX = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const words = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

/** Offsets in `text` where a line may break between two dictionary-segmented words, or null when there are none. */
export function dictionaryBreaks(text) {
  if (!words || !COMPLEX.test(text)) return null;
  const breaks = new Set();
  for (const { segment, index } of words.segment(text)) {
    if (index && COMPLEX.test(segment[0]) && COMPLEX.test(text[index - 1])) breaks.add(index);
  }
  return breaks.size ? breaks : null;
}

// Thai and Lao leading vowels precede their consonant but are separate
// graphemes, as are a few following vowels. A forced break inside an overlong
// word keeps them with that consonant. A line that ends at a tab, space or
// manual break is not a forced break and is left alone.
const LEADING_VOWEL = /^[\u0e40-\u0e44\u0ec0-\u0ec4]$/u;
const FOLLOWING_VOWEL = /^[\u0e30\u0e32\u0e33\u0e45\u0eb0\u0eb2\u0eb3]/u;
const THAI_LAO = /^[\p{Script=Thai}\p{Script=Lao}]/u;
export const splitsSyllable = (before, after) => LEADING_VOWEL.test(before) && THAI_LAO.test(after) || FOLLOWING_VOWEL.test(after);
