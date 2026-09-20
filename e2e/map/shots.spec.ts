import { expect, test, type Page } from "../fixtures";

/**
 * The map's visual baseline: one PNG per state per width, committed.
 *
 * The map's CSS still holds its colours as literals. Replacing them with theme
 * variables is meant to change nothing a reader can see, and the only way to
 * say that with a straight face is to have the before. These shots are it, so
 * every one of them has to be a state that was really reached — panel open,
 * popup up, chart drawn — and has to come out the same twice.
 *
 * What is held still, and how:
 *   the clock     pinned by e2e/fixtures.ts, over the fixed sample calendar
 *                 that scripts/sample-weather.mjs writes for the e2e site;
 *   motion        `reducedMotion: reduce` for the whole file, which stops the
 *                 particle field, the camera easing and the CSS transitions,
 *                 and `animations: "disabled"` at the shutter for the rest;
 *   the basemap   hidden, see `hideBasemap`;
 *   the fonts     awaited — they are fetched, so an early shutter catches the
 *                 fallback face and moves every line of text a little.
 *
 * Each state is a test of its own so that it opens its own context: the dock
 * remembers display choices in storage, and a shot must not inherit them.
 *
 * Not part of `npm run test:e2e`: `npm run map:shots` alone runs this file (see
 * playwright.config.ts). A gate that rewrites committed files as it passes is
 * not a gate, and nothing here asserts anything the other specs do not.
 */

test.use({ reducedMotion: "reduce" });

/** Where a shot lands, relative to the repo root Playwright is run from. */
const shot = (state: string, width: number) =>
  `e2e/map/__baseline__/${state}-${width}.png`;

/**
 * Keep the basemap raster out of the comparison.
 *
 * The tiles come from the network in every run of this suite — the specs stub
 * that endpoint only to test the failure (e2e/map.spec.ts) — and a picture of
 * somebody else's tiles is neither ours to commit nor stable across a restyle
 * of theirs. Hiding the canvas leaves everything the map's own CSS draws: the
 * container beneath it, the markers, the popout, the panels and the dock. The
 * style is still fetched and the map still loads; nothing in src/ changes.
 */
async function hideBasemap(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = ".maplibregl-canvas { visibility: hidden }";
    const attach = () => document.head.append(style);
    if (document.head) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  });
}

/** The map, open and drawn: markers placed, nothing still loading. */
async function openMap(page: Page) {
  await hideBasemap(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
}

/** The camera has landed when the thing it is moving stands still. */
async function settled(page: Page) {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const box = await page.locator(".spot-marker").first().boundingBox();
      const same = !!box && Math.abs(box.x - last) < 0.5;
      last = box?.x ?? Number.NaN;
      return same;
    })
    .toBe(true);
}

/** The shutter. Text is measured with the real faces or not at all. */
async function shoot(page: Page, state: string, width: number) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({
    path: shot(state, width),
    animations: "disabled",
    caret: "hide",
  });
}

