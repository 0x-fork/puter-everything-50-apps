// The Draw tab: pens and a highlighter that ink on the slide, and an eraser
// that takes ink away. Each stroke becomes a freeform shape with a smooth
// path and round ends, so it moves, recolours, copies and is saved in the
// .pptx like any other drawing.
import "./draw-tab.css";
import { el, openMenu } from "./ui.js";
import { colorMenuItems } from "./color-palette.js";

const PT = 12700;
const PENS = [
  {
    id: "pen1",
    label: "Pen: Black, 1 mm",
    color: "#000000",
    width: 1,
    kind: "pen",
  },
  {
    id: "pen2",
    label: "Pen: Red, 1 mm",
    color: "#E81224",
    width: 1,
    kind: "pen",
  },
  {
    id: "pen3",
    label: "Pen: Blue, 1 mm",
    color: "#0063B1",
    width: 1,
    kind: "pen",
  },
  {
    id: "highlighter",
    label: "Highlighter: Yellow, 6 mm",
    color: "#FFFF00",
    width: 6,
    kind: "highlighter",
  },
];
const WIDTHS = [0.25, 0.5, 1, 2, 3.5];
const HIGHLIGHTER_WIDTHS = [2, 4, 6, 8, 10];
// A millimetre of pen is drawn this many points wide; pen sizes are named
// in millimetres.
const MM = 2.835;
export const INK_NAME = "Ink";

