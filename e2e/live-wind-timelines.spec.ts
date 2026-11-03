import { readFileSync } from "node:fs";
import { expect, SPOTS_KEY, test, type Page } from "./fixtures";
import { SAMPLE_WEATHER } from "./sample";

/**
 * The wind as measured beside the forecast (force5/src/windObs.ts
 * `pairStation`): a spot's nearest weather station or buoy, within 25 km,
 * drawn on the spot page's wind up to now and said by its readout at Now, by
 * the scrub bar's readout at and before now, and by the finder's cards on
 * today. Belmullet's beach has Met Éireann's Belmullet station a kilometre
 * away; Brandon Bay has none within reach.
 *
 * The readings are the e2e site's synthetic ones, ending at SAMPLE_CLOCK,
 * 21:00 UTC: 22:00 in Ireland.
 */

const OBS = JSON.parse(
  readFileSync(`${SAMPLE_WEATHER}/../marine/wind-observations.json`, "utf8"),
);
const KNOTS = 1.94384449;
const kn = (mps: number) =>
  String(Math.round(Math.round(mps * KNOTS * 10) / 10));
const BELMULLET = OBS.stations.ME_03976;

const graph = (page: Page) => page.locator("[data-graph-svg]");
const readoutWind = (page: Page) => page.locator("[data-readout-wind]");

test.describe("the spot page", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("draws the station's wind and gust up to now beside the forecast, with its name and distance in the key", async ({
    page,
  }) => {
    await page.goto("/spot/belmullet");
    await expect(
      page.getByRole("heading", { level: 1, name: "Belmullet" }),
    ).toBeVisible({ timeout: 30000 });
    const measured = graph(page).locator('[data-measured="ME_03976"]');
    await expect(measured).toHaveCount(1);
    await expect(measured.locator("[data-measured-line]")).toHaveCount(1);
    const winds = measured.locator("[data-measured-wind]");
    const gusts = measured.locator("[data-measured-gust]");
    // Every hour since the graph's first midnight, up to now and none after.
    expect(await winds.count()).toBeGreaterThan(12);
    expect(await gusts.count()).toBe(await winds.count());
    const times = await winds.evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute("data-measured-wind"))),
    );
    const clock = Date.parse(BELMULLET.latest.time);
    expect(Math.max(...times)).toBe(clock);
    // Drawn left of the line at now, in the readings' gold.
    const now = await graph(page)
      .locator("line.stroke-pen")
      .first()
      .evaluate((el) => Number(el.getAttribute("x1")));
    const xs = await winds.evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute("cx"))),
    );
    expect(Math.max(...xs)).toBeLessThan(now);
    expect(
      await winds.first().evaluate((el) => getComputedStyle(el).fill),
    ).toBe("rgb(233, 178, 0)");
    // Its own entry in the key's Wind group.
    await expect(page.locator("[data-measured-key]")).toHaveText(
      "Measured at Belmullet 1 km, wind and gust",
    );
  });

  test("at Now the readout's wind is the station's last reading, and says where and when; other hours keep the forecast", async ({
    page,
  }) => {
    await page.goto("/spot/belmullet");
    await expect(page.locator("[data-readout]")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("[data-readout]")).toContainText("Now");
    const value = readoutWind(page).locator("b");
    await expect(value).toHaveAttribute("data-measured", "ME_03976");
    await expect(value).toHaveText(
      new RegExp(`^${kn(BELMULLET.latest.speed)}( g\\d+)? kn [NESW]{1,3}$`),
    );
    await expect(readoutWind(page).locator("[data-readout-source]")).toHaveText(
      "· Belmullet 1 km, 22:00",
    );
    // An hour tomorrow, under the pointer: the forecast, from nowhere else.
    await page.locator("[data-spot-graph]").scrollIntoViewIfNeeded();
    const box = (await page.locator("[data-spot-graph]").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + 80);
    await expect(page.locator("[data-readout]")).not.toContainText("Now");
    await expect(value).not.toHaveAttribute("data-measured", /.*/);
    await expect(
      readoutWind(page).locator("[data-readout-source]"),
    ).toHaveCount(0);
  });

  test("a spot with no station within reach draws and says only the forecast", async ({
    page,
  }) => {
    await page.goto("/spot/brandon");
    await expect(page.locator("[data-readout]")).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("[data-measured]")).toHaveCount(0);
    await expect(page.locator("[data-measured-key]")).toHaveCount(0);
    await expect(
      readoutWind(page).locator("[data-readout-source]"),
    ).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the spot page's readout and graph say the measured wind too", async ({
    page,
  }) => {
    await page.goto("/spot/belmullet");
    await expect(page.locator("[data-readout]")).toBeVisible({
      timeout: 30000,
    });
    await expect(readoutWind(page).locator("b")).toHaveAttribute(
      "data-measured",
      "ME_03976",
    );
    await expect(
      graph(page).locator('[data-measured="ME_03976"] [data-measured-wind]'),
    ).not.toHaveCount(0);
  });
});

test("the scrub bar's readout says what the station measured at now", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?spot=belmullet");
  const wind = page.locator('.scrub [data-cell="wind"]');
  await expect(wind).toHaveAttribute("data-measured", "ME_03976", {
    timeout: 30000,
  });
  await expect(wind.locator(".sb-label")).toHaveText(
    "Measured · Belmullet 1 km",
  );
  await expect(wind.locator(".sb-value b")).toHaveText(
    `${kn(BELMULLET.latest.speed)} kn`,
  );
  await expect(wind.locator(".sb-swatch.is-measured")).toHaveCount(1);
});

test("a finder card on today says the wind measured now at its station, and not on another day", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ([key]) =>
      localStorage.setItem(
        key,
        JSON.stringify({ starred: ["belmullet", "brandon"], visits: {} }),
      ),
    [SPOTS_KEY] as const,
  );
  await page.goto("/");
  const cards = page.locator("[data-spot-card]");
  await expect(cards).toHaveCount(2, { timeout: 30000 });
  // After dark the list opens on tomorrow: back to today.
  const previous = page.getByRole("button", { name: "Previous day" });
  if (await previous.isEnabled()) await previous.click();
  const card = page.locator('[data-spot-card="belmullet"]');
  const line = card.locator('[data-card-measured="ME_03976"]');
  await expect(line).toBeVisible();
  await expect(line).toHaveText(
    new RegExp(
      `^Now ${kn(BELMULLET.latest.speed)}( g\\d+)? kn measured at · Belmullet 1 km$`,
    ),
  );
  await expect(line).toHaveAttribute(
    "title",
    "Measured at Belmullet 1 km, 22:00",
  );
  // Brandon Bay has no station near enough.
  await expect(
    page.locator('[data-spot-card="brandon"] [data-card-measured]'),
  ).toHaveCount(0);
  // Tomorrow: the forecast alone.
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(line).toHaveCount(0);
});
