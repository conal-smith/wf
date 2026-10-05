import { expect, test, type Page } from "../fixtures";

/**
 * The map's visual baseline: one PNG per state per width, committed.
 *
 * The chart's boxes, lights, popup and dock, each state as a reader reaches
 * it — panel open, popup up, hours drawn — and each the same twice, so a
 * change to the map's CSS shows up as a picture of what it changed.
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
 * The chart's style is ours, but its coast comes from OpenFreeMap's tiles over
 * the network in every run, and a picture of their tiles is neither ours to
 * commit nor stable across a change of theirs. Hiding the canvas leaves
 * everything the map's own CSS draws: the paper beneath it, the neatline, the
 * lights, the popup, the panels and the dock. The map still loads.
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

/** The chart, open and drawn: every light placed and rated, nothing loading. */
async function openMap(page: Page, path = "/") {
  await hideBasemap(page);
  await page.goto(path);
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
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
        mono: loaded("IBM Plex Mono"),
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

/** Choose a spot by name, as the head's search does. */
async function pick(page: Page, words: string) {
  await page.getByRole("combobox", { name: "Find a spot" }).fill(words);
  await page.locator(".spot-row").first().click();
}

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height } });
    const phone = width < 720;

    test("idle chart", async ({ page }) => {
      await openMap(page);
      await shoot(page, "idle", width);
    });

    test("search open", async ({ page }) => {
      await openMap(page);
      await page.getByRole("combobox", { name: "Find a spot" }).fill("Dublin");
      await expect(page.locator(".results .spot-row").first()).toBeVisible();
      await shoot(page, "search", width);
    });

    test("layers panel", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await expect(page.getByRole("group", { name: "Layers" })).toBeVisible();
      await shoot(page, "layers", width);
    });

    test("spot focused, with its popup", async ({ page }) => {
      await openMap(page);
      await pick(page, "Blast");
      await expect(
        page.getByRole("dialog", { name: /Kilcrea.*at a glance/ }),
      ).toBeVisible();
      await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
      await shoot(page, "popup", width);
    });

    test("the dock's hours", async ({ page }) => {
      await openMap(page);
      if (phone) await page.locator(".dock-grab").click();
      await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
      await page.getByRole("slider", { name: "Forecast time" }).fill("12");
      await shoot(page, "dock", width);
    });

    test("the dock's blend", async ({ page }) => {
      await openMap(page);
      if (phone) await page.locator(".dock-grab").click();
      await page.locator(".dk-view").getByRole("button", { name: "Blend" }).click();
      await expect(page.locator(".dock .blend-chart")).toBeVisible();
      await shoot(page, "dock-blend", width);
    });

    test("display options", async ({ page }) => {
      await openMap(page);
      await page.getByLabel("Display options", { exact: true }).click();
      await expect(page.locator("dialog.display-filter")).toBeVisible();
      await shoot(page, "display-filter", width);
    });

    test("your spots, starred", async ({ page }) => {
      await openMap(page);
      await page
        .locator(".dock")
        .getByRole("button", { name: "Star Brandon Bay" })
        .click();
      await pick(page, "Dollymount");
      await page.keyboard.press("Escape");
      await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
      await shoot(page, "your-spots", width);
    });

    test("the key", async ({ page }) => {
      await openMap(page);
      if (phone)
        await page.getByRole("button", { name: "Your spots and the key" }).click();
      else await page.getByRole("tab", { name: "Key" }).click();
      await expect(page.locator(".key")).toBeVisible();
      await shoot(page, "key", width);
    });

    test("the small print", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Sources and small print" }).click();
      await expect(
        page.getByRole("dialog", { name: "Sources and small print" }),
      ).toBeVisible();
      await shoot(page, "small-print", width);
    });

    test("site menu open", async ({ page }) => {
      await openMap(page);
      await page.getByRole("button", { name: "Site menu" }).click();
      await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
      await shoot(page, "site-menu", width);
    });

    test("error state", async ({ page }) => {
      await hideBasemap(page);
      await page.route("https://tiles.openfreemap.org/planet", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await page.goto("/");
      await expect(page.locator(".map-error")).toBeVisible({ timeout: 30000 });
      await shoot(page, "error", width);
    });

    test("expired snapshot", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2030-01-01T12:00:00Z"));
      await hideBasemap(page);
      await page.goto("/");
      await expect(page.locator(".map-model")).toContainText("archived", {
        timeout: 30000,
      });
      await expect(page.locator(".spot-marker")).toHaveCount(146);
      await shoot(page, "stale", width);
    });

    test("model switch loading", async ({ page }) => {
      await openMap(page);
      await page.route("**/weather/icon-eu-*/*", () => {});
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await page.locator('[data-model="icon-eu"]').click();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await shoot(page, "model-loading", width);
    });

    test("model switch warning", async ({ page }) => {
      await page.route("**/weather/latest.json", (route) =>
        route.fulfill({ status: 503, body: "Unavailable" }),
      );
      await openMap(page);
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await page.locator('[data-model="icon-eu"]').click();
      await expect(page.locator(".frame-status.is-error")).toBeVisible();
      await page.getByRole("button", { name: "Layers", exact: true }).click();
      await shoot(page, "warning", width);
    });

    test("focus ring", async ({ page }) => {
      await openMap(page);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Site menu" })).toBeFocused();
      await shoot(page, "focus-ring", width);
    });
  });
}
