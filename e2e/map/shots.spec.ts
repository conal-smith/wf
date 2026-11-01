import {
  barName,
  barReady,
  expect,
  layersRail,
  modelChoice,
  openFromMenu,
  rememberSpot,
  saveSettings,
  SPOTS_KEY,
  test,
  timeSlider,
  type Page,
} from "../fixtures";

/**
 * The map's visual baseline: one PNG per state per width, committed.
 *
 * The chart's boxes, lights, dialogs and scrub bar, each state as a reader
 * reaches it — a panel open, a spot chosen, its week drawn — and each the
 * same twice, so
 * a change to the map's CSS shows up as a picture of what it changed.
 *
 * What is held still, and how:
 *   the clock     pinned by e2e/fixtures.ts, over the fixed sample calendar
 *                 that scripts/sample-weather.mjs writes for the e2e site;
 *   motion        `reducedMotion: reduce` for the whole file, which stops the
 *                 particle field, the camera easing and the CSS transitions,
 *                 and `animations: "disabled"` at the shutter for the rest;
 *   the basemap   hidden, see `hideBasemap`;
 *   the fonts     awaited and then checked — they are fetched, so an early or
 *                 offline shutter catches the fallback face and moves every
 *                 line of text a little;
 *   the layout    watched until it stops, see `settled`.
 *
 * Each state is a test of its own so that it opens its own context: the map
 * remembers display choices in storage, and a shot must not inherit them.
 *
 * Not part of `npm run test:e2e`: `npm run map:shots` alone runs this file (see
 * playwright.config.ts). A gate that rewrites committed files as it passes is
 * not a gate, and nothing here asserts anything the other specs do not.
 */

test.use({ reducedMotion: "reduce" });

// Every state but the first visit's is a returning visitor's, with Brandon
// Bay chosen last. That opens nothing: the scrub bar is a plain timeline
// until a spot is chosen, so the state about a spot's week chooses Brandon
// Bay.
test.beforeEach(({ page }) => rememberSpot(page, "brandon"));

/** Where a shot lands, relative to the repo root Playwright is run from. */
const shot = (state: string, width: number) =>
  `e2e/map/__baseline__/${state}-${width}.png`;

/**
 * Keep the basemap raster out of the comparison.
 *
 * The chart's style is ours, but its coast comes from OpenFreeMap's tiles over
 * the network in every run, and a picture of their tiles is neither ours to
 * commit nor stable across a change of theirs. Hiding the canvas leaves
 * everything the map's own CSS draws: the paper beneath it, the lights, the
 * panels, the dialogs and the scrub bar. The map still loads.
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

/**
 * Gust, in the corner. He comes once the chart is drawn and the page has a
 * moment to spare (src/App.tsx), so a shutter that does not wait for him
 * catches him in some states and not in others, by timing alone.
 */
async function gustArrived(page: Page) {
  await expect(page.locator(".gust-launcher")).toBeVisible({ timeout: 10000 });
}

/** The chart, open and drawn: every light placed and rated, nothing loading. */
async function openMap(page: Page, path = "/?map") {
  await hideBasemap(page);
  await page.goto(path);
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await gustArrived(page);
}

/** Nothing is moving any more: the boxes and a light read the same twice. */
async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = await page.evaluate(() =>
        [".map-panel", ".map-footer", ".spot-marker.sel", ".spot-marker"]
          .map((selector) => {
            const el = document.querySelector(selector);
            if (!el) return "-";
            const box = el.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height]
              .map(Math.round)
              .join(",");
          })
          .join("|"),
      );
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

