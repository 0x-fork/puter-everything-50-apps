import { test, expect } from '@playwright/test';
import { fileCommand } from './helpers/editor-tools.js';

const input = page => page.getByRole('textbox', { name: 'Document text' });

test('File lists the keyboard shortcuts, also with Ctrl or Cmd + /', async ({ page }) => {
  await page.goto('/playground.html');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
  await (await fileCommand(page, 'Keyboard Shortcuts')).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Heading 1 to 6');
  await expect(dialog).toContainText('Previous or next paragraph');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await input(page).focus(); await input(page).press('ControlOrMeta+/');
  await expect(dialog).toBeVisible();
});
