import { test, expect } from '@playwright/test';
import { onTab, downloadDocx } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';

const pixel = (page, x, y) => page.locator('canvas.canvas-page').first().evaluate((c, [x, y]) => {
  const scale = c.width / c.getBoundingClientRect().width;
  return [...c.getContext('2d').getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data.slice(0, 3)];
}, [x, y]);

test('applies a table design from the gallery, follows the style options and saves the look', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  await input.focus();
  await (await onTab(page, 'insert')).getByRole('button', { name: 'Insert table', exact: true }).click();
  await page.getByRole('menuitem', { name: '3 columns, 3 rows' }).click();
  for (const [i, text] of ['Item', 'Qty', 'Cost', 'Pens', '2', '4', 'Ink', '1', '9'].entries()) { if (i) await input.press('Tab'); await page.keyboard.type(text); }
  await onTab(page, 'tableDesign');
  const gallery = page.getByRole('listbox', { name: 'Table Styles' });
  await expect(gallery.getByRole('option')).not.toHaveCount(0);
  await gallery.getByRole('option', { name: 'Banded Green' }).click();
  await expect(gallery.getByRole('option', { name: 'Banded Green' })).toHaveAttribute('aria-selected', 'true');
  await expect(input).toBeFocused();
  // The header row's fill is the design's dark green; the first body row is banded.
  const cell = async text => {
    await input.evaluate((el, text) => { const at = el.value.indexOf(text); el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
    return input.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  };
  const header = await cell('Qty'), body = await cell('2'), last = await cell('1');
  await expect.poll(() => pixel(page, header.x + 30, header.y + 3)).toEqual([0x4E, 0x7D, 0x3A]);
  expect(await pixel(page, body.x + 30, body.y + 3)).toEqual([0xE2, 0xEF, 0xD9]);
  expect(await pixel(page, last.x + 30, last.y + 3)).toEqual([255, 255, 255]);
  // Banded Rows off clears the band at once; undo brings it back in one step.
  await page.getByRole('checkbox', { name: 'Banded Rows' }).uncheck();
  await expect.poll(() => pixel(page, body.x + 30, body.y + 3)).toEqual([255, 255, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pixel(page, body.x + 30, body.y + 3)).toEqual([0xE2, 0xEF, 0xD9]);
  await page.getByRole('button', { name: 'More Table Styles' }).click();
  await page.getByRole('menuitemradio', { name: 'Plain Grid' }).click();
  await expect.poll(() => pixel(page, header.x + 30, header.y + 3)).toEqual([255, 255, 255]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const path = info.outputPath('table-design.docx');
  const download = page.waitForEvent('download'); await downloadDocx(page); await (await download).saveAs(path);
  const text = await input.inputValue();
  await reopenDocx(page, input, path, text);
  const reopened = await cell('Qty');
  await expect.poll(() => pixel(page, reopened.x + 30, reopened.y + 3)).toEqual([0x4E, 0x7D, 0x3A]);
  expect(errors).toEqual([]);
});
