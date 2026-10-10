import { expect, test, type Page } from "@playwright/test";

/**
 * What a visitor needs from a deployed site, checked against real forecasts on
 * the real clock (playwright.smoke.config.ts). Nothing here may assume what the
 * forecast says -- only that the site reads it, from wherever this deployment's
 * data lives, and draws.
 *
 * SMOKE_MANIFESTS names the pointer manifests the environment must be serving
 * (registry.py's paths, e.g. weather/gfs.json). Each is fetched from inside the
 * page, so a data domain without the CORS rule fails here as it would for a
 * visitor. With none named, the site is only checked to draw.
 */
const manifests = (process.env.SMOKE_MANIFESTS ?? "")
  .split(",")
  .map((path) => path.trim())
  .filter(Boolean);

function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("the chart draws every riding place and reads this deployment's forecast", async ({
  page,
}) => {
  const errors = pageErrors(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/wingfoil\.ie/);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(() => page.locator(".spot-marker").count(), { timeout: 30000 })
    .toBeGreaterThan(20);

  const base = await page.evaluate(
    () =>
      document.querySelector<HTMLMetaElement>(
        'meta[name="wingfoil:forecast-base"]',
      )?.content || "/",
  );
  for (const path of manifests) {
    const url = new URL(path, new URL(base, page.url())).href;
    const answer = await page.evaluate(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text();
      let json = false;
      try {
        json = typeof JSON.parse(text) === "object";
      } catch {
        json = false;
      }
      return { status: response.status, json };
    }, url);
    expect(answer, url).toEqual({ status: 200, json: true });
  }
  if (manifests.length)
    await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
      timeout: 30000,
    });
  expect(errors).toEqual([]);
});

test("a spot page draws its week", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/spot/brandon");
  await expect(
    page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle(/Brandon Bay/);
  expect(errors).toEqual([]);
});

test("How the stars work draws", async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto("/stars");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
    timeout: 30000,
  });
  expect(errors).toEqual([]);
});
