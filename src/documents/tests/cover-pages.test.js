import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DocxPackage, createDocx, WRITING_STYLES } from '../src/engine/docx.js';
import { TextDocument, paragraph, paragraphText } from '../src/engine/model.js';
import { insertCoverPage, COVER_DESIGNS } from '../src/engine/cover-pages.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
function documentWith(lines) {
  const pkg = createDocx([paragraph()], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  lines.forEach((line, i) => { if (i) doc.insertParagraph(); doc.replace(line); });
  return { pkg, doc };
}
const text = { title: 'Annual Plan', subtitle: 'For the year ahead', author: 'Sam Lee', date: 'October 9, 2026' };

it('every design inserts a formatted title page ending in a page break before the existing first heading', async () => {
  for (const design of COVER_DESIGNS) {
    const { pkg, doc } = documentWith(['Introduction', 'Body text.']);
    doc.select(0, 12); doc.setParagraphStyle('Heading1');
    insertCoverPage(doc, design.id, text);
    expect(doc.paragraphs.slice(0, 5).map(paragraphText), design.id).toEqual(['Annual Plan', 'For the year ahead', 'Sam Lee', 'October 9, 2026\f', 'Introduction']);
    expect(doc.paragraphs[0].styleId ?? 'Normal', design.id).toBe('Normal');
    expect(doc.paragraphs[0].runs[0].fontSize).toBeGreaterThanOrEqual(32);
    expect(doc.paragraphs[4].styleId).toBe('Heading1');
    const blob = await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets);
    const reopened = await DocxPackage.open(new Uint8Array(await blob.arrayBuffer()));
    expect(reopened.paragraphs.slice(0, 4).map(paragraphText), design.id).toEqual(['Annual Plan', 'For the year ahead', 'Sam Lee', 'October 9, 2026\f']);
    expect(reopened.paragraphs[0].runs[0], design.id).toMatchObject({ fontSize: design.lines[0][2].fontSize, color: design.lines[0][2].color });
  }
});

it('every design fits on one Letter page, so the document starts on page 2', async () => {
  const { layoutDocument } = await import('../src/engine/layout.js');
  const { pageGeometry } = await import('../src/engine/page-settings.js');
  const measure = (t, style) => ({ width: t.length * style.fontSize * 0.55, ascent: style.fontSize, descent: style.fontSize / 3 });
  for (const design of COVER_DESIGNS) {
    const { doc } = documentWith(['First page of the document.']);
    insertCoverPage(doc, design.id, text);
    const layout = layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables, undefined, { styles: doc.styles });
    expect(layout.pageCount, design.id).toBe(2);
  }
});

it('refuses a document that starts with a table', () => {
  const { doc } = documentWith(['x']);
  doc.select(0); doc.insertTable(1, 1, 600);
  if (doc.paragraphs[0].cellId) expect(() => insertCoverPage(doc, 'simple', text)).toThrow(/table/);
});
