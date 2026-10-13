import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as D from '../src/data/database.js';

function setup() {
  const doc = new Y.Doc();
  D.initDatabase(doc, { props: [{ name: 'Status', type: 'status' }, { name: 'Points', type: 'number' }, { name: 'Tags', type: 'multi' }, { name: 'Due', type: 'date' }, { name: 'Done', type: 'checkbox' }] });
  const props = Object.fromEntries(D.listProps(doc).map((p) => [p.name, p]));
  const pages = new Map();
  const row = (title, values = {}) => {
    const id = D.addRow(doc, { values });
    pages.set(id, { id, title, created: pages.size, updated: pages.size });
    return id;
  };
  return { doc, props, pages, row, pageOf: (id) => pages.get(id) };
}

describe('databases', () => {
  it('starts with a title property and a view', () => {
    const { doc } = setup();
    expect(D.listProps(doc)[0]).toMatchObject({ id: D.TITLE, type: 'title' });
    expect(D.listViews(doc)).toHaveLength(1);
  });

  it('creates select options once, case-insensitively', () => {
    const { doc, props } = setup();
    const a = D.ensureOption(doc, props.Tags.id, 'Urgent');
    const b = D.ensureOption(doc, props.Tags.id, 'urgent');
    expect(a).toBe(b);
    expect(D.getProp(doc, props.Tags.id).options).toHaveLength(1);
  });

  it('filters by text, number, select, multi-select, date and checkbox', () => {
    const { doc, props, row, pageOf } = setup();
    const done = props.Status.options[2].id;
    const urgent = D.ensureOption(doc, props.Tags.id, 'Urgent');
    row('Write docs', { [props.Points.id]: 3, [props.Status.id]: done, [props.Due.id]: '2026-10-01' });
    row('Fix login', { [props.Points.id]: 8, [props.Tags.id]: [urgent], [props.Done.id]: true, [props.Due.id]: '2026-11-01' });
    row('Plan offsite', {});
    const titles = (filters) => D.queryRows(doc, { filters }, pageOf).map((r) => r.page.title);
    expect(titles([{ prop: D.TITLE, op: 'contains', value: 'fix' }])).toEqual(['Fix login']);
    expect(titles([{ prop: props.Points.id, op: 'gte', value: '3' }])).toEqual(['Write docs', 'Fix login']);
    expect(titles([{ prop: props.Status.id, op: 'is', value: done }])).toEqual(['Write docs']);
    expect(titles([{ prop: props.Tags.id, op: 'has', value: urgent }])).toEqual(['Fix login']);
    expect(titles([{ prop: props.Due.id, op: 'before', value: '2026-10-15' }])).toEqual(['Write docs']);
    expect(titles([{ prop: props.Done.id, op: 'checked' }])).toEqual(['Fix login']);
    expect(titles([{ prop: props.Points.id, op: 'empty' }])).toEqual(['Plan offsite']);
    // An unfinished filter (no value yet) shows everything.
    expect(titles([{ prop: props.Status.id, op: 'is', value: '' }])).toHaveLength(3);
  });

  it('sorts with empty values last in both directions', () => {
    const { doc, props, row, pageOf } = setup();
    row('b', { [props.Points.id]: 2 });
    row('none');
    row('a', { [props.Points.id]: 10 });
    const sorted = (dir) => D.queryRows(doc, { sorts: [{ prop: props.Points.id, dir }] }, pageOf).map((r) => r.page.title);
    expect(sorted('asc')).toEqual(['b', 'a', 'none']);
    expect(sorted('desc')).toEqual(['a', 'b', 'none']);
  });

  it('searches every visible value', () => {
    const { doc, props, row, pageOf } = setup();
    const urgent = D.ensureOption(doc, props.Tags.id, 'Urgent');
    row('One', { [props.Tags.id]: [urgent] });
    row('Two');
    expect(D.queryRows(doc, {}, pageOf, { search: 'urg' }).map((r) => r.page.title)).toEqual(['One']);
  });

  it('groups rows into board columns', () => {
    const { doc, props, row } = setup();
    const [todo, doing] = props.Status.options;
    row('a', { [props.Status.id]: todo.id });
    row('b', { [props.Status.id]: doing.id });
    row('c');
    const groups = D.groupRows(D.listRows(doc), props.Status);
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([['No Status', 1], ['Not started', 1], ['In progress', 1], ['Done', 0]]);
  });

  it('gives new rows the values their view and column imply', () => {
    const { doc, props } = setup();
    const done = props.Status.options[2].id;
    const view = { filters: [{ prop: props.Done.id, op: 'checked' }], groupBy: props.Status.id };
    expect(D.defaultsFor(doc, view, done)).toEqual({ [props.Done.id]: true, [props.Status.id]: done });
  });

  it('clears values when a property is deleted', () => {
    const { doc, props, row } = setup();
    const id = row('a', { [props.Points.id]: 4 });
    D.deleteProp(doc, props.Points.id);
    expect(D.listRows(doc).find((r) => r.id === id).values).toEqual({});
    // The title cannot be deleted.
    D.deleteProp(doc, D.TITLE);
    expect(D.getProp(doc, D.TITLE)).toBeTruthy();
  });

  it('keeps at least one view', () => {
    const { doc } = setup();
    const [only] = D.listViews(doc);
    expect(D.deleteView(doc, only.id)).toBe(false);
    const board = D.addView(doc, { type: 'board' });
    expect(D.getView(doc, board).groupBy).toBeTruthy();
    expect(D.deleteView(doc, only.id)).toBe(true);
  });

  it('reorders rows by hand', () => {
    const { doc, row } = setup();
    const a = row('a');
    const b = row('b');
    const c = row('c');
    D.moveRow(doc, c, { before: a });
    expect(D.listRows(doc).map((r) => r.id)).toEqual([c, a, b]);
  });

  it('formats values for display', () => {
    const { props } = setup();
    expect(D.formatValue(props.Points, 1234.5)).toBe((1234.5).toLocaleString());
    expect(D.formatValue(props.Done, true)).toBe('Yes');
    expect(D.formatValue(props.Due, '2026-10-11')).toMatch(/2026/);
  });
});
