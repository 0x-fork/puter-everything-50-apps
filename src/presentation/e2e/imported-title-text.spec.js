import { test, expect } from "@playwright/test";
import { P, createDeck, text, MIME } from "../src/model.js";

async function load(page, p) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://js.puter.com/v2/", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.puter={env:"web",auth:{isSignedIn:async()=>false},ui:{onLaunchedWithItems:()=>{}}};',
    }),
  );
  await page.goto("/#/home");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import PPTX", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "Proofing text.pptx",
    mimeType: MIME,
    buffer: Buffer.from(await P.savePresentation(p)),
  });
  await expect(page.locator("#slide-position")).toHaveText("Slide 1 of 1");
  return errors;
}

test("imported title placeholders support accessibility and unselected spelling", async ({
  page,
}) => {
  const p = createDeck("blank");
  P.removeSlide(p, P.getSlides(p)[0]);
  P.addTitleSlide(p, "Quarterly roadmap");
  const errors = await load(page, p);
  await expect(page.locator("#status-accessibility")).toHaveText(
    "Accessibility: Good to go",
  );
  await page.locator("#status-accessibility").click();
  const dialog = page.getByRole("dialog", { name: "Accessibility" });
  await expect(dialog).toContainText("No accessibility issues found");
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await expect(page.locator('.object-hit[aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await page
    .locator('.ribbon-panel:not([hidden]) [data-command="spelling"]')
    .click();
  await expect(page.locator(".inline-editor")).toBeFocused();
  await expect(page.locator(".inline-editor")).toHaveAttribute(
    "spellcheck",
    "true",
  );
  await expect(page.locator(".inline-editor")).toContainText(
    "Quarterly roadmap",
  );
  expect(errors).toEqual([]);
});

test("spelling finds unselected imported body text without a placeholder", async ({
  page,
}) => {
  const p = createDeck("blank");
  text(P.getSlides(p)[0], "Unselected body text", 1, 1, 5, 1, 24, "#202020");
  const errors = await load(page, p);
  await expect(page.locator('.object-hit[aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await page
    .locator('.ribbon-panel:not([hidden]) [data-command="spelling"]')
    .click();
  await expect(page.locator(".inline-editor")).toBeFocused();
  await expect(page.locator(".inline-editor")).toHaveAttribute(
    "spellcheck",
    "true",
  );
  await expect(page.locator(".inline-editor")).toHaveText(
    "Unselected body text",
  );
  expect(errors).toEqual([]);
});
