import { escape } from "../model.js";
import { t, language } from "../i18n.js";
import { objectNameHTML } from "./object-content.js";

// Objects in the order a screen reader meets them: each frame, in the order
// frames are presented, followed by what it holds, then everything outside
// frames. Otherwise the board's own order is kept.
export function outlineOrder(items) {
  const frames = items
    .filter((i) => i.type === "frame")
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!frames.length) return items;
  const held = new Map(frames.map((f) => [f.id, []])),
    rest = [];
  for (const i of items)
    if (i.type !== "frame") (held.get(i.parentId) || rest).push(i);
  return [...frames.flatMap((f) => [f, ...held.get(f.id)]), ...rest];
}

// Only pass the objects this person may read, with private content masked.
// A relationship must never recover a name from the unfiltered board.
export function objectRelationships(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = new Map();
  const children = new Map();
  for (const i of items) {
    if (i.groupId) {
      if (!groups.has(i.groupId))
        groups.set(i.groupId, { number: groups.size + 1, count: 0 });
      groups.get(i.groupId).count++;
    }
    if (i.parentId)
      children.set(i.parentId, (children.get(i.parentId) || 0) + 1);
  }
  const label = (value) => escape(t(value));
  // French sets a colon apart with a space.
  const colon = language === "fr" ? " :" : ":";
  const count = (n) =>
    `${n} ${label(n === 1 ? "visible object" : "visible objects")}`;
  // A frame holding hundreds of objects is named once for all of them.
  const names = new Map();
  const name = (id) => {
    if (names.has(id)) return names.get(id);
    const target = byId.get(id);
    const html = target ? objectNameHTML(target, 120) : label("Hidden object");
    names.set(id, html);
    return html;
  };
  const cap = (value) =>
    label(
      value === "arrow" ? "Arrowhead" : value === "circle" ? "Dot" : "None",
    );
  const describe = (i) => {
    const parts = [];
    if (i.parentId)
      parts.push(`${label("In frame")}${colon} ${name(i.parentId)}.`);
    if (i.type === "frame" && children.has(i.id))
      parts.push(`${label("Contains")}${colon} ${count(children.get(i.id))}.`);
    if (i.groupId) {
      const group = groups.get(i.groupId);
      parts.push(
        `${label("Group")} ${group.number}${colon} ${count(group.count)}.`,
      );
    }
    if (i.mindMap?.parent)
      parts.push(
        `${label("Mind map parent")}${colon} ${name(i.mindMap.parent)}.`,
      );
    if (i.type === "arrow") {
      parts.push(
        `${label("Start object")}${colon} ${i.startId ? name(i.startId) : label("Free endpoint")}.`,
      );
      parts.push(
        `${label("End object")}${colon} ${i.endId ? name(i.endId) : label("Free endpoint")}.`,
      );
      parts.push(
        `${label("Start")}${colon} ${cap(i.startCap || "none")}. ${label("End")}${colon} ${cap(i.endCap || "arrow")}.`,
      );
    }
    return parts.join(" ");
  };
  // Each description is written when first asked for: a long outline is
  // written a part at a time, and the objects dialog shows a few hundred.
  const descriptions = new Map();
  return {
    get(id) {
      if (!descriptions.has(id) && byId.has(id))
        descriptions.set(id, describe(byId.get(id)));
      return descriptions.get(id);
    },
  };
}