export function createDrawTools({
  P,
  canvas,
  slideSize,
  currentSlide,
  mutateSlide,
  onToolChange,
  theme,
}) {
  let tool = null; // null (select) | pen id | "eraser"
  const pens = PENS.map((p) => ({ ...p }));
  let layer = null;

  function setTool(next) {
    tool = tool === next ? null : next;
    const node = canvas();
    node?.classList.toggle("inking", !!tool);
    node?.setAttribute("data-ink-tool", tool || "");
    attach();
    onToolChange?.(tool);
  }
  // A layer over the slide takes the pointer while a pen or the eraser is
  // chosen, so drawing never moves the objects under it.
  function attach() {
    const node = canvas();
    if (!node) return;
    if (!tool) {
      layer?.remove();
      layer = null;
      return;
    }
    if (!layer || !layer.isConnected) {
      layer = el("div", { class: "ink-layer", "aria-hidden": "true" });
      layer.addEventListener("pointerdown", down);
      node.append(layer);
    }
    layer.dataset.tool =
      tool === "eraser"
        ? "eraser"
        : pens.find((p) => p.id === tool)?.kind || "pen";
  }
  function pen() {
    return pens.find((p) => p.id === tool);
  }
  function toEmu(e) {
    const rect = canvas().getBoundingClientRect();
    const size = slideSize();
    return {
      x: ((e.clientX - rect.left) / rect.width) * size.cx,
      y: ((e.clientY - rect.top) / rect.height) * size.cy,
    };
  }
  function down(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    layer.setPointerCapture(e.pointerId);
    if (tool === "eraser") return erase(e);
    const p = pen();
    if (!p) return;
    const rect = canvas().getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ink-live");
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const pxPerEmu = rect.width / slideSize().cx;
    path.setAttribute("stroke", p.color);
    path.setAttribute(
      "stroke-width",
      String(Math.max(1, p.width * MM * PT * pxPerEmu)),
    );
    path.setAttribute("stroke-opacity", p.kind === "highlighter" ? "0.5" : "1");
    svg.append(path);
    layer.append(svg);
    const points = [toEmu(e)];
    const screen = [[e.clientX - rect.left, e.clientY - rect.top]];
    const move = (ev) => {
      for (const c of ev.getCoalescedEvents?.() || [ev]) {
        points.push(toEmu(c));
        screen.push([c.clientX - rect.left, c.clientY - rect.top]);
      }
      path.setAttribute("d", "M" + screen.map((pt) => pt.join(" ")).join("L"));
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      svg.remove();
      commit(points, p);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }
  // A stroke's points thinned to the ones that matter and drawn through with
  // a smooth curve, in a box that holds the whole line.
  function commit(points, p) {
    const size = slideSize();
    const tolerance = size.cx / 2000;
    const kept = simplify(points, tolerance);
    if (kept.length === 1)
      kept.push({ x: kept[0].x + tolerance, y: kept[0].y });
    const xs = kept.map((q) => q.x),
      ys = kept.map((q) => q.y);
    const minX = Math.min(...xs),
      minY = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - minX),
      h = Math.max(1, Math.max(...ys) - minY);
    const local = kept.map((q) => ({ x: q.x - minX, y: q.y - minY }));
    const commands = [{ type: "moveTo", ...local[0] }];
    for (let i = 0; i < local.length - 1; i++) {
      const p0 = local[i - 1] || local[i],
        p1 = local[i],
        p2 = local[i + 1],
        p3 = local[i + 2] || p2;
      // Catmull-Rom through the points, as cubic Bézier segments.
      commands.push({
        type: "cubicTo",
        x1: p1.x + (p2.x - p0.x) / 6,
        y1: p1.y + (p2.y - p0.y) / 6,
        x2: p2.x - (p3.x - p1.x) / 6,
        y2: p2.y - (p3.y - p1.y) / 6,
        x: p2.x,
        y: p2.y,
      });
    }
    const target = currentSlide();
    mutateSlide(target, (s) => {
      const shape = P.addSlideShape(s, {
        preset: "rect",
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(w),
        h: Math.round(h),
        name: `${INK_NAME} ${Date.now() % 100000}`,
      });
      P.setShapeFreeformPaths(shape, [
        { w: Math.round(w), h: Math.round(h), fill: false, commands },
      ]);
      P.setShapeNoFill(shape);
      P.setShapeStroke(shape, {
        color: p.kind === "highlighter" ? `${p.color}/alpha=50000` : p.color,
        widthEmu: Math.round(p.width * MM * PT),
      });
      P.setShapeStrokeCap(shape, "rnd");
      P.setShapeStrokeJoin(shape, "round");
    });
  }
  // The eraser removes the ink strokes its path crosses: each step of the
  // pointer is a segment tested against each stroke's line.
  function erase(e) {
    const hits = new Set();
    let last = toEmu(e);
    const check = (from, to) => {
      const reach = slideSize().cx / 250;
      for (const shape of P.getSlideShapes(currentSlide())) {
        if (!isInk(shape) || hits.has(P.getShapeId(shape))) continue;
        const width = (P.getShapeStrokeWidth?.(shape) || 0) / 2;
        const line = strokePoints(shape);
        for (let i = 1; i < line.length; i++)
          if (
            segmentDistance(from, to, line[i - 1], line[i]) <=
            reach + width
          ) {
            hits.add(P.getShapeId(shape));
            break;
          }
      }
    };
    check(last, last);
    const move = (ev) => {
      for (const c of ev.getCoalescedEvents?.() || [ev]) {
        const at = toEmu(c);
        check(last, at);
        last = at;
      }
    };
    const up = () => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      if (!hits.size) return;
      mutateSlide(currentSlide(), (s) => {
        for (const id of hits) {
          const shape = P.findShapeById(s, id);
          if (shape) P.removeShape(shape);
        }
      });
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }
  // A stroke's line on the slide: the on-curve points of its path, mapped
  // through the shape's box.
  function strokePoints(shape) {
    const b = P.getShapeBounds(shape);
    if (!b) return [];
    let path = null;
    try {
      path = P.getShapeCustomGeometry(shape)?.paths?.[0];
    } catch {}
    if (!path)
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ];
    const sx = b.w / (path.w || b.w || 1),
      sy = b.h / (path.h || b.h || 1);
    const out = [];
    for (const c of path.commands) {
      const pt = c.pt || c.pts?.at(-1);
      if (pt) out.push({ x: b.x + pt.x * sx, y: b.y + pt.y * sy });
    }
    return out;
  }
  function isInk(shape) {
    return (
      P.getShapeKind(shape) === "shape" &&
      String(P.getShapeName?.(shape) || "").startsWith(`${INK_NAME} `)
    );
  }
  function penMenu(p) {
    const widths = p.kind === "highlighter" ? HIGHLIGHTER_WIDTHS : WIDTHS;
    return [
      { header: "Thickness" },
      ...widths.map((w) => ({
        label: `${w} mm`,
        checked: p.width === w,
        onSelect: () => {
          p.width = w;
          p.label = `${p.kind === "highlighter" ? "Highlighter" : "Pen"}: ${w} mm`;
          if (tool !== p.id) setTool(p.id);
          onToolChange?.(tool);
        },
      })),
      { separator: true },
      { header: "Color" },
      ...colorMenuItems({
        theme: theme(),
        current: p.color,
        onPick: (value, hex) => {
          p.color = hex || value;
          if (tool !== p.id) setTool(p.id);
          onToolChange?.(tool);
        },
      }),
    ];
  }
  function penIcon(p) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 32");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "40");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      p.kind === "highlighter"
        ? `<path d="M6 2h8v14l-2 4H8l-2-4z" fill="#f2f2f2" stroke="#8a8a8a"/><path d="M8 20h4l-1 6H9z" fill="${p.color}" stroke="#8a8a8a"/><rect x="6" y="8" width="8" height="4" fill="${p.color}"/>`
        : `<path d="M7 2h6v16l-3 8-3-8z" fill="#f2f2f2" stroke="#8a8a8a"/><path d="M8.2 21h3.6L10 26z" fill="${p.color}"/><rect x="7" y="9" width="6" height="4" fill="${p.color}"/>`;
    return svg;
  }
  // The tab, in the ribbon's declarative form.
  function tab() {
    return {
      id: "draw",
      label: "Draw",
      after: "insert",
      groups: [
        {
          id: "drawing-tools",
          label: "Drawing Tools",
          icon: "penTool",
          collapsible: false,
          items: [
            {
              type: "large",
              id: "draw-select",
              label: "Select",
              icon: "select",
              title: "Select Objects",
              description: "Stop drawing and select objects on the slide.",
              pressed: () => !tool,
              run: () => tool && setTool(tool),
            },
            ...pens.map((p) => ({
              type: "custom",
              render: () => {
                const face = el(
                  "button",
                  {
                    type: "button",
                    class: "ribbon-btn ink-pen",
                    "aria-label": p.label,
                    "aria-pressed": "false",
                    "data-command": `draw-${p.id}`,
                    "data-tip-title": p.label,
                    "data-tip-text":
                      "Click again to choose its colour and thickness.",
                    onclick: (e) => {
                      if (tool === p.id) {
                        e.currentTarget.setAttribute("aria-expanded", "true");
                        const anchor = e.currentTarget;
                        openMenu({
                          anchor,
                          label: p.label,
                          items: penMenu(p),
                          minWidth: 240,
                          onClose: () =>
                            anchor.setAttribute("aria-expanded", "false"),
                        });
                      } else setTool(p.id);
                    },
                  },
                  penIcon(p),
                );
                return face;
              },
              sync: (node) => {
                node.setAttribute("aria-pressed", String(tool === p.id));
                node.setAttribute("aria-label", p.label);
                node.replaceChildren(penIcon(p));
              },
            })),
            {
              type: "large",
              id: "draw-eraser",
              label: "Eraser",
              icon: "eraserTool",
              title: "Eraser",
              description: "Erase ink strokes by drawing over them.",
              pressed: () => tool === "eraser",
              run: () => setTool("eraser"),
            },
          ],
        },
      ],
    };
  }
  return {
    tab,
    get tool() {
      return tool;
    },
    setTool,
    attach,
    stop: () => tool && setTool(tool),
    isInk,
  };
}

