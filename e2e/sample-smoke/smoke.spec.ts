import {
  test as frozen,
  expect,
  chooseSpot,
  siteRow,
  SPOTS_KEY,
  type Page,
} from "../fixtures";
import { SAMPLE_CLOCK } from "../columns";
import { OPENFREEMAP } from "../../force5/src/chartStyle";

/**
 * The quick end-to-end gate: does the main thing work, end to end, on every
 * page a rider reaches first? Against the staged sample site
 * (scripts/e2e-site.mjs) at the sample's clock, as the full suite is, and run
 * alone by `npm run test:smoke` (the `smoke` project in playwright.config.ts).
 *
 * Each test is one cheap look: a page loads, its data is read and drawn, and
 * nothing throws. No gesture, no animation, no timing: a failure here means
 * the site is broken, not that a runner was slow. Behaviour in detail is the
 * unit tests' (vitest) and the full suite's (`npm run test:e2e`).
 *
 * The basemap is answered here, empty: OpenFreeMap's tiles are somebody
 * else's network, and the chart is ours whether or not their coast arrives.
 * Every page error, and every console error, fails the test it happened in.
 */

/** Half past one, Irish time, on the sample's day: the finder's hours are ahead. */
const AFTERNOON = new Date(SAMPLE_CLOCK.getTime() - 7.5 * 3600000);

