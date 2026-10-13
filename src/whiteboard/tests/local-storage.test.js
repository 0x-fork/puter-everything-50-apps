import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { local } from "../src/storage.js";
import { board, item, undoCopy } from "../src/model.js";

test("storage upgrades preserve boards and bound isolated recovery snapshots", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Existing board");
  b.items.push(item("note", 10, 20, { text: "Original idea" }));
  const legacy = await new Promise((resolve, reject) => {
    const request = indexedDB.open("whiteboard-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("boards", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = legacy.transaction("boards", "readwrite");
    tx.objectStore("boards").put(b);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  legacy.close();
  assert.equal((await local.list())[0].title, "Existing board");
  let now = Date.now();
  t.mock.method(Date, "now", () => ++now);
  await local.checkpoint(b, "First");
  b.items[0].text = "Updated idea";
  assert.equal(
    (await local.revisions(b.id))[0].board.items[0].text,
    "Original idea",
  );
  for (let n = 0; n < 32; n++) await local.checkpoint(b, `Edit ${n}`);
  const revisions = await local.revisions(b.id);
  assert.equal(revisions.length, 30);
  assert.ok(!revisions.some((r) => r.label === "First"));
  assert.ok(revisions.some((r) => r.label === "Edit 31"));
  await local.saveTemplate(b);
  assert.equal((await local.templates())[0].items[0].text, "Updated idea");
  await local.removeTemplate(b.id);
  assert.equal((await local.templates()).length, 0);
});

test("recovery versions are pruned without reading every version back on each edit", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Busy board");
  b.items.push(item("note", 0, 0, { text: "Idea" }));
  let now = Date.now();
  t.mock.method(Date, "now", () => ++now);
  const reads = t.mock.method(local, "revisions");
  for (let n = 0; n < 45; n++) await local.checkpoint(b, `Edit ${n}`);
  // The versions are read when the board is first seen and now and then
  // after, not on every edit.
  assert.ok(reads.mock.callCount() <= 3, `${reads.mock.callCount()} reads`);
  reads.mock.restore();
  const revisions = await local.revisions(b.id);
  assert.equal(revisions.length, 30);
  assert.ok(revisions.some((r) => r.label === "Edit 44"));
  assert.ok(!revisions.some((r) => r.label === "Edit 14"));
});

test("the newest recovery version stays until the next one is written, and a board's versions can be removed", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Heavy board");
  // Each version is over half the budget, so the one before is over it.
  b.items.push(item("note", 0, 0, { text: "x".repeat(14 * 1024 * 1024) }));
  let now = Date.now();
  t.mock.method(Date, "now", () => ++now);
  await local.checkpoint(b, "First");
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...rest) {
    if (value?.label === "Second")
      throw new DOMException("No room", "QuotaExceededError");
    return put.call(this, value, ...rest);
  };
  try {
    await assert.rejects(local.checkpoint(b, "Second"));
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.deepEqual(
    (await local.revisions(b.id)).map((r) => r.label),
    ["First"],
    "A failed write leaves the version before in place",
  );
  await local.checkpoint(b, "Third");
  assert.deepEqual(
    (await local.revisions(b.id)).map((r) => r.label),
    ["Third"],
    "Once written, the version before makes room",
  );
  await local.save(b);
  await local.remove(b.id);
  await local.removeRevisions(b.id);
  assert.deepEqual(await local.revisions(b.id), []);
  assert.ok(!(await local.list()).some((saved) => saved.id === b.id));
});

