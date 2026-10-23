import { expect, test as base, type Page } from "@playwright/test";
import { SAMPLE_CLOCK } from "./columns";

/**
 * Every e2e test runs at `SAMPLE_CLOCK` unless it says otherwise.
 *
 * The site under test is served a calendar frozen in September 2026 (see
 * scripts/sample-weather.mjs), and almost everything the dock draws is a
 * statement about now: which runs have expired, which are stale, where the Now
 * line falls, and which column the scrubber opens on. A spec left on the wall
 * clock therefore asserts something different every day it is run, and in 2027
 * it asserts nothing at all — every run has expired and the page says so.
 *
 * Pinning it in a fixture rather than in each spec means a new spec is
 * time-independent by default: there is no line to forget. A test that needs
 * another moment simply calls `page.clock.setFixedTime` or `page.clock.install`
 * itself, which replaces this one — the clock replays its log in order, so the
 * last word wins.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(SAMPLE_CLOCK);
    await use(page);
  },
});

/** Where the map keeps a visitor's stars and the spots they chose (shared/web/favourites). */
export const SPOTS_KEY = "wingfoil.spots.v1";

/**
 * Store `id` as the spot this visitor chose before, as the map's favourites
 * do. It no longer opens anything: the map opens with no dock until a spot is
 * chosen, however many it remembers (src/openingSpot.ts). A spec about a
 * spot's dock opens one with `/?spot=` (focused, as a shared link is) or
 * `chooseSpot`. The store is written before the page's own scripts, and only
 * while it is empty: a spec that stars, chooses or reloads keeps what the
 * page wrote.
 */
export async function rememberSpot(page: Page, id = "brandon") {
  await page.addInitScript(
    ([key, id]) => {
      if (localStorage.getItem(key) !== null) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          starred: [],
          visits: { [id]: { id, count: 1, last: 1 } },
        }),
      );
    },
    [SPOTS_KEY, id] as const,
  );
}

/**
 * Choose a spot as a rider does, with a tap on its light: the dock opens on
 * it and the chart flies there. The lights stand close on the whole of
 * Ireland, so the tap goes to the light itself rather than to a point on the
 * screen another light may cover.
 */
export async function chooseSpot(page: Page, id = "brandon") {
  await page
    .locator(`.spot-marker[data-spot-id="${id}"]`)
    .evaluate((light: HTMLElement) => light.click());
  await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
    timeout: 30000,
  });
}

/**
 * Back to the whole of Ireland with the dock still open, as the map stood
 * when a remembered spot opened it: the chart let go of the spot it flew to
 * and zoomed back out until every light is on it, each rated again. For a
 * spec that reads every light, or times the hours over the whole chart.
 */
export async function backToIreland(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  const allOnTheChart = () =>
    page.evaluate(() => {
      const chart = document
        .querySelector(".maplibregl-canvas")!
        .getBoundingClientRect();
      return [...document.querySelectorAll(".spot-marker")].every((light) => {
        const r = light.getBoundingClientRect();
        return (
          r.left >= chart.left &&
          r.right <= chart.right &&
          r.top >= chart.top &&
          r.bottom <= chart.bottom
        );
      });
    });
  // The loupe, when chosen, flies a spot in to fit its half-mile rose, about
  // zoom 13: eight steps out from there is not yet the whole country.
  for (let i = 0; i < 12 && !(await allOnTheChart()); i++) {
    await zoomOut.click();
    await page.waitForTimeout(400);
  }
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
}

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";

/**
 * Wait until the page draws at frame rate: the longest of ten frames under
 * 50 ms. For a gesture that is judged on timing — a double-click inside the
 * map's single-click wait, a camera said to be at rest because two readings
 * a quarter-second apart agree — right after load, while the page is still
 * reading every model's manifest and placing every riding place's marker.
 */
export async function steadyFrames(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const times: number[] = [];
              const tick = (time: number) => {
                times.push(time);
                if (times.length < 11) requestAnimationFrame(tick);
                else
                  resolve(
                    Math.max(...times.slice(1).map((t, i) => t - times[i])),
                  );
              };
              requestAnimationFrame(tick);
            }),
        ),
      { timeout: 30000 },
    )
    .toBeLessThan(50);
}

/**
 * Shut the map's open panel (the layers, your spots or the display options)
 * on its dialog's X. It is modal, so the button it opened from is behind it.
 */
export async function closePanel(page: Page) {
  await page
    .locator("dialog.map-panel-dialog > div:first-child")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator("dialog.map-panel-dialog")).toHaveCount(0);
}

/** The chart's own tools, each a row of the site menu's (src/MapControls.tsx `chartTools`). */
export type ChartTool =
  "Layers" | "Your spots" | "Display options" | "About the map";

/** A chart tool's row in the site menu, while the menu is open. */
export const menuRow = (page: Page, name: ChartTool) =>
  page
    .getByRole("group", { name: "The chart" })
    .getByRole("button", { name, exact: true });

/**
 * Open the layers, your spots, the display options or the map's information
 * as a rider does: from the site menu, the one way in to them.
 */
export async function openFromMenu(page: Page, name: ChartTool) {
  const menu = page.getByRole("button", { name: "Site menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  await menuRow(page, name).click();
  // Each dialog is titled as its row is named.
  await expect(page.getByRole("dialog", { name })).toBeVisible();
}

/**
 * A tile in the open Layers panel (src/LayersPanel.tsx), by its name: each is
 * a toggle button, its state in `aria-pressed`.
 */
export const layerTile = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Layers" })
    .getByRole("button", { name, exact: true });

/**
 * Turn a tile on or off, as `check()` and `uncheck()` did a checkbox: pressed
 * only if it is not already as asked, and then it must be.
 */
export async function setLayer(page: Page, name: string, on: boolean) {
  const tile = layerTile(page, name);
  if ((await tile.getAttribute("aria-pressed")) !== String(on))
    await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", String(on));
}

/**
 * On a phone the dock's tools are folded into one glyph (src/ForecastDock.tsx
 * `dk-fold`): open them, where they are folded, before a press on one.
 */
export async function unfoldTools(page: Page) {
  const fold = page.locator(".dk-tools .dk-fold");
  if (
    (await fold.count()) &&
    (await fold.getAttribute("aria-expanded")) === "false"
  )
    await fold.click();
}
