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

test("the map's site menu is closed when the reader comes back from the AI page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 30000,
  });
  const trigger = page.getByRole("button", { name: "Site menu" });
  await trigger.click();
  // A browser that tells the menu nothing of focus leaving it, as Safari
  // fires no blur when the focused row is hidden under the page, and nothing
  // fires one in a window in the background: the row has to close the menu
  // itself. The clicks come alone, with no pointerdown before them, as an
  // assistive or scripted click does.
  await page.evaluate(() => {
    document.addEventListener("focusout", (e) => e.stopPropagation(), true);
  });
  await page
    .getByRole("navigation", { name: "Site" })
    .getByRole("link", { name: "Use with AI" })
    .dispatchEvent("click", { button: 0 });
  await expect(page).toHaveURL(/\/ai$/);
  await expect(page.locator(".map-under-page")).toHaveCount(1);

  await page
    .getByRole("link", { name: "Chart" })
    .dispatchEvent("click", { button: 0 });
  await expect(page.locator(".map-under-page")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // And one click opens it again, one on its X closes it.
  await trigger.click();
  await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
});

test("Escape on the AI page closes its site menu, and only that", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 30000,
  });
  await openAi(page);

  // The page's own menu: Escape is the menu's, not the way back to the map.
  const trigger = page.getByRole("button", { name: "Site menu" });
  await trigger.click();
  await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/ai$/);

  // Closed, Escape is the way back again.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
});
