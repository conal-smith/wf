/**
 * Force (Beaufort) as the rider's wind unit: chosen in Settings, it is
 * the force wherever the wind is shown in the rider's units (the scrub
 * bar's pill, written F4; the loupe's foot box, the old charts' glyph and
 * the force; the spot page), and a scale stays in knots.
 */
import {
  barPill,
  chooseSpot,
  saveSettings,
  unitChoice,
  expect,
  openFromMenu,
  test,
  type Page,
} from "./fixtures";

async function inForce(page: Page) {
  // The loupe round the spot, not the range ring, so it has a foot box.
  await page.addInitScript(() =>
    localStorage.setItem("wingfoil.map.focus.v1", "loupe"),
  );
  await page.goto("/?map");
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await openFromMenu(page, "Settings");
  const force = unitChoice(page, "Force");
  await force.click();
  await expect(force).toHaveAttribute("aria-pressed", "true");
  await saveSettings(page);
}

test("in Force the scrub bar's pill reads the force and the loupe draws its glyph", async ({
  page,
}) => {
  await inForce(page);
  await chooseSpot(page, "brandon");
  // The hour over the playhead is a force, F0 to F12, its gust too where
  // there is one; no knots.
  const pill = barPill(page);
  const figure = pill.locator("b");
  await expect(figure).toHaveText(/^F\d{1,2}$/, { timeout: 30000 });
  const force = Number((await figure.textContent())!.slice(1));
  expect(force).toBeGreaterThanOrEqual(0);
  expect(force).toBeLessThanOrEqual(12);
  const gust = pill.locator(".sb-pill-soft");
  if (await gust.count()) await expect(gust).toHaveText(/^gusting F\d{1,2}$/);
  await expect(pill).not.toContainText(/\d ?kn\b/);

  // The loupe's foot box: the compass point, then the glyph and the force.
  const reading = page.locator(".map-loupe-reading.is-force");
  await expect(reading).toBeVisible({ timeout: 30000 });
  await expect(reading).toHaveText(/^[NESW]{1,3} \d+( g\d+)?$/);
  await expect(page.locator(".map-loupe-glyph").first()).toBeVisible();

  // Kept on reload.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(barPill(page).locator("b")).toHaveText(/^F\d{1,2}$/, {
    timeout: 30000,
  });
});

test("in Force the spot page's figures are forces, written F4", async ({
  page,
}) => {
  await inForce(page);
  await page.goto("/spot/brandon");
  // Now's wind, and the week's ranges, in forces; no knots anywhere.
  const now = page.locator("[data-now]");
  await expect(now).toContainText(/F\d/, { timeout: 30000 });
  await expect(page.locator("[data-day-card]").nth(1)).toContainText(
    /F\d+–F\d+/,
  );
  await expect(now).not.toContainText(/\bkn\b/);
});
