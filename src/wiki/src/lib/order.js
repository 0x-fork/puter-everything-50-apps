/**
 * Fractional order keys. Every block and page carries a string key; sorting
 * the keys gives the order, and a key can always be made between two others
 * without renumbering anything. Two people inserting at the same spot get
 * different keys (a random tail breaks ties), so concurrent edits merge.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const MID = DIGITS[Math.floor(BASE / 2)];

function digit(c) {
  const i = DIGITS.indexOf(c);
  if (i < 0) throw new Error(`bad order key character: ${c}`);
  return i;
}

/** A key that sorts strictly between a and b ('' means open-ended). */
export function between(a = '', b = '') {
  if (a && b && a >= b) throw new Error(`order keys out of order: ${a} >= ${b}`);
  let out = '';
  for (let i = 0; ; i++) {
    const lo = i < a.length ? digit(a[i]) : 0;
    const hi = b && i < b.length ? digit(b[i]) : BASE;
    if (hi - lo > 1) {
      out += DIGITS[Math.floor((lo + hi) / 2)];
      // A key never ends in the zero digit, so something always fits before it.
      return out;
    }
    out += DIGITS[lo];
    // Past this point we only need to stay above a; b no longer constrains
    // us once our prefix is already below it.
    if (b && lo < hi) b = '';
  }
}

/** A random tail so keys minted at the same spot by two clients differ. */
function jitter() {
  const n = new Uint8Array(2);
  crypto.getRandomValues(n);
  return DIGITS[1 + (n[0] % (BASE - 1))] + DIGITS[1 + (n[1] % (BASE - 1))];
}

/** Between, with a collision-resistant tail. */
export function keyBetween(a = '', b = '') {
  const k = between(a, b);
  const withTail = k + jitter();
  // The tail only lengthens k, so it stays above a; it must stay below b too.
  return !b || withTail < b ? withTail : k;
}

/** n keys spread evenly after a (or from the start). */
export function keysAfter(a = '', n = 1) {
  const keys = [];
  let prev = a;
  for (let i = 0; i < n; i++) {
    prev = keyBetween(prev, '');
    keys.push(prev);
  }
  return keys;
}

export function compareOrder(x, y) {
  const a = x.order || '';
  const b = y.order || '';
  if (a !== b) return a < b ? -1 : 1;
  return (x.id || '') < (y.id || '') ? -1 : (x.id || '') > (y.id || '') ? 1 : 0;
}

export { MID };
