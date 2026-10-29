import { expect, test as base, type Page } from "@playwright/test";
import { SAMPLE_CLOCK } from "./columns";
import { modelName } from "../force5/src/lead";

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
  // Escape lets go of the chart's focus on the spot; pressed again, it would
  // close the dock, and then go back to the list.
  if (await page.locator(".map-canvas.is-focus").count())
    await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  // Out a step at a time until every light is on the chart, each step read
  // once the camera rests: through a move the lights are drawn on a canvas,
  // and their buttons wait where it last rested (force5/src/lights.ts). Read
  // mid-move, the chart they waited on was the one before it.
  //
  // The whole walk out runs in the page, one round trip for all of it. On
  // CI's software renderer every frame of a chart still settling from a step
  // is the whole map drawn and read back, the page's thread busy for most of
  // it, and a press and a reading from the test each waited on that thread:
  // seconds a step, for a button that never moves.
  await page
    .getByRole("button", { name: "Zoom out", exact: true })
    .evaluate(async (zoomOut: HTMLElement) => {
      const atRest = () =>
        new Promise<void>((resolve, reject) => {
          const until = performance.now() + 10000;
          const look = () => {
            if (!document.querySelector(".map-lights.is-moving")) resolve();
            else if (performance.now() > until)
              reject(new Error("the camera never came to rest"));
            else setTimeout(look, 50);
          };
          look();
        });
      const allOnTheChart = () => {
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
      };
      await atRest();
      // The loupe, when chosen, flies a spot in to fit its half-mile rose,
      // about zoom 13: eight steps out from there is not yet the whole country.
      for (let i = 0; i < 12 && !allOnTheChart(); i++) {
        // The step out begins with the press, and is read once it has ended.
        zoomOut.click();
        await atRest();
      }
    });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
}

/**
 * Change the stored rider in the page and say so, as Settings does on Save:
 * the display options no longer set the rider's weight or level.
 */
export async function setRider(page: Page, rider: Record<string, unknown>) {
  await page.evaluate((rider) => {
    const key = "force5.prefs.v1";
    const prefs = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(
      key,
      // Written as the current shape, so a rating of the rider's own is read.
      JSON.stringify({
        version: 3,
        ...prefs,
        rider: { ...prefs.rider, ...rider },
      }),
    );
    dispatchEvent(new CustomEvent("wingfoil:prefs", { detail: "device" }));
  }, rider);
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
 * Shut the map's open panel (the display options) on its dialog's X. It is
 * modal, so what it opened from is behind it.
 */
export async function closePanel(page: Page) {
  await page
    .locator("dialog.map-panel-dialog > div:first-child")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator("dialog.map-panel-dialog")).toHaveCount(0);
}

/**
 * What the site menu opens over the chart, each a row of its navigation
 * (force5/src/siteNav.ts SITE_NAV_GROUPS), and the layers, which are the
 * rail beside the zoom (src/LayerRail.tsx) rather than a row.
 */
export type ChartTool =
  "Settings" | "Layers" | "Display options" | "About" | "Take the tour";

/** The dialog each row opens, by its title. */
const DIALOG_TITLE: Partial<Record<ChartTool, string>> = {
  "Display options": "Display options",
  About: "About the map",
};

/** A row of the site menu that opens something over the chart, while it is open. */
export const menuRow = (page: Page, name: Exclude<ChartTool, "Layers">) =>
  siteRow(page, name);

/**
 * The site's navigation, the same on every page (force5/src/siteNav.ts
 * SITE_NAV_GROUPS): the chart and the spot finder, Settings and the display
 * options, About and the tour, then the sections, the marketplace and the
 * community switched on in this suite's build, and Use with AI last.
 */
export const SITE_ROWS = [
  "Chart",
  "Spot finder",
  "Settings",
  "Display options",
  "About",
  "Take the tour",
  "Marketplace",
  "Community",
  "Use with AI",
];

/** The site's navigation in the open menu: the same on every page. */
export const siteNav = (page: Page) =>
  page.getByRole("navigation", { name: "Site" });

/** A row of the site's navigation, by its name. */
export const siteRow = (page: Page, name: string) =>
  siteNav(page).getByRole("link", { name, exact: true });

/**
 * Open the site menu, a drawer from the left (force5/src/SiteMenu.tsx), and
 * wait for it to finish sliding in, so what is measured in it holds still.
 */
export async function openMenu(page: Page) {
  const menu = page.getByRole("button", { name: "Site menu" });
  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  const drawer = page.getByRole("dialog", { name: "Site menu" });
  await expect(drawer).toBeVisible();
  await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  return drawer;
}

/** The Layers button under the zoom, which opens and shuts the rail. */
export const layersButton = (page: Page) =>
  page.locator(".zbox").getByRole("button", { name: "Layers", exact: true });

/** The layers' rail beside the zoom (src/LayerRail.tsx). */
export const layersRail = (page: Page) =>
  page.getByRole("toolbar", { name: "Layers", exact: true });

/** Open the layers' rail, from the Layers button, if it is not open. */
export async function openLayers(page: Page) {
  const button = layersButton(page);
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
  await expect(layersRail(page)).toBeVisible();
}

/** Shut the layers' rail, from the Layers button, if it is open. */
export async function closeLayers(page: Page) {
  const button = layersButton(page);
  if ((await button.getAttribute("aria-expanded")) === "true")
    await button.click();
  await expect(layersRail(page)).toBeHidden();
}

/**
 * Open the layers, the display options, the map's information, Settings or
 * the tour as a rider does: the layers from the Layers button by the zoom,
 * the rest from the site menu.
 */
export async function openFromMenu(page: Page, name: ChartTool) {
  if (name === "Layers") return openLayers(page);
  await openMenu(page);
  await menuRow(page, name).click();
  const title = DIALOG_TITLE[name];
  if (title)
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
}

/**
 * A layer's button on the rail, by its name: each is a toggle button, its
 * state in `aria-pressed`.
 */
export const layerTile = (page: Page, name: string) =>
  layersRail(page).getByRole("button", { name, exact: true });

/**
 * Turn a layer on or off, as `check()` and `uncheck()` did a checkbox:
 * pressed only if it is not already as asked, and then it must be.
 */
export async function setLayer(page: Page, name: string, on: boolean) {
  await openLayers(page);
  const tile = layerTile(page, name);
  if ((await tile.getAttribute("aria-pressed")) !== String(on))
    await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", String(on));
}

/** The display options' choice of model, by a model's id. */
export const modelChoice = (page: Page, id: string) =>
  page
    .getByRole("group", { name: "Model", exact: true })
    .getByRole("button", { name: modelName(id), exact: true });

/**
 * Ask for a model the map draws and the stars rate, from the display options,
 * shut after. Asked, not had: a run that cannot be read leaves the rider on
 * the one they had.
 */
export async function chooseModel(page: Page, id: string) {
  await openFromMenu(page, "Display options");
  await modelChoice(page, id).click();
  await closePanel(page);
}

/**
 * The dock's rows under the fold (the gust factor, the waves, the current,
 * the sky, the air and the rain). On a wide screen, the grip on the dock's
 * top edge; on a phone's sheet, its handle stepped up a height, as a swipe
 * up does.
 */
export async function moreRows(page: Page) {
  const dock = page.locator(".dock");
  await expect(dock).toBeVisible();
  const grip = dock.getByRole("button", { name: "Show more rows" });
  if (await grip.count()) return grip.click();
  await dock.locator(".dk-grab").focus();
  await page.keyboard.press("ArrowUp");
}
