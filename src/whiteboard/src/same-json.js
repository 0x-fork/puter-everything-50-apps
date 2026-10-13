// Whether two values serialize to the same JSON. Successive projections of
// a board copy each unchanged object with the same values under the same
// keys, so comparing a large board with its previous projection finds those
// equal without serializing every object; anything else is serialized.
export function sameJSON(a, b) {
  if (a === b) return true;
  if (plain(a) && plain(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = Object.keys(a),
      others = Object.keys(b);
    if (
      keys.length === others.length &&
      keys.every((key, n) => key === others[n] && a[key] === b[key])
    )
      return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
// Objects and arrays without a toJSON of their own, which serialize as
// their keys and values say.
function plain(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === Array.prototype) &&
    typeof value.toJSON !== "function"
  );
}
