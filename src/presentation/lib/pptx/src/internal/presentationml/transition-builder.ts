// Builds the `<p:transition>` element that controls how the slide show
// animates from this slide to the next.
//
// Per ECMA-376 Part 1 §19.5.51 the transition carries:
//   - `spd` attribute: `slow` | `med` | `fast` (default `fast`)
//   - `advClick` attribute: `1` to advance on click (default), `0` to disable
//   - `advTm` attribute: auto-advance time in milliseconds
//   - Exactly one child element from the effect catalog (fade, push,
//     cover, wipe, split, cut, dissolve, checker, blinds, randomBar,
//     zoom, circle, diamond, plus, wedge, ...).
//
// The effect attributes are not interchangeable: each effect element maps to a
// distinct CT type that only permits certain attributes (CT_OptionalBlackTransition
// → thruBlk; CT_SplitTransition → orient + dir; the direction families → dir).
// Emitting an attribute on an effect that doesn't allow it is schema-invalid, so
// buildEffectElement gates each attribute by the effect that accepts it.

import { oneOf, unsignedIntMs } from "../bounds.ts";
import { writeUniversalTimeOffset } from "../universal-time.ts";
import { type XmlElement, NS, attr, elem, qname } from "../xml/index.ts";

const NAME_TRANSITION = qname("p", "transition", NS.pml);
const ATTR_SPD = qname("", "spd", "");
const ATTR_ADV_CLICK = qname("", "advClick", "");
const ATTR_ADV_TM = qname("", "advTm", "");
const ATTR_DIR = qname("", "dir", "");
const ATTR_ORIENT = qname("", "orient", "");
const ATTR_THRU_BLK = qname("", "thruBlk", "");

/**
 * Transition effect token. Base effects use `<p:{token}/>`; p15 (2013 extension) page
 * curls use `<p15:prstTrans prst="{token}"/>`. Other base effects permitted by
 * the schema can be passed as strings and are validated before writing.
 */
export type TransitionEffect =
  | "none"
  | "fade"
  | "push"
  | "cover"
  | "wipe"
  | "split"
  | "cut"
  | "dissolve"
  | "checker"
  | "blinds"
  | "randomBar"
  | "zoom"
  | "circle"
  | "diamond"
  | "plus"
  | "wedge"
  | "newsflash"
  | "pageCurlDouble"
  | "pageCurlSingle";

export interface TransitionOptions {
  effect: TransitionEffect | string;
  /** Effect speed. Defaults to omitted (absence means `fast`, ECMA-376 §19.5.51). */
  speed?: "slow" | "med" | "fast";
  /** Authored effect duration in milliseconds (p14:dur), overriding speed. */
  durationMs?: number;
  /**
   * Direction, valid only for effects that carry a `dir` attribute and only
   * within that effect's domain (validated on write):
   *   - `blinds`/`checker`/`comb`/`randomBar`: `horz` | `vert`
   *   - `push`/`wipe`: `l` | `r` | `u` | `d`
   *   - `cover`/`pull`: the above plus `lu` | `ru` | `ld` | `rd`
   *   - `strips`: `lu` | `ru` | `ld` | `rd`
   *   - `zoom`/`split`: `in` | `out`
   * A mismatched effect/direction pair throws; on any other effect a stray
   * `direction` is ignored.
   */
  direction?: string;
  /** For `split`: orientation token (`horz` / `vert`). */
  orientation?: "horz" | "vert";
  /** For `fade`: pass `true` to fade through black. */
  thruBlack?: boolean;
  /** For p15 presets: invert X coordinates (default false). */
  invertX?: boolean;
  /** For p15 presets: invert Y coordinates (default false). */
  invertY?: boolean;
  /** Whether clicking advances; default `true` (the schema default). */
  advanceOnClick?: boolean;
  /**
   * Milliseconds to auto-advance after this slide. Omit for click-only
   * advance.
   */
  advanceAfterMs?: number;
}

// Per-effect `dir` value domains (ECMA-376 Part 1, pml.xsd). The effect
// element's CT type fixes which direction tokens are legal — they are NOT
// interchangeable: blinds wants horz/vert, push wants l/r/u/d, zoom wants
// in/out, etc. Emitting a token outside the effect's domain is schema-invalid,
// so we validate `direction` against the effect here (a boundary).
const DIR_ORIENT = new Set(["horz", "vert"]); // ST_Direction (CT_OrientationTransition)
const DIR_SIDE = new Set(["l", "u", "r", "d"]); // ST_TransitionSideDirectionType
const DIR_CORNER = new Set(["lu", "ru", "ld", "rd"]); // ST_TransitionCornerDirectionType
const DIR_EIGHT = new Set([...DIR_SIDE, ...DIR_CORNER]); // ST_TransitionEightDirectionType
const DIR_IN_OUT = new Set(["in", "out"]); // ST_TransitionInOutDirectionType
const DIR_DOMAINS: Readonly<Record<string, ReadonlySet<string>>> = {
  blinds: DIR_ORIENT,
  checker: DIR_ORIENT,
  comb: DIR_ORIENT,
  randomBar: DIR_ORIENT,
  push: DIR_SIDE,
  wipe: DIR_SIDE,
  cover: DIR_EIGHT,
  pull: DIR_EIGHT,
  strips: DIR_CORNER,
  zoom: DIR_IN_OUT,
  split: DIR_IN_OUT,
};
// Effects whose CT type carries `thruBlk` (CT_OptionalBlackTransition).
const THRU_BLK_EFFECTS = new Set(["fade", "cut"]);
const PRESET_EFFECTS = new Set(["pageCurlDouble", "pageCurlSingle"]);

