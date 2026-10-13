import { paragraphText } from './model.js';

/**
 * Insert → Cover Page: an original title page placed before the document's first paragraph and
 * ended with a page break (`w:br w:type="page"`). Each design is direct paragraph and run formatting on
 * Normal-style paragraphs, so it looks the same in any document and in any consumer.
 * Lines: [role, paragraph format, run format].
 */
const NAVY = '1F3864', BLUE = '2F5597', GRAY = '595959';
export const COVER_DESIGNS = Object.freeze([
  { id: 'simple', name: 'Simple', lines: [
    ['title', { alignment: 'center', spaceBefore: 216, spaceAfter: 12 }, { fontSize: 36, bold: true, color: NAVY }],
    ['subtitle', { alignment: 'center', spaceAfter: 120 }, { fontSize: 18, color: GRAY }],
    ['author', { alignment: 'center', spaceAfter: 4 }, { fontSize: 12, color: GRAY }],
    ['date', { alignment: 'center', spaceAfter: 0 }, { fontSize: 12, color: GRAY }],
  ] },
  { id: 'banded', name: 'Banded', lines: [
    ['title', { alignment: 'left', spaceBefore: 180, spaceAfter: 0, paragraphShading: NAVY, indentLeft: 144, indentRight: 144 }, { fontSize: 32, bold: true, color: 'FFFFFF' }],
    ['subtitle', { alignment: 'left', spaceAfter: 240, paragraphShading: 'D9E2F3', indentLeft: 144, indentRight: 144 }, { fontSize: 16, color: NAVY }],
    ['author', { alignment: 'left', spaceAfter: 4, indentLeft: 144 }, { fontSize: 12, color: GRAY }],
    ['date', { alignment: 'left', spaceAfter: 0, indentLeft: 144 }, { fontSize: 12, color: GRAY }],
  ] },
  { id: 'lined', name: 'Lined', lines: [
    ['title', { alignment: 'left', spaceBefore: 168, spaceAfter: 6, paragraphBorders: { bottom: { style: 'single', size: 24, color: BLUE, space: 4 } } }, { fontSize: 34, color: BLUE }],
    ['subtitle', { alignment: 'left', spaceAfter: 216 }, { fontSize: 16, italic: true, color: GRAY }],
    ['author', { alignment: 'right', spaceAfter: 4, paragraphBorders: { top: { style: 'single', size: 6, color: BLUE, space: 4 } } }, { fontSize: 12, bold: true, color: BLUE }],
    ['date', { alignment: 'right', spaceAfter: 0 }, { fontSize: 12, color: GRAY }],
  ] },
]);

/**
 * Insert a cover page design at the start of the document. text: { title, subtitle, author, date }.
 * Runs inside one engine transaction; returns true.
 */
export function insertCoverPage(model, designId, text) {
  const design = COVER_DESIGNS.find(d => d.id === designId);
  if (!design) throw new Error('Choose a cover page.');
  if (model.paragraphs[0]?.cellId) throw new Error('The document starts with a table. Add a paragraph before it, then insert the cover page.');
  const lines = design.lines.map(([role]) => String(text[role] ?? '').replace(/[\n\f\v]/g, ' ').trim() || ' ');
  model.select(0);
  // The cover's own paragraphs, then a page break so the document starts on the next page.
  model.replace(`${lines.join('\n')}\f\n`);
  const normal = model.styles.defaultParagraph;
  let at = 0;
  design.lines.forEach(([, paragraphFormat, runFormat], index) => {
    const length = paragraphText(model.paragraphs[index]).length;
    model.select(at, at + length);
    if (normal && model.styles.definitions[normal]) model.setParagraphStyle(normal);
    model.clearDirectParagraphFormatting();
    model.setParagraphFormat({ ...paragraphFormat, pageBreakBefore: false });
    model.clearDirectTextFormatting();
    model.setRunFormat(runFormat);
    at += length + 1;
  });
  model.select(0, paragraphText(model.paragraphs[0]).length);
  return true;
}
