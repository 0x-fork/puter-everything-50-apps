// Where an object added without a pointer goes, as from a shortcut, the
// command search or the shapes picker: the spot asked for, or else the
// nearest one in view that nothing else covers. Several people adding sticky
// notes from the keyboard while they look at the same place, as when they
// follow a facilitator, or one person adding a few in a row, then see each
// note beside the others rather than only the last one on top of them.
// Frames and connectors may lie under a new object, and lie across the
// whole of a section, so they never count as covering a spot.
const UNDERNEATH = new Set(["frame", "arrow"]);
// Up to this many steps out from the spot asked for, in each direction.
const RINGS = 6;
// `turn`, a fraction of a full turn, starts the search in another
// direction, so people adding notes at the same moment, before each sees the
// others', mostly take different spots around the same middle.
export function freeSpot(
  items,
  box,
  view,
  { gap = 24, margin = 8, turn = 0 } = {},
) {
  const inside = (b) =>
    b.x >= view.x &&
    b.y >= view.y &&
    b.x + b.w <= view.x + view.w &&
    b.y + b.h <= view.y + view.h;
  // Only objects near the view can cover a spot in it.
  const reach = {
    x: Math.min(view.x, box.x) - margin,
    y: Math.min(view.y, box.y) - margin,
    r: Math.max(view.x + view.w, box.x + box.w) + margin,
    b: Math.max(view.y + view.h, box.y + box.h) + margin,
  };
  const solid = [];
  for (const i of items) {
    if (UNDERNEATH.has(i.type)) continue;
    const x = Math.min(i.x, i.x + i.w),
      y = Math.min(i.y, i.y + i.h),
      r = Math.max(i.x, i.x + i.w),
      b = Math.max(i.y, i.y + i.h);
    if (r < reach.x || x > reach.r || b < reach.y || y > reach.b) continue;
    solid.push({ x, y, r, b });
  }
  const free = (c) =>
    !solid.some(
      (s) =>
        c.x < s.r + margin &&
        c.x + c.w > s.x - margin &&
        c.y < s.b + margin &&
        c.y + c.h > s.y - margin,
    );
  const start = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (free(start)) return { x: box.x, y: box.y };
  // Nearest first; at the same distance, to the right, then below, then
  // around clockwise, as reading continues, from where `turn` starts.
  const cells = [];
  for (let dy = -RINGS; dy <= RINGS; dy++)
    for (let dx = -RINGS; dx <= RINGS; dx++)
      if (dx || dy)
        cells.push({
          dx,
          dy,
          d: dx * dx + dy * dy,
          a:
            (Math.atan2(dy, dx) - 2 * Math.PI * turn + 4 * Math.PI) %
            (2 * Math.PI),
        });
  cells.sort((p, q) => p.d - q.d || p.a - q.a);
  for (const { dx, dy } of cells) {
    const c = {
      x: box.x + dx * (box.w + gap),
      y: box.y + dy * (box.h + gap),
      w: box.w,
      h: box.h,
    };
    if (inside(c) && free(c)) return { x: c.x, y: c.y };
  }
  // A view with no room left keeps the spot asked for.
  return { x: box.x, y: box.y };
}