test("two tabs keeping versions of one board share its budget instead of each keeping thirty", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  // Each tab has its own copy of the storage module and so its own cache.
  const { local: tabA } = await import("../src/storage.js?tab=a");
  const { local: tabB } = await import("../src/storage.js?tab=b");
  const b = board("Shared between tabs");
  b.items.push(item("note", 0, 0, { text: "Idea" }));
  let now = Date.now();
  t.mock.method(Date, "now", () => ++now);
  for (let n = 0; n < 25; n++) {
    await tabA.checkpoint(b, `A ${n}`);
    await tabB.checkpoint(b, `B ${n}`);
  }
  const revisions = await tabA.revisions(b.id);
  assert.equal(revisions.length, 30);
  // The newest versions from both tabs are among those kept.
  assert.ok(revisions.some((r) => r.label === "A 24"));
  assert.ok(revisions.some((r) => r.label === "B 24"));
});

test("after a burst of edits, versions from earlier in the day can still be restored", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Workshop board");
  b.items.push(item("note", 0, 0, { text: "Idea" }));
  const start = Date.UTC(2026, 9, 9, 9, 0);
  let now = start;
  t.mock.method(Date, "now", () => now);
  // Two hours of work, a few edits every five minutes.
  for (let minute = 0; minute < 120; minute += 5)
    for (let n = 0; n < 3; n++) {
      now = start + minute * 60_000 + (n + 1) * 1000;
      await local.checkpoint(b, `At ${minute}:${n}`);
    }
  now += 60_000;
  // Then 40 quick edits within a minute.
  for (let n = 0; n < 40; n++) {
    now += 1000;
    await local.checkpoint(b, `Burst ${n}`);
  }
  const labels = (await local.revisions(b.id)).map((r) => r.label);
  assert.ok(labels.includes("Burst 39"));
  assert.equal(labels.filter((l) => l.startsWith("Burst")).length, 30);
  // One version of each earlier quarter hour remains, the latest in it.
  const earlier = labels.filter((l) => l.startsWith("At "));
  assert.ok(earlier.length >= 7, earlier.join(", "));
  assert.ok(earlier.includes("At 10:2"), "the end of the first quarter hour");
  assert.ok(!earlier.includes("At 10:1"));
});

test("recovery versions sharing a drawing's points measure them at their written size", async () => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Drawings");
  const points = Array.from({ length: 500 }, (_, k) => [k * 0.5, k % 7]);
  b.items.push(
    item("pen", 0, 0, { w: 250, h: 6, points }),
    item("note", 0, 0, { text: "Plain words" }),
  );
  const first = await local.checkpoint(undoCopy(b), "First", { owned: true });
  b.items[1].text = "Longer words than before";
  const second = await local.checkpoint(undoCopy(b), "Second", {
    owned: true,
  });
  assert.equal(second.board.items[0].points, first.board.items[0].points);
  for (const revision of [first, second]) {
    const { bytes, ...written } = revision;
    assert.equal(bytes, JSON.stringify(written).length * 2);
  }
});

test("a recovery version is measured without writing the board out as JSON, and a copy handed over is not copied again", async (t) => {
  globalThis.indexedDB = new IDBFactory();
  const b = board("Pictures");
  b.items.push(
    item("image", 0, 0, {
      src: "data:image/png;base64," + "A".repeat(200_000),
    }),
    item("note", 0, 0, { text: "Plain words", lang: "en" }),
  );
  const stringify = t.mock.method(JSON, "stringify");
  const revision = await local.checkpoint(b, "Owned", { owned: true });
  assert.equal(stringify.mock.callCount(), 0, "nothing written out as JSON");
  stringify.mock.restore();
  // The size counted is the one writing it out gave, before it was noted.
  const { bytes, ...written } = revision;
  assert.equal(bytes, JSON.stringify(written).length * 2);
  assert.equal(revision.board, b, "a copy handed over is kept as it is");
  // A board still being edited is copied, so later edits stay out of it.
  const copied = await local.checkpoint(b, "Copied");
  assert.notEqual(copied.board, b);
  b.items[1].text = "Changed";
  const [latest] = (await local.revisions(b.id)).sort(
    (x, y) => y.created - x.created,
  );
  assert.equal(latest.board.items[1].text, "Plain words");
});
