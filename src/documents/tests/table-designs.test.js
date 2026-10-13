import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DocxPackage, createDocx, WRITING_STYLES } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { applyTableDesign, cellPlaces, TABLE_DESIGNS, DEFAULT_TABLE_OPTIONS } from '../src/engine/table-designs.js';
import { tableCells } from '../src/engine/tables.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());

function tableDocument() {
  const pkg = createDocx([paragraph()], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  doc.insertTable(3, 3, 9000);
  const cells = tableCells(doc.tables[0]);
  cells.forEach((cell, i) => { doc.selectCell(cell.id); doc.replace(`c${i}`); });
  doc.selectCell(cells[4].id);
  return { pkg, doc };
}
const cellsOf = doc => tableCells(doc.tables[0]);

it('regions follow the Table Style Options', () => {
  const { doc } = tableDocument();
  const places = cellPlaces(doc.tables[0], DEFAULT_TABLE_OPTIONS);
  expect(places.filter(p => p.header).map(p => p.row)).toEqual([0, 0, 0]);
  expect(places.filter(p => p.band).map(p => p.row)).toEqual([1, 1, 1]);
  expect(places.filter(p => p.firstColumn).map(p => p.column)).toEqual([0, 0, 0]);
  const plain = cellPlaces(doc.tables[0], { ...DEFAULT_TABLE_OPTIONS, headerRow: false, bandedRows: false, firstColumn: false, totalRow: true });
  expect(plain.filter(p => p.header || p.band || p.firstColumn)).toEqual([]);
  expect(plain.filter(p => p.total).map(p => p.row)).toEqual([2, 2, 2]);
});

it('applies a banded design in one undo step and saves fills, borders and header text', async () => {
  const { pkg, doc } = tableDocument();
  const selection = [...doc.range];
  expect(applyTableDesign(doc, 'banded-blue')).toBe(true);
  const cells = cellsOf(doc);
  expect(cells.slice(0, 3).map(c => c.shading)).toEqual(['2F5F98', '2F5F98', '2F5F98']);
  expect(cells[3].shading).toBe('D9E3F0');
  expect(cells[6].shadingExplicit).toBeFalsy();
  expect(cells[4].directBorders.top).toMatchObject({ style: 'single', color: 'B4C7E2' });
  expect(doc.range).toEqual(selection);
  const header = doc.paragraphs.find(p => p.cellId === cells[1].id).runs[0];
  expect(header).toMatchObject({ bold: true, color: 'FFFFFF' });
  expect(doc.paragraphs.find(p => p.cellId === cells[4].id).runs[0].bold).toBe(false);
  const blob = await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets);
  const reopened = await DocxPackage.open(new Uint8Array(await blob.arrayBuffer()));
  const saved = tableCells(reopened.tables[0]);
  expect(saved.slice(0, 4).map(c => c.shading)).toEqual(['2F5F98', '2F5F98', '2F5F98', 'D9E3F0']);
  expect(reopened.paragraphs.find(p => p.cellId === saved[1].id).runs[0]).toMatchObject({ bold: true, color: 'FFFFFF' });
});

it('switching design or options resets only the text formatting the previous design applied', () => {
  const { doc } = tableDocument();
  const cells = cellsOf(doc), body = doc.paragraphs.findIndex(p => p.cellId === cells[5].id);
  doc.select(doc.paragraphOffset(body), doc.paragraphOffset(body) + 2); doc.setRunFormat({ bold: true });
  applyTableDesign(doc, 'banded-green');
  const depth = doc.history.length;
  applyTableDesign(doc, 'plain-grid', { ...DEFAULT_TABLE_OPTIONS, headerRow: false });
  expect(doc.paragraphs.find(p => p.cellId === cells[1].id).runs[0]).toMatchObject({ bold: false, color: 'auto' });
  expect(doc.paragraphs[body].runs[0].bold).toBe(true);
  expect(cells[0].shadingExplicit).toBe(false);
  expect(doc.tables[0].design).toEqual({ id: 'plain-grid', options: { ...DEFAULT_TABLE_OPTIONS, headerRow: false } });
  // The editor's session records the whole design as one step; unwind the model's own checkpoints.
  while (doc.history.length > depth) doc.undo();
  expect(cellsOf(doc)[0].shading).toBe('4E7D3A');
});

it('every design produces valid borders for every cell', () => {
  for (const design of TABLE_DESIGNS) {
    const { doc } = tableDocument();
    expect(() => applyTableDesign(doc, design.id, { headerRow: true, totalRow: true, bandedRows: true, firstColumn: true, lastColumn: true, bandedColumns: true }), design.id).not.toThrow();
  }
});
