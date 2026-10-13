// Slide transitions.

import {
  NS,
  type XmlElement,
  getAttrValue,
  qname,
  childElements,
  insertChildByRank,
  effectiveChildElements,
  isAlternateContent,
  isAlternateContentBranch,
} from "../../internal/xml/index.ts";
import {
  type TransitionOptions,
  buildTransition,
} from "../../internal/presentationml/index.ts";
import { partName } from "../../internal/opc/index.ts";
import { readOnlyPartRoot } from "../../internal/parts/read-only-xml.ts";
import { unsignedIntMs } from "../../internal/bounds.ts";
import { readUniversalTimeOffset } from "../../internal/universal-time.ts";
import {
  INTERNAL_PACKAGE,
  LAYOUT_PART,
  SLIDE_DOCUMENT,
  type SlideData,
} from "../_internal-symbols.ts";
import { commitSlideData, refreshSlideData } from "./_helpers.ts";
import { getSlideLayout } from "./shape-slide-read.ts";
import { getSlideMasterPartName } from "./shape-read-base.ts";

const isTransition = (element: XmlElement): boolean =>
  element.name.namespaceURI === NS.pml &&
  element.name.localName === "transition";

// A replacement or explicit removal affects all alternatives, including ones
// this reader cannot play. Otherwise a reader could select the stale Choice
// on reopening and ignore the user's change. Leave unrelated branch content.
const removeTransitionChildren = (parent: XmlElement): boolean => {
  let removed = false;
  parent.children = parent.children.filter((child) => {
    if (child.kind !== "element") return true;
    if (isTransition(child)) {
      removed = true;
      return false;
    }
    if (!isAlternateContent(child)) return true;
    let branchChanged = false;
    for (const branch of childElements(child).filter(isAlternateContentBranch))
      if (removeTransitionChildren(branch)) branchChanged = true;
    removed ||= branchChanged;
    // Drop only a wrapper emptied by this edit. Unknown siblings and content
    // in another branch survive, as do unrelated empty compatibility blocks.
    return (
      !branchChanged ||
      childElements(child).some(
        (element) =>
          !isAlternateContentBranch(element) ||
          element.children.some(
            (node) =>
              node.kind === "element" ||
              ((node.kind === "text" || node.kind === "cdata") &&
                !!node.data.trim()),
          ),
      )
    );
  });
  return removed;
};
const removeTransition = (slide: SlideData): void => {
  removeTransitionChildren(slide[SLIDE_DOCUMENT].root);
};

// The base namespace is sufficient to determine insertion order from a
// legacy transition alternative. Reading uses the feature policy below.
const TRANSITION_NAMESPACES: ReadonlySet<string> = new Set([NS.pml]);
const PRESET_EFFECTS = new Set(["pageCurlDouble", "pageCurlSingle"]);
const presetEffect = (element: XmlElement): string | null => {
  if (
    element.name.namespaceURI !== NS.p15 ||
    element.name.localName !== "prstTrans"
  )
    return null;
  const preset = getAttrValue(element, qname("", "prst", ""));
  return preset !== null && PRESET_EFFECTS.has(preset) ? preset : null;
};

export interface SlideTransitionReadOptions {
  /** Effects understood by a consumer when selecting compatibility choices.
   * Omit to read the base catalog and known p15 presets. Direct
   * unsupported effects are retained in the package.
   */
  supportedEffects?: ReadonlySet<string>;
}

// Supporting p14:dur does not imply supporting p14's effect catalog. Inspect
// only the logical content of a candidate, including selected nested choices,
// before accepting it. Keep all original alternatives in the package.
const transitionSupport = (options: SlideTransitionReadOptions) => {
  const supportedContent = (parent: XmlElement): boolean => {
    if (parent.name.namespaceURI !== NS.mc) {
      const preset = presetEffect(parent);
      if (parent.name.namespaceURI !== NS.pml && !preset) return false;
      for (const { name } of parent.attrs) {
        if (
          !name.namespaceURI ||
          name.namespaceURI === NS.xml ||
          name.namespaceURI === NS.mc ||
          name.namespaceURI === NS.officeDocRels
        )
          continue;
        if (
          isTransition(parent) &&
          name.namespaceURI === NS.p14 &&
          name.localName === "dur"
        )
          continue;
        return false;
      }
    }
    for (const child of effectiveChildElements(parent, supports)) {
      if (
        isTransition(parent) &&
        options.supportedEffects &&
        !["sndAc", "extLst"].includes(child.name.localName) &&
        !options.supportedEffects.has(
          presetEffect(child) ?? child.name.localName,
        )
      )
        return false;
      if (!supportedContent(child)) return false;
    }
    return true;
  };
  const supports = (uri: string, choice: XmlElement): boolean => {
    if (uri !== NS.pml && uri !== NS.p14 && uri !== NS.p15) return false;
    if (uri === NS.pml && !options.supportedEffects) return true;
    return supportedContent(choice);
  };
  return supports;
};

const insertTransition = (slide: SlideData, transition: XmlElement): void => {
  const root = slide[SLIDE_DOCUMENT].root;
  // CT_Slide's sequence applies to logical children, including a clrMapOvr
  // or timing inside AlternateContent. Keep the wrapper intact on insertion.
  const ranks: Readonly<Record<string, number>> = {
    cSld: 0,
    clrMapOvr: 1,
    transition: 2,
    timing: 3,
    extLst: 4,
  };
  insertChildByRank(root, transition, (element) => {
    const logical = effectiveChildElements(
      { ...root, children: [element] },
      TRANSITION_NAMESPACES,
    );
    let rank = Infinity;
    for (const child of logical)
      if (child.name.namespaceURI === NS.pml)
        rank = Math.min(rank, ranks[child.name.localName] ?? Infinity);
    return rank;
  });
};