/** An empty planet: the TileJSON, then every tile and glyph range as nothing. */
async function emptyBasemap(page: Page) {
  await page.route(`${OPENFREEMAP}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/planet")
      return route.fulfill({
        json: {
          tilejson: "3.0.0",
          tiles: [`${OPENFREEMAP}/planet/smoke/{z}/{x}/{y}.pbf`],
          minzoom: 0,
          maxzoom: 14,
          vector_layers: [],
        },
      });
    return route.fulfill({
      status: 200,
      contentType: "application/x-protobuf",
      body: Buffer.alloc(0),
    });
  });
}

const test = frozen.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await emptyBasemap(page);
      await use(errors);
      expect(errors, "page and console errors").toEqual([]);
    },
    { auto: true },
  ],
});

/** Star these places before the page's own scripts run: the finder's Favourites. */
const star = (page: Page, ids: string[]) =>
  page.addInitScript(
    ([key, ids]) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ starred: ids, visits: {} }));
    },
    [SPOTS_KEY, ids] as const,
  );

const cards = (page: Page) => page.locator("[data-spot-card]");

/** The finder up, every card rated and its hours in knots. */
async function finderReads(page: Page, count: number) {
  await expect(page.locator("[data-spot-finder]")).toBeVisible({
    timeout: 30000,
  });
  await expect(cards(page)).toHaveCount(count, { timeout: 30000 });
  await expect
    .poll(
      () =>
        cards(page).evaluateAll((els) =>
          els.every((el) => Number(el.getAttribute("data-best")) >= 0),
        ),
      { timeout: 30000 },
    )
    .toBe(true);
  // Today hour by hour, each hour's wind a figure.
  const brandon = cards(page).filter({ hasText: "Brandon Bay" });
  await expect(brandon.getByText("Today", { exact: true })).toBeVisible();
  await expect(
    brandon.locator("[data-day-hours] [data-hour] b").first(),
  ).toHaveText(/\d/);
}

/**
 * The chart's canvas has been painted: many colours in it. Shot alone, with
 * everything the page draws over it hidden, so the lights and the panels do
 * not count as the chart.
 */
async function painted(page: Page) {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 30000 });
  await expect
    .poll(
      async () => {
        const png = (
          await canvas.screenshot({
            style:
              "* { visibility: hidden !important } .maplibregl-canvas { visibility: visible !important }",
          })
        ).toString("base64");
        return page.evaluate(async (png) => {
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          const sheet = document.createElement("canvas");
          sheet.width = image.width;
          sheet.height = image.height;
          const context = sheet.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const { data } = context.getImageData(
            0,
            0,
            image.width,
            image.height,
          );
          const colours = new Set<number>();
          for (let i = 0; i < data.length && colours.size < 50; i += 4 * 97)
            colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
          return colours.size;
        }, png);
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(10);
}

test.describe("on a desktop", () => {
  test("the home page is the spot finder, its cards reading the forecast", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel", "tramore"]);
    await page.clock.setFixedTime(AFTERNOON);
    await page.goto("/");
    await finderReads(page, 4);
  });

  test("the chart draws, and every riding place has its light", async ({
    page,
  }) => {
    await page.goto("/?map");
    await expect
      .poll(() => page.locator(".spot-marker").count(), { timeout: 30000 })
      .toBeGreaterThan(100);
    await expect(page.locator(".map-error")).toHaveCount(0);
    await painted(page);
  });

  test("a spot chosen on the chart opens the dock on its hours", async ({
    page,
  }) => {
    await page.goto("/?map");
    await expect(page.locator(".dock")).toHaveCount(0);
    await chooseSpot(page, "brandon");
    await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
    await expect
      .poll(() => page.locator(".dock tr.tt-wind td .kn").count(), {
        timeout: 30000,
      })
      .toBeGreaterThan(10);
  });

  test("a spot's page draws its week, hour by hour", async ({ page }) => {
    const answer = await page.goto("/spot/brandon");
    expect(answer?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveTitle(/Brandon Bay/);
    expect(await page.locator("[data-day-card]").count()).toBeGreaterThan(2);
    // Tomorrow is daylight, every hour of it a row with its stars.
    const tomorrow = page.locator("[data-day]").nth(1);
    expect(await tomorrow.locator("tr[data-daylight]").count()).toBeGreaterThan(
      4,
    );
    expect(await tomorrow.locator("[data-stars]").count()).toBeGreaterThan(4);
  });

  test("an unknown spot's address answers 404, and says so", async ({
    page,
    errors,
  }) => {
    const answer = await page.goto("/spot/no-such-place");
    expect(answer?.status()).toBe(404);
    await expect(page.getByText("No riding place at this address")).toBeVisible(
      { timeout: 30000 },
    );
    // The 404 itself is the browser's to report, and is this test's point.
    errors.splice(
      0,
      errors.length,
      ...errors.filter((e) => !/status of 404/.test(e)),
    );
  });

  test("the site menu opens, and Settings from it", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-spot-finder]")).toBeVisible({
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Site menu" }).click();
    await expect(page.getByRole("dialog", { name: "Site menu" })).toBeVisible();
    await expect(siteRow(page, "Chart")).toBeVisible();
    await siteRow(page, "Settings").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
      timeout: 30000,
    });
  });

  test("Use with AI draws a button for each app", async ({ page }) => {
    await page.goto("/ai");
    await expect(page.locator("[data-app]").first()).toBeVisible({
      timeout: 30000,
    });
    expect(await page.locator("[data-app]").count()).toBeGreaterThan(3);
  });

  test("the community loads its channels from the API", async ({ page }) => {
    await page.goto("/community");
    const rail = page.getByRole("navigation", { name: "Channels" });
    await expect(rail.getByRole("link", { name: /General/ })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("the marketplace loads", async ({ page }) => {
    await page.goto("/market");
    await expect(page.getByRole("main")).toBeVisible({ timeout: 30000 });
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });

  test("the home page's cards read the forecast", async ({ page }) => {
    await star(page, ["brandon", "dollymount"]);
    await page.clock.setFixedTime(AFTERNOON);
    await page.goto("/");
    await finderReads(page, 2);
  });

  test("the chart draws its lights, and a spot in the link opens on its hours", async ({
    page,
  }) => {
    await page.goto("/?spot=brandon");
    await expect
      .poll(() => page.locator(".spot-marker").count(), { timeout: 30000 })
      .toBeGreaterThan(100);
    await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("a spot's page draws its week", async ({ page }) => {
    await page.goto("/spot/brandon");
    await expect(
      page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(await page.locator("[data-day]").count()).toBeGreaterThan(2);
  });
});
