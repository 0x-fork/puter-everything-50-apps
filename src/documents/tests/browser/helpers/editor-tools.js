import { expect } from '@playwright/test';

/** Feature regressions exercise the optional Formatting Pane. Shell tests use the compact default. */
export async function showAllTools(page) {
  await page.locator('.canvas-workspace, #playground-error:not(:empty)').first().waitFor();
  await onTab(page, 'home');
  const more = page.getByRole('button', { name: 'Formatting Pane', exact: true });
  if (!await more.count()) return; // Unsupported browser capabilities can reject the initial sample.
  if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const pageTools = page.locator('.canvas-inspector-details');
  if (await pageTools.count() && !await pageTools.evaluate(el => el.open)) await pageTools.locator('summary').click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  if (await input.count()) await input.focus();
}

/**
 * Bring the ribbon tab that holds a control to the front, as a user would before using it, and
 * return the page so a lookup can follow: `(await onTab(page, 'insert')).getByRole(…)`. A contextual
 * tab that is not showing (a table tab outside a table) is left alone.
 */
export async function onTab(page, id) {
  const tab = page.locator(`#ribbon-tab-${id}`);
  if (await tab.count() && await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  return page;
}

/** The File menu's command of this name. */
export async function fileCommand(page, name) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  return page.getByRole('menu', { name: 'File' }).getByRole('menuitem', { name, exact: true });
}

export async function saveToPuter(page) {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save to Puter', exact: true }).click();
}

/** The evaluation playground has a direct download button; the app uses File. */
export async function downloadDocx(page) {
  const button = page.getByRole('button', { name: 'Download .docx', exact: true });
  if (await button.count()) return button.click();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Download .docx', exact: true }).click();
}

/** Table commands live on the contextual table tabs, which stay hidden outside a table; their
 * controls remain in the page and disabled until a table selection exists. */
export async function expectTableCommandUnavailable(page, name) {
  const control = page.locator('.ribbon-card').getByRole('button', { name, exact: true, includeHidden: true });
  await expect(control).toHaveCount(1);
  await expect(control).toBeHidden();
  await expect(control).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Table Layout' })).toBeHidden();
  await page.getByRole('textbox', { name: 'Document text' }).focus();
}
