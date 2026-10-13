import { xmlTag, xmlText } from './xlsx-export-styles.js';
import { normalizePrintSettings } from './print-settings.js';

/** Native worksheet elements, in the order required by SpreadsheetML. */
export function writeXlsxPrint(xml, settings) {
  const p = normalizePrintSettings(settings);
  if (!p) return xml;
  const numbering = { firstPageNumber: p.firstPageNumber, useFirstPageNumber: Number(p.useFirstPageNumber) };
  const fields = [['header', 'oddHeader'], ['footer', 'oddFooter'], ['evenHeader', 'evenHeader'],
    ['evenFooter', 'evenFooter'], ['firstHeader', 'firstHeader'], ['firstFooter', 'firstFooter']];
  const headerFooter = !p.alignWithMargins || !p.scaleWithDoc || p.differentFirst || p.differentOddEven || fields.some(([key]) => p[key] != null)
    ? xmlTag('headerFooter', { differentFirst: Number(p.differentFirst), differentOddEven: Number(p.differentOddEven), alignWithMargins: Number(p.alignWithMargins), scaleWithDoc: Number(p.scaleWithDoc) },
      fields.map(([key, tag]) => p[key] != null ? xmlTag(tag, {}, xmlText(p[key])) : '').join('')) : '';
  xml = xml.replace(/<headerFooter\b[^>]*(?:\/>|>[^]*?<\/headerFooter\s*>)/g, '');
  const chart = /<chartsheet\b/.test(xml);
  if (chart) {
    // CT_CsPageSetup has no worksheet scaling, fit-to-page or grid options.
    const body = xmlTag('pageMargins', p.margins)
      + xmlTag('pageSetup', { paperSize: p.paperSize, orientation: p.orientation, ...numbering })
      + headerFooter;
    return xml.replace(/<drawing\b|<\/chartsheet>/, match => body + match);
  }
  const page = xmlTag('pageSetUpPr', { fitToPage: Number(p.fitToPage) });
  if (/<sheetPr\b[^>]*\/>/.test(xml)) xml = xml.replace(/<sheetPr\b([^>]*?)\/>/, `<sheetPr$1>${page}</sheetPr>`);
  else if (/<sheetPr\b/.test(xml)) xml = xml.replace('</sheetPr>', `${page}</sheetPr>`);
  else xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${page}</sheetPr>`);
  xml = xml.replace(/<(?:printOptions|pageMargins|pageSetup)\b[^>]*\/>/g, '');
  const body = xmlTag('printOptions', { horizontalCentered: Number(p.horizontalCentered), verticalCentered: Number(p.verticalCentered),
    gridLines: Number(p.gridlines), headings: Number(p.headings) }) + xmlTag('pageMargins', p.margins)
    + xmlTag('pageSetup', { paperSize: p.paperSize, orientation: p.orientation, pageOrder: p.pageOrder, scale: p.scale, fitToWidth: p.fitWidth, fitToHeight: p.fitHeight, ...numbering })
    + headerFooter;
  return xml.replace(/<headerFooter\b|<rowBreaks\b|<colBreaks\b|<customProperties\b|<cellWatches\b|<ignoredErrors\b|<smartTags\b|<drawing\b|<legacyDrawing\b|<picture\b|<oleObjects\b|<controls\b|<webPublishItems\b|<tableParts\b|<extLst\b|<\/worksheet>/, match => body + match);
}
