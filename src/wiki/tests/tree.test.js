import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { addPage, childrenOf, movePage, trashPage, restorePage, deletePage, isTrashed, ancestors, trashedPages, updatePage, getPage, wouldCycle } from '../src/data/tree.js';

describe('page tree', () => {
  it('keeps children in order', () => {
    const doc = new Y.Doc();
    const a = addPage(doc, { title: 'A' });
    const c = addPage(doc, { title: 'C' });
    addPage(doc, { title: 'B', after: a });
    addPage(doc, { title: '0', before: a });
    expect(childrenOf(doc).map((p) => p.title)).toEqual(['0', 'A', 'B', 'C']);
    expect(c).toBeTruthy();
  });

  it('moves pages and refuses cycles', () => {
    const doc = new Y.Doc();
    const a = addPage(doc, { title: 'A' });
    const b = addPage(doc, { title: 'B', parent: a });
    const c = addPage(doc, { title: 'C' });
    expect(wouldCycle(doc, a, b)).toBe(true);
    expect(movePage(doc, a, b)).toBe(false);
    expect(movePage(doc, c, a, { before: b })).toBe(true);
    expect(childrenOf(doc, a).map((p) => p.title)).toEqual(['C', 'B']);
    expect(ancestors(doc, b).map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('trashes a subtree and restores it', () => {
    const doc = new Y.Doc();
    const a = addPage(doc, { title: 'A' });
    const b = addPage(doc, { title: 'B', parent: a });
    trashPage(doc, a);
    expect(isTrashed(doc, b)).toBe(true);
    expect(childrenOf(doc)).toEqual([]);
    expect(trashedPages(doc).map((p) => p.id)).toEqual([a]);
    restorePage(doc, a);
    expect(isTrashed(doc, b)).toBe(false);
  });

  it('restores to the top level when the parent is gone', () => {
    const doc = new Y.Doc();
    const a = addPage(doc, { title: 'A' });
    const b = addPage(doc, { title: 'B', parent: a });
    trashPage(doc, b);
    trashPage(doc, a);
    restorePage(doc, b);
    expect(getPage(doc, b).parent).toBe(null);
  });

  it('deletes a page with everything under it', () => {
    const doc = new Y.Doc();
    const a = addPage(doc, { title: 'A' });
    const b = addPage(doc, { title: 'B', parent: a });
    addPage(doc, { title: 'X' });
    expect(deletePage(doc, a).sort()).toEqual([a, b].sort());
    expect(childrenOf(doc).map((p) => p.title)).toEqual(['X']);
  });

  it('hides database rows from children unless asked', () => {
    const doc = new Y.Doc();
    const db = addPage(doc, { title: 'DB', kind: 'database' });
    addPage(doc, { title: 'row', parent: db, row: true });
    expect(childrenOf(doc, db)).toEqual([]);
    expect(childrenOf(doc, db, { rows: true }).length).toBe(1);
  });

  it('merges concurrent renames and moves from two people', () => {
    const one = new Y.Doc();
    const a = addPage(one, { title: 'A' });
    const b = addPage(one, { title: 'B' });
    const two = new Y.Doc();
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    updatePage(one, a, { title: 'Renamed' });
    movePage(two, a, b);
    Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
    Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
    expect(getPage(one, a)).toMatchObject({ title: 'Renamed', parent: b });
    expect(getPage(two, a)).toMatchObject({ title: 'Renamed', parent: b });
  });
});
