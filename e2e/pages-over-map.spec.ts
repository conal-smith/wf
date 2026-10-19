import { expect, test, type Page } from "./fixtures";

/**
 * The AI page, opened from the map, is drawn over it (src/PagesOverMap.tsx):
 * coming back is the same map, not a page load that draws it all again.
 */

/** Marks the map's canvas, so a map drawn afresh is told from the one kept. */
const mark = (page: Page) =>
  page.evaluate(() => {
    document.querySelector<HTMLElement>(".maplibregl-canvas")!.dataset.kept =
      "1";
  });
const kept = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector<HTMLElement>(".maplibregl-canvas")?.dataset
        .kept === "1",
  );

async function openAi(page: Page) {
  await page.getByRole("button", { name: "Site menu" }).click();
  await page
    .getByRole("navigation", { name: "Site" })
    .getByRole("link", { name: "Use with AI" })
    .click();
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.locator(".map-under-page")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("the AI page opens over the map, and every way back keeps the map", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 30000,
  });
  await mark(page);

  // Back.
  await openAi(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".map-under-page")).toHaveCount(0);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  // Escape.
  await openAi(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".map-under-page")).toHaveCount(0);

  // The page's own link to the chart.
  await openAi(page);
  await page.locator('a[href="/"]:visible').first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".map-under-page")).toHaveCount(0);

  // A page load would have drawn a new canvas, without the mark.
  expect(await kept(page)).toBe(true);
});

test("a page loaded at /ai is drawn alone, as before", async ({ page }) => {
  await page.goto("/ai");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
});
