import test from "node:test";
import assert from "node:assert/strict";
import { freeSpot } from "../src/placement.js";

const view = { x: 0, y: 0, w: 1000, h: 800 };
const box = { x: 400, y: 300, w: 200, h: 200 };

test("an object added without a pointer keeps a free spot", () => {
  assert.deepEqual(freeSpot([], box, view), { x: 400, y: 300 });
  // Frames and connectors lie under content, so they never take a spot.
  assert.deepEqual(
    freeSpot(
      [
        { type: "frame", x: 0, y: 0, w: 1000, h: 800 },
        { type: "arrow", x: 500, y: 400, w: -300, h: -200 },
      ],
      box,
      view,
    ),
    { x: 400, y: 300 },
  );
});

test("objects added one after another go beside each other, in view", () => {
  const items = [];
  for (let n = 0; n < 6; n++) {
    const p = freeSpot(items, box, view);
    for (const i of items)
      assert.ok(
        p.x >= i.x + i.w ||
          p.x + box.w <= i.x ||
          p.y >= i.y + i.h ||
          p.y + box.h <= i.y,
        `${JSON.stringify(p)} overlaps ${JSON.stringify(i)}`,
      );
    assert.ok(
      p.x >= 0 && p.y >= 0 && p.x + box.w <= 1000 && p.y + box.h <= 800,
    );
    items.push({ type: "note", ...p, w: box.w, h: box.h });
  }
  // The second goes to the right of the first, as reading continues.
  assert.deepEqual({ x: items[1].x, y: items[1].y }, { x: 624, y: 300 });
});

test("a full view keeps the spot asked for", () => {
  const wall = [{ type: "rect", x: -50, y: -50, w: 1100, h: 900 }];
  assert.deepEqual(freeSpot(wall, box, view), { x: 400, y: 300 });
});

test("people adding at once start looking in different directions", () => {
  const taken = [{ type: "note", ...box }];
  const spots = [0, 0.25, 0.5, 0.75].map((turn) =>
    JSON.stringify(freeSpot(taken, box, view, { turn })),
  );
  assert.equal(new Set(spots).size, 4);
});
