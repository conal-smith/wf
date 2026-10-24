/**
 * Force (Beaufort) as the rider's wind unit: chosen in Display options, it is
 * the old charts' glyph and the force wherever the wind is shown in the
 * rider's units (the dock, the loupe's foot box, the spot page), and a scale
 * (the blend's axis) stays in knots.
 */
import {
  chooseSpot,
  closePanel,
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
  await page.goto("/");
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await openFromMenu(page, "Display options");
  const force = page.locator('[data-units="bft"]');
  await expect(force).toHaveText("Force");
  await force.click();
  await expect(force).toHaveAttribute("aria-pressed", "true");
  await closePanel(page);
}

test("in Force the dock and the loupe draw the force's glyph and number", async ({
  page,
}) => {
  await inForce(page);
  await chooseSpot(page, "brandon");
  const wind = page.locator(".dock tr.tt-wind td[data-i]");
  await expect(wind.first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".dk-labs")).toContainText("Force");
  // Every hour with a reading is a glyph named by its force, 0 to 12.
  const glyphs = page.locator(".dock tr.tt-wind .kn [role=img]");
  await expect(glyphs.first()).toHaveAttribute("aria-label", /^Force \d+$/);
  const forces = await glyphs.evaluateAll((els) =>
    els.map((el) => Number(el.getAttribute("data-force"))),
  );
  expect(forces.length).toBeGreaterThan(10);
  expect(forces.every((f) => f >= 0 && f <= 12)).toBe(true);
  // The number is written beside the feathers.
  await expect(glyphs.first()).toHaveText(String(forces[0]));

  // The loupe's foot box: the compass point, then the glyph and the force.
  const reading = page.locator(".map-loupe-reading.is-force");
  await expect(reading).toBeVisible({ timeout: 30000 });
  await expect(reading).toHaveText(/^[NESW]{1,3} \d+( g\d+)?$/);
  await expect(page.locator(".map-loupe-glyph").first()).toBeVisible();

  // Kept on reload.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(page.locator(".dk-labs")).toContainText("Force", {
    timeout: 30000,
  });
});

test("in Force the spot page's hours are glyphs, said as Force N", async ({
  page,
}) => {
  await inForce(page);
  await page.goto("/spot/brandon");
  const figure = page
    .locator("[data-row] [role=img][aria-label^='Force'] >> visible=true")
    .first();
  await expect(figure).toBeVisible({ timeout: 30000 });
  await expect(figure).toHaveAttribute(
    "aria-label",
    /^Force \d+(, gusting Force \d+)?$/,
  );
  // The key says what the feathers are.
  await expect(page.locator("[data-table-key]")).toContainText(
    "half a feather for each force",
  );
});