// Every transition effect element name in CT_SlideTransition's choice
// (ECMA-376 pml.xsd). `effect` is typed `TransitionEffect | string` for
// forward-compat, so the raw token reaches the wire — validate it against the
// full spec set, or an empty/unknown string yields non-well-formed or
// schema-invalid XML. `none` is handled before this and is intentionally absent.
const TRANSITION_EFFECTS: ReadonlyArray<string> = [
  "blinds",
  "checker",
  "circle",
  "dissolve",
  "comb",
  "cover",
  "cut",
  "diamond",
  "fade",
  "newsflash",
  "plus",
  "pull",
  "push",
  "random",
  "randomBar",
  "split",
  "strips",
  "wedge",
  "wheel",
  "wipe",
  "zoom",
];

// Returns the single effect child, or null for the "no transition effect"
// sentinel ('none' is not a valid effect element name — CT_SlideTransition's
// choice has no `none` member).
const buildEffectElement = (opts: TransitionOptions): XmlElement | null => {
  if (opts.effect === "none") return null;
  if (PRESET_EFFECTS.has(opts.effect)) {
    const attrs = [attr(qname("", "prst", ""), opts.effect)];
    for (const [name, value] of [
      ["invX", opts.invertX],
      ["invY", opts.invertY],
    ] as const)
      if (value !== undefined)
        attrs.push(attr(qname("", name, ""), value ? "1" : "0"));
    return elem(qname("p15", "prstTrans", NS.p15), { attrs });
  }
  const effect = oneOf(
    opts.effect,
    TRANSITION_EFFECTS,
    "setSlideTransition: effect",
  );
  const name = qname("p", effect, NS.pml);
  const attrs = [];
  if (opts.direction !== undefined) {
    // Only effects with a `dir` attribute carry a domain; for any other effect
    // a stray `direction` is ignored (it has nowhere valid to go).
    const domain = DIR_DOMAINS[opts.effect];
    if (domain !== undefined) {
      if (!domain.has(opts.direction)) {
        throw new Error(
          `setSlideTransition: direction "${opts.direction}" is not valid for effect ` +
            `"${opts.effect}" (allowed: ${[...domain].join(", ")})`,
        );
      }
      attrs.push(attr(ATTR_DIR, opts.direction));
    }
  }
  // `orient` only exists on CT_SplitTransition.
  if (opts.orientation !== undefined && opts.effect === "split") {
    attrs.push(attr(ATTR_ORIENT, opts.orientation));
  }
  if (opts.thruBlack && THRU_BLK_EFFECTS.has(opts.effect)) {
    attrs.push(attr(ATTR_THRU_BLK, "1"));
  }
  return elem(name, { attrs });
};

/** Returns a transition, with legacy alternatives for duration and presets. */
export const buildTransition = (opts: TransitionOptions): XmlElement => {
  const attrs = [];
  if (opts.speed !== undefined) attrs.push(attr(ATTR_SPD, opts.speed));
  if (opts.advanceOnClick === false) attrs.push(attr(ATTR_ADV_CLICK, "0"));
  if (opts.advanceAfterMs !== undefined) {
    // advTm is xsd:unsignedInt (0..4294967295 ms).
    const advTm = unsignedIntMs(
      opts.advanceAfterMs,
      "setSlideTransition: advanceAfterMs",
    );
    attrs.push(attr(ATTR_ADV_TM, String(advTm)));
  }
  const effect = buildEffectElement(opts);
  const preset = PRESET_EFFECTS.has(opts.effect);
  const fallback = elem(NAME_TRANSITION, {
    attrs,
    // Native output writes a fade for older readers of these page-curl presets.
    // Consumers that can play the preset select Choice; the app's presenter
    // explicitly supplies its own supportedEffects policy.
    children: preset
      ? [elem(qname("p", "fade", NS.pml))]
      : effect === null
        ? []
        : [effect],
  });
  if (opts.durationMs === undefined && !preset) return fallback;
  const modern = elem(NAME_TRANSITION, {
    attrs: [
      ...attrs,
      ...(opts.durationMs === undefined
        ? []
        : [
            attr(
              qname("p14", "dur", NS.p14),
              writeUniversalTimeOffset(opts.durationMs),
            ),
          ]),
    ],
    children: effect === null ? [] : [buildEffectElement(opts)!],
  });
  // Keep advance properties in both branches. Base effects keep their effect;
  // presets use the native legacy fade. Legacy readers retain speed-based
  // timing without an unknown duration attribute.
  return elem(qname("mc", "AlternateContent", NS.mc), {
    prefixDecls: new Map([
      ["mc", NS.mc],
      ["p14", NS.p14],
      ...(preset ? [["p15", NS.p15] as const] : []),
    ]),
    children: [
      elem(qname("mc", "Choice", NS.mc), {
        attrs: [
          attr(
            qname("", "Requires", ""),
            preset
              ? opts.durationMs === undefined
                ? "p15"
                : "p15 p14"
              : "p14",
          ),
        ],
        children: [modern],
      }),
      elem(qname("mc", "Fallback", NS.mc), { children: [fallback] }),
    ],
  });
};
