import { test, expect } from '@playwright/test';

const input = page => page.getByRole('textbox', { name: 'Document text' });
const file = page => page.getByRole('button', { name: 'File', exact: true });

test('File > Save as template adds the document to the home screen templates', async ({ page }) => {
  await page.goto('/mock.html#/new');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await input(page).fill('Weekly status\nWins:\nRisks:');
  await file(page).click(); await page.getByRole('menuitem', { name: 'Save as template…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as template' });
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Status update');
  await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('Saved as template "Status update"')).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(input(page)).toHaveValue('Weekly status\nWins:\nRisks:');

  // Saving under the same name asks before replacing it.
  await input(page).press('ControlOrMeta+End'); await page.keyboard.type(' none');
  await file(page).click(); await page.getByRole('menuitem', { name: 'Save as template…', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Template name' }).fill('Status update');
  await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
  await page.getByRole('dialog', { name: 'Replace template?' }).getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByText('Saved as template "Status update"')).toBeVisible();

  await page.getByRole('button', { name: 'Back to documents', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Status update', exact: true }).click();
  await expect(input(page)).toHaveValue('Weekly status\nWins:\nRisks: none');
  await expect(page.getByRole('textbox', { name: 'Document name' })).toHaveValue('Status update');
});

test('the local playground has no cloud template command', async ({ page }) => {
  await page.goto('/playground.html');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await file(page).click();
  await expect(page.getByRole('menuitem', { name: 'Save as template…', exact: true })).toHaveCount(0);
});