const findTransition = (
  root: XmlElement,
  options: SlideTransitionReadOptions,
): XmlElement | undefined =>
  [...effectiveChildElements(root, transitionSupport(options))].find(
    isTransition,
  );

const readAdvanceTime = (value: string | null): number | undefined => {
  if (value === null || !/^[+-]?\d+$/.test(value.trim())) return undefined;
  try {
    return unsignedIntMs(Number(value), "transition: advTm");
  } catch {
    // Tolerate malformed imports without copying an invalid timer into a
    // later edit. The source XML remains untouched until explicitly edited.
    return undefined;
  }
};

const readTransition = (
  transition: XmlElement,
  options: SlideTransitionReadOptions,
): TransitionOptions => {
  const speed = getAttrValue(transition, qname("", "spd", ""))?.trim();
  const advClick = getAttrValue(transition, qname("", "advClick", ""))?.trim();
  const advanceAfterMs = readAdvanceTime(
    getAttrValue(transition, qname("", "advTm", "")),
  );
  const durationMs = readUniversalTimeOffset(
    getAttrValue(transition, qname("p14", "dur", NS.p14)),
  );
  // The effect child identifies the animation (`p:fade`, `p:wipe`, ...).
  let effect: string | null = null;
  let direction: string | null = null;
  let orientation: "horz" | "vert" | null = null;
  let thruBlack: boolean | undefined;
  let invertX: boolean | undefined;
  let invertY: boolean | undefined;
  for (const child of effectiveChildElements(
    transition,
    transitionSupport(options),
  )) {
    const preset = presetEffect(child);
    if (preset) {
      effect = preset;
      const boolean = (name: string): boolean | undefined => {
        const value = getAttrValue(child, qname("", name, ""))?.trim();
        if (value === "1" || value === "true") return true;
        if (value === "0" || value === "false") return false;
        return undefined;
      };
      invertX = boolean("invX");
      invertY = boolean("invY");
      break;
    }
    if (child.name.namespaceURI !== NS.pml) continue;
    // Sound and extension metadata are not transition effects. An absent
    // effect means an explicit no-effect override, even with sound/timing.
    if (child.name.localName === "sndAc" || child.name.localName === "extLst")
      continue;
    effect = child.name.localName;
    direction = getAttrValue(child, qname("", "dir", ""));
    const o = getAttrValue(child, qname("", "orient", ""));
    if (o === "horz" || o === "vert") orientation = o;
    const tb = getAttrValue(child, qname("", "thruBlk", ""))?.trim();
    if (tb !== undefined) thruBlack = tb === "1" || tb === "true";
    break;
  }
  return {
    effect: effect ?? "none",
    ...(speed === "slow" || speed === "med" || speed === "fast"
      ? { speed }
      : {}),
    ...(direction !== null ? { direction } : {}),
    ...(orientation !== null ? { orientation } : {}),
    ...(thruBlack !== undefined ? { thruBlack } : {}),
    ...(invertX !== undefined ? { invertX } : {}),
    ...(invertY !== undefined ? { invertY } : {}),
    ...(advClick !== undefined
      ? { advanceOnClick: advClick !== "0" && advClick !== "false" }
      : {}),
    ...(advanceAfterMs !== undefined ? { advanceAfterMs } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
};

/**
 * Reads the slide's local transition, selecting understood alternatives or
 * the authored fallback without rewriting XML. `null` means no local
 * transition; `{ effect: "none" }` is an explicit no-effect override.
 * Use `getEffectiveSlideTransition` to include layout/master inheritance.
 */
export const getSlideTransition = (
  slide: SlideData,
  options: SlideTransitionReadOptions = {},
): TransitionOptions | null => {
  const transition = findTransition(slide[SLIDE_DOCUMENT].root, options);
  return transition ? readTransition(transition, options) : null;
};

// The nearest transition element wins as a whole. Defaults on a present
// element do not inherit attributes or an effect from a more distant level.
// Resolve relationships on each read; package XML caching is byte-invalidated.
const effectiveTransitionElement = (
  slide: SlideData,
  options: SlideTransitionReadOptions,
): XmlElement | undefined => {
  const own = findTransition(slide[SLIDE_DOCUMENT].root, options);
  if (own) return own;
  const layout = getSlideLayout(slide);
  const inherited = layout && findTransition(layout[LAYOUT_PART].root, options);
  if (inherited) return inherited;
  const masterName = getSlideMasterPartName(slide);
  const master = masterName
    ? slide[INTERNAL_PACKAGE].getPart(partName(masterName))
    : null;
  const root = master ? readOnlyPartRoot(master) : null;
  return root ? findTransition(root, options) : undefined;
};

/**
 * Resolves slide → layout → master transition precedence, including explicit
 * no-effect overrides. Returns `null` only when all three levels omit it.
 */
export const getEffectiveSlideTransition = (
  slide: SlideData,
  options: SlideTransitionReadOptions = {},
): TransitionOptions | null => {
  const transition = effectiveTransitionElement(slide, options);
  return transition ? readTransition(transition, options) : null;
};

/** Sets the slide's transition effect. */
export const setSlideTransition = (
  slide: SlideData,
  options: TransitionOptions,
): void => {
  const transition = buildTransition(options);
  removeTransition(slide);
  insertTransition(slide, transition);
  commitSlideData(slide);
  refreshSlideData(slide);
};

/** Removes the local transition, restoring layout/master inheritance. */
export const clearSlideTransition = (slide: SlideData): void => {
  removeTransition(slide);
  commitSlideData(slide);
  refreshSlideData(slide);
};