// Ramer–Douglas–Peucker: the fewest points that stay within `tolerance` of
// the stroke drawn.
function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1,
      far = sq;
    const ax = points[a].x,
      ay = points[a].y,
      dx = points[b].x - ax,
      dy = points[b].y - ay;
    const len = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(
        0,
        Math.min(1, ((points[i].x - ax) * dx + (points[i].y - ay) * dy) / len),
      );
      const ex = ax + t * dx - points[i].x,
        ey = ay + t * dy - points[i].y;
      const d = ex * ex + ey * ey;
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
// The shortest distance between segments ab and cd.
function segmentDistance(a, b, c, d) {
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c),
    d2 = cross(a, b, d),
    d3 = cross(c, d, a),
    d4 = cross(c, d, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const toSegment = (p, q, r) => {
    const dx = r.x - q.x,
      dy = r.y - q.y;
    const len = dx * dx + dy * dy;
    const t = len
      ? Math.max(0, Math.min(1, ((p.x - q.x) * dx + (p.y - q.y) * dy) / len))
      : 0;
    return Math.hypot(q.x + t * dx - p.x, q.y + t * dy - p.y);
  };
  return Math.min(
    toSegment(a, c, d),
    toSegment(b, c, d),
    toSegment(c, a, b),
    toSegment(d, a, b),
  );
}
