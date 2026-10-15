import { test, expect, type Page } from '@playwright/test';
import { openApp, objectNames, expectNoErrors } from './helpers';

/** Stands in for Puter AI: replays one reply per request (window.__assistantChat is honoured in dev builds). */
async function scriptModel(page: Page, replies: unknown[][]) {
  await page.evaluate((r) => {
    const w = window as unknown as { __assistantChat: unknown; __requests: unknown[] };
    w.__requests = [];
    let i = 0;
    w.__assistantChat = async function* (messages: unknown) {
      w.__requests.push(messages);
      for (const part of r[i++] ?? [{ type: 'text', text: 'Done.' }]) yield part;
    };
  }, replies);
}

test('the assistant is open by default and builds from a description, as one undo step', async ({ page }) => {
  const errors = await openApp(page);
  const panel = page.locator('.assistant');
  await expect(panel).toBeVisible();
  await expect(page.locator('.tb-assistant')).toHaveClass(/\bon\b/);
  // the viewport sits beside the sidebar, not under it
  const view = await page.locator('.view3d').first().boundingBox();
  const side = await panel.boundingBox();
  expect(view!.x + view!.width).toBeLessThanOrEqual(side!.x + 1);

  await scriptModel(page, [
    [
      {
        type: 'tool',
        id: 'call_1',
        name: 'run_script',
        input: {
          description: 'Build a snowman',
          code: "D.objects.remove(D.objects.Cube);\nbpy.ops.mesh.primitive_uv_sphere_add({radius: 0.5, location: [0, 0, 0.5]}); C.object.name = 'Snow Base';\nbpy.ops.mesh.primitive_uv_sphere_add({radius: 0.35, location: [0, 0, 1.25]}); C.object.name = 'Snow Head';",
        },
      },
    ],
    [{ type: 'tool', id: 'call_2', name: 'capture_view', input: { view: 'ISOMETRIC', shading: 'SOLID' } }],
    [{ type: 'text', text: 'Built a **snowman** from two spheres.' }],
  ]);
  await page.locator('.as-input').fill('make a snowman');
  await page.locator('.as-input').press('Enter');
  await expect(page.locator('.as-bot .as-text')).toContainText('Built a snowman from two spheres.');
  await expect(page.locator('.as-step.done')).toHaveCount(2);
  await expect(page.locator('.as-step').first()).toContainText('Build a snowman');
  expect(await objectNames(page)).toEqual(['Camera', 'Light', 'Snow Base', 'Snow Head']);

  // the screenshot was a real picture of the viewport, and went to the model
  const shot = page.locator('.as-shot');
  await expect(shot).toHaveCount(1);
  const size = await shot.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBeGreaterThan(200);
  const sent = await page.evaluate(() => JSON.stringify((window as unknown as { __requests: unknown[] }).__requests[2]));
  expect(sent).toContain('"type":"image"');
  // the first request described the scene
  const first = await page.evaluate(() => JSON.stringify((window as unknown as { __requests: unknown[] }).__requests[0]));
  expect(first).toContain('<scene_state>');

  // one undo step for the whole message
  await page.getByRole('button', { name: 'Undo changes' }).click();
  await expect(page.locator('.as-meta')).toContainText('Changes undone.');
  expect(await objectNames(page)).toEqual(['Camera', 'Cube', 'Light']);
  await expectNoErrors(errors);
});

test('a script error is rolled back and reported in the steps', async ({ page }) => {
  await openApp(page);
  await scriptModel(page, [
    [{ type: 'tool', id: 'call_1', name: 'run_script', input: { description: 'Try something', code: "bpy.ops.mesh.primitive_cube_add({location: [3, 0, 0]});\nD.objects['Nope'].location.x = 1;" } }],
    [{ type: 'text', text: 'That failed.' }],
  ]);
  await page.locator('.as-input').fill('break it');
  await page.locator('.as-input').press('Enter');
  await expect(page.locator('.as-step.error')).toHaveCount(1);
  await expect(page.locator('.as-step-detail')).toContainText('line 2');
  expect(await objectNames(page)).toEqual(['Camera', 'Cube', 'Light']);
  await expect(page.getByRole('button', { name: 'Undo changes' })).toHaveCount(0);
});

test('closing the assistant is remembered across visits', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Close the assistant' }).click();
  await expect(page.locator('.assistant')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { app?: unknown }).app);
  await page.waitForTimeout(300);
  await expect(page.locator('.assistant')).toBeHidden();
  await expect(page.locator('.tb-assistant')).not.toHaveClass(/\bon\b/);
  // the topbar button brings it back, and that is remembered too
  await page.locator('.tb-assistant').click();
  await expect(page.locator('.assistant')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { app?: unknown }).app);
  await expect(page.locator('.assistant')).toBeVisible();
});
