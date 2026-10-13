// OpenType feature lists stored in character styles ("liga -calt frac"):
// the Type menu's features, toggling them and their CSS settings. Which
// features a font file implements is read in font-features.ts.

// Features offered in the Type menu: standard and discretionary ligatures,
// contextual alternates, swash, oldstyle figures, stylistic alternates,
// titling alternates, ordinals and fractions.
export const OPENTYPE_FEATURES = ['liga', 'dlig', 'calt', 'swsh', 'onum', 'salt', 'titl', 'ordn', 'frac'] as const;
export type OpenTypeFeature = (typeof OPENTYPE_FEATURES)[number];
// Features text shapers apply without being asked; styles store them as
// "-tag" when switched off.
export const DEFAULT_ON_FEATURES = new Set<string>(['liga', 'calt', 'clig']);

/** Canonical feature list: known tags ("tag" on, "-tag" off for default
 * features), deduplicated and sorted, space-separated. */
export function normalizeFeatures(features: string | undefined): string {
  const out = new Set<string>();
  for (const t of (features ?? '').split(/\s+/)) {
    const off = t.startsWith('-');
    const tag = off ? t.slice(1) : t;
    if (!/^[a-z0-9]{4}$/.test(tag)) continue;
    if (off && !DEFAULT_ON_FEATURES.has(tag)) continue;
    if (!off && DEFAULT_ON_FEATURES.has(tag)) continue;
    out.add(off ? `-${tag}` : tag);
  }
  return [...out].sort().join(' ');
}
/** Toggle one menu feature in a feature list. */
export function toggleFeature(features: string | undefined, tag: string, on: boolean): string {
  const list = new Set(normalizeFeatures(features).split(' ').filter(Boolean));
  list.delete(tag);
  list.delete(`-${tag}`);
  if (DEFAULT_ON_FEATURES.has(tag)) {
    if (!on) list.add(`-${tag}`);
  } else if (on) list.add(tag);
  return normalizeFeatures([...list].join(' '));
}
/** Whether a feature is in effect for a feature list. */
export function featureOn(features: string | undefined, tag: string): boolean {
  const list = normalizeFeatures(features).split(' ');
  return DEFAULT_ON_FEATURES.has(tag) ? !list.includes(`-${tag}`) : list.includes(tag);
}
// Fractions are not switched on for whole runs (that would raise every
// digit): layout turns a slash between digits into the fraction slash and
// the shaper applies the font's fraction forms around it.
const LAYOUT_ONLY = new Set(['frac']);
/** CSS font-feature-settings value for a feature list ('' when none). */
export function featureSettings(features: string | undefined): string {
  const n = normalizeFeatures(features).split(' ').filter((t) => t && !LAYOUT_ONLY.has(t));
  return n.map((t) => (t.startsWith('-') ? `"${t.slice(1)}" 0` : `"${t}" 1`)).join(', ');
}
/** The feature list a font face needs (layout-only features removed). */
export const faceFeatures = (features: string | undefined) => normalizeFeatures(features).split(' ').filter((t) => t && !LAYOUT_ONLY.has(t)).join(' ');