for (const { width, height } of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("idle map", async ({ page }) => {
      await openMap(page);
      await settled(page);
      // The map with nothing over it. The dock opens on the nearest spot, so
      // the idle state is one dismissal away — and leaving it up would make
      // this shot a second copy of the blend one.
      await page.getByRole("button", { name: "Close forecast panel" }).click();
      await expect(page.locator(".forecast-sheet")).toHaveCount(0);
      await shoot(page, "idle", width);
    });

    test("search open", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Open spot search" }).click();
      await page
        .getByRole("searchbox", { name: "Search Irish spots" })
        .fill("Dublin");
      await expect(
        page.locator(".search-results .spot-row").first(),
      ).toBeVisible();
      await shoot(page, "search", width);
    });

    test("layers panel", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await expect(page.locator(".layers-panel")).toBeVisible();
      await shoot(page, "layers", width);
    });

    test("spot popup", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Open spot search" }).click();
      await page.getByRole("searchbox").fill("Blast");
      await page.locator(".spot-row").click();
      const popup = page.getByRole("dialog", { name: /Kilcrea.*information/ });
      await expect(popup).toBeVisible();
      // The popout is fitted once, when the camera that opened it lands.
      await expect(page.locator(".sheet-loading")).toHaveCount(0, {
        timeout: 30000,
      });
      await settled(page);
      await shoot(page, "popup", width);
    });

    test("dock grid", async ({ page }) => {
      await openMap(page);
      await page.locator('[data-view="table"]').click();
      await expect(page.locator(".forecast-table")).toBeVisible();
      await shoot(page, "dock-grid", width);
    });

    test("dock blend chart", async ({ page }) => {
      await openMap(page);
      await expect(page.locator('[data-view="blend"]')).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".blend-chart")).toBeVisible();
      await expect(page.locator(".median-line")).toHaveCount(1);
      await shoot(page, "dock-blend", width);
    });

    test("dock candle chart", async ({ page }) => {
      await openMap(page);
      await page.locator('[data-view="candles"]').click();
      await expect(page.locator(".candle-chart")).toBeVisible();
      await expect(page.locator(".candle-body").first()).toBeVisible();
      await shoot(page, "dock-candles", width);
    });

    test("display filter", async ({ page }) => {
      await openMap(page);
      await page.getByLabel("Display options", { exact: true }).click();
      await expect(page.locator("dialog.display-filter")).toBeVisible();
      await shoot(page, "display-filter", width);
    });

    test("model picker", async ({ page }) => {
      await openMap(page);
      await page.getByLabel("Choose forecast model", { exact: true }).click();
      await expect(
        page.getByRole("group", { name: "Weather model" }),
      ).toBeVisible();
      await shoot(page, "model-picker", width);
    });

    test("forecast sheet", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Open spot search" }).click();
      await page
        .getByRole("searchbox", { name: "Search Irish spots" })
        .fill("Dublin");
      await page.locator(".spot-row").filter({ hasText: "Dollymount" }).click();
      await expect(page.locator(".forecast-sheet")).toBeVisible();
      // The selection opens the popout as well; Escape closes that alone, and
      // what is left is the sheet the chosen spot is read in.
      await page.keyboard.press("Escape");
      await expect(page.locator(".spot-popout-card")).toHaveCount(0);
      await expect(page.locator(".dock-place strong")).toHaveText("Dollymount");
      await settled(page);
      await shoot(page, "forecast-sheet", width);
    });

    test("info dialog", async ({ page }) => {
      await openMap(page);
      await page.locator(".model-info").click();
      await expect(page.locator("dialog.info-dialog")).toBeVisible();
      await shoot(page, "info-dialog", width);
    });

    test("site menu open", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Site menu" }).click();
      await expect(
        page.getByRole("navigation", { name: "Site" }),
      ).toBeVisible();
      await shoot(page, "site-menu", width);
    });

    test("error state", async ({ page }) => {
      // The basemap style is the one network call the map cannot do without:
      // refuse it and the map says so while the forecasts stay usable.
      await hideBasemap(page);
      await page.route(
        "https://tiles.openfreemap.org/styles/positron",
        (route) => route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await page.goto("/");
      await expect(page.locator(".map-error")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Reload map" }),
      ).toBeVisible();
      await shoot(page, "error", width);
    });

    test("stale snapshot warning", async ({ page }) => {
      // A statement about the reader's own clock, not about the fixture: the
      // sample runs are live at SAMPLE_CLOCK and long expired in 2030.
      // `setFixedTime`, not `install`: an installed clock holds the timers the
      // map loads through, and the shot would be of "Opening Ireland…".
      await page.clock.setFixedTime(new Date("2030-01-01T12:00:00Z"));
      await openMap(page);
      await expect(page.locator(".site-footer")).toContainText(
        "Archived snapshot",
      );
      await settled(page);
      await shoot(page, "stale", width);
    });
  });
}