/** The shutter. Everything held still, then the frame. */
async function shoot(page: Page, state: string, width: number) {
  await settled(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Text is measured with the real faces or not at all: a shot over the
  // fallback moves every line in it. The chart's figures are IBM Plex Mono and
  // its names Fraunces; both have to be in.
  expect(
    await page.evaluate(() => {
      const faces = [...document.fonts];
      const loaded = (family: string) =>
        faces.some(
          (face) =>
            face.family.replace(/"/g, "").startsWith(family) &&
            face.status === "loaded",
        );
      return {
        mono: loaded("Inter Variable"),
        display: loaded("Fraunces"),
        failed: faces
          .filter((face) => face.status === "error")
          .map((face) => face.family),
      };
    }),
    "the shot would be of the fallback face",
  ).toEqual({ mono: true, display: true, failed: [] });
  await page.screenshot({
    path: shot(state, width),
    animations: "disabled",
    caret: "hide",
  });
}

/**
 * The head's search, opened first on a phone, where it is a round button
 * until pressed.
 */
async function search(page: Page) {
  const opener = page.locator("[data-spot-search-open]");
  if (await opener.isVisible()) await opener.click();
  return page.getByRole("combobox", { name: "Search spots" });
}

/** Choose a spot by name, as the head's search does. */
async function pick(page: Page, words: string) {
  await (await search(page)).fill(words);
  await page.locator("[data-spot-option]").first().click();
}

for (const { width, height } of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test("idle chart", async ({ page }) => {
      await openMap(page);
      await shoot(page, "idle", width);
    });

    test("a first visit, with no spot and so a plain timeline", async ({
      page,
    }) => {
      await page.addInitScript(
        (key) => localStorage.removeItem(key),
        SPOTS_KEY,
      );
      await openMap(page);
      await expect(barName(page)).toHaveCount(0);
      await shoot(page, "first-visit", width);
    });

    test("search open", async ({ page }) => {
      await openMap(page);
      await (await search(page)).fill("Dublin");
      await expect(page.locator("[data-spot-option]").first()).toBeVisible();
      await shoot(page, "search", width);
    });

    test("layers rail", async ({ page }) => {
      await openMap(page);
      await openFromMenu(page, "Layers");
      await expect(layersRail(page)).toBeVisible();
      await shoot(page, "layers", width);
    });

    test("spot focused, with no box over it", async ({ page }) => {
      await openMap(page);
      await pick(page, "Blast");
      await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await shoot(page, "spot", width);
    });

    test("a spot's week", async ({ page }) => {
      await openMap(page);
      await pick(page, "Brandon Bay");
      await barReady(page);
      await timeSlider(page).fill("12");
      // The week as it stands, not the focus ring the slider draws round it.
      await timeSlider(page).blur();
      await expect(
        page.locator('.scrub [data-curve="wind"] .sb-line'),
      ).toHaveAttribute("d", /^M/);
      await shoot(page, "week", width);
    });

    test("a point tapped on the map", async ({ page }) => {
      await openMap(page);
      const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
      const at = await page.evaluate((box) => {
        for (let y = 300; y < box.height - 360; y += 30)
          for (let x = 700; x > 120; x -= 30) {
            // The basemap is hidden here, so what is under the point is the
            // map's own container, not its canvas.
            const hit = document.elementFromPoint(box.x + x, box.y + y);
            if (
              hit?.closest(".map-canvas") &&
              !hit.closest(".spot-marker, .maplibregl-marker")
            )
              return { x, y };
          }
        return { x: 300, y: 300 };
      }, box);
      // The tap needs the canvas under it; it is hidden again for the shot.
      const canvas = page.locator(".maplibregl-canvas");
      await canvas.evaluate(
        (el) => ((el as HTMLElement).style.visibility = "visible"),
      );
      await canvas.click({ position: at });
      await canvas.evaluate(
        (el) => ((el as HTMLElement).style.visibility = ""),
      );
      await expect(page.locator(".pick-mark")).toHaveCount(1);
      // The point's week in the scrub bar: a place, not a riding spot.
      await barReady(page);
      await expect(page.locator(".scrub")).not.toHaveAttribute("data-spot");
      await expect(
        page.locator('.scrub [data-curve="wind"] .sb-line'),
      ).toHaveAttribute("d", /^M/);
      await shoot(page, "point", width);
    });

    test("settings, at the forecast's part", async ({ page }) => {
      await openMap(page);
      await openFromMenu(page, "Settings");
      await page.locator(".st-part.is-forecast").scrollIntoViewIfNeeded();
      await shoot(page, "settings", width);
    });

    test("the key", async ({ page }) => {
      await openMap(page);
      await openFromMenu(page, "About the map");
      await expect(page.locator(".map-info .mi-keys")).toBeVisible();
      await shoot(page, "key", width);
    });

    test("the small print", async ({ page }) => {
      await openMap(page);
      await page
        .getByRole("button", { name: "Sources and small print" })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Sources and small print" }),
      ).toBeVisible();
      await shoot(page, "small-print", width);
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
      await hideBasemap(page);
      await page.route("https://tiles.openfreemap.org/planet", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await page.goto("/?map");
      await expect(page.locator(".map-error")).toBeVisible({ timeout: 30000 });
      await shoot(page, "error", width);
    });

    test("expired snapshot", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2030-01-01T12:00:00Z"));
      await hideBasemap(page);
      await page.goto("/?map");
      await expect(page.locator(".map-model")).toContainText("archived", {
        timeout: 30000,
      });
      await expect(page.locator(".spot-marker")).toHaveCount(149);
      await gustArrived(page);
      await shoot(page, "stale", width);
    });

    test("model switch loading", async ({ page }) => {
      await openMap(page);
      await page.route("**/weather/icon-eu-*/t/**", () => {});
      await openFromMenu(page, "Settings");
      await modelChoice(page, "icon-eu").click();
      await saveSettings(page);
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await shoot(page, "model-loading", width);
    });

    test("model switch warning", async ({ page }) => {
      await page.route("**/weather/latest.json", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await openMap(page);
      await openFromMenu(page, "Settings");
      await modelChoice(page, "icon-eu").click();
      await saveSettings(page);
      await expect(page.locator(".frame-status.is-error")).toBeVisible();
      await shoot(page, "warning", width);
    });

    test("focus ring", async ({ page }) => {
      await openMap(page);
      // The first stop for the keys is the skip link, past the menu and the
      // lights to the search (src/App.tsx), seen only with the focus.
      await page.keyboard.press("Tab");
      await expect(page.locator("[data-skip-link]")).toBeFocused();
      await expect(page.locator("[data-skip-link]")).toHaveText(
        "Skip to the search",
      );
      await shoot(page, "focus-ring", width);
    });
  });
}
