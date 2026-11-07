import { readFileSync } from "node:fs";
import { expect, openFromMenu, SPOTS_KEY, test, type Page } from "./fixtures";
import { SAMPLE_WEATHER } from "./sample";

/**
 * The plain map beside the Spot finder's list, and the Live wind layer
 * (force5/src/lights.ts, force5/src/readingPills.ts): each listed spot a pill
 * with its wind and gust in its stars' colour, and each weather station and
 * buoy a gold pill at the wind it last measured, with a card under the
 * pointer or a tap. On by default beside the list; on the full chart, a
 * switch in Layers under Wind, off until asked for.
 *
 * The readings are the e2e site's synthetic ones (scripts/sample-weather.mjs
 * `windObservations`), ending at SAMPLE_CLOCK, 21:00 UTC (22:00 in Ireland):
 * the M6 buoy stopped five hours before, so its reading is faded.
 */

const OBS = JSON.parse(
  readFileSync(`${SAMPLE_WEATHER}/../marine/wind-observations.json`, "utf8"),
);
const KNOTS = 1.94384449;
const kn = (mps: number) =>
  String(Math.round(Math.round(mps * KNOTS * 10) / 10));
const STATIONS = Object.keys(OBS.stations).length;

const star = (page: Page, ids: string[]) =>
  page.addInitScript(
    ([key, ids]) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ starred: ids, visits: {} }));
    },
    [SPOTS_KEY, ids] as const,
  );

const cards = (page: Page) => page.locator("[data-spot-card]");
const lights = (page: Page) => page.locator(".spot-marker");
/** The spots on the list, as pills; the rest are muted dots. */
const pills = (page: Page) => page.locator(".spot-marker:not(.lt-dot)");
const readings = (page: Page) => page.locator(".obs");
const card = (page: Page) => page.locator(".obs-card");
const reading = (page: Page, id: string) =>
  page.locator(`.obs[data-station-id="${id}"]`);

async function openHome(page: Page, ids = ["brandon", "dollymount", "keel"]) {
  await star(page, ids);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(ids.length, { timeout: 30000 });
  await expect(pills(page)).toHaveCount(ids.length, { timeout: 30000 });
}

test.describe("beside the list", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("each listed spot is a pill with its wind, in place of a ring, and keeps its hover and click", async ({
    page,
  }) => {
    await openHome(page);
    await expect(page.locator(".map-canvas.is-plain")).toHaveCount(1);
    await expect(page.locator(".spot-marker.pending:not(.lt-dot)")).toHaveCount(
      0,
      { timeout: 30000 },
    );
    for (const light of await pills(page).all()) {
      await expect(light.locator(".lt-pill")).toBeVisible();
      await expect(light.locator(":scope > svg")).toBeHidden();
      // The wind in the rider's units, a whole number; an arrow downwind.
      await expect(light.locator(".lt-kn")).toHaveText(/^\d+$/);
      await expect(light.locator(".lt-pa g")).toHaveAttribute(
        "transform",
        /^rotate\(-?\d+\)$/,
      );
      // A pill, wider than it is tall, and 26 px tall at this zoom or 22 further out.
      const box = (await light.boundingBox())!;
      expect(box.width).toBeGreaterThan(box.height);
      expect([22, 26]).toContain(Math.round(box.height));
    }
    // A card under the pointer lights its pill; a click on the pill brings
    // its card into view.
    await cards(page).filter({ hasText: "Keel Beach" }).hover();
    await expect(page.locator('.spot-marker[data-spot-id="keel"]')).toHaveClass(
      /\blit\b/,
    );
    await page.mouse.move(5, 5);
    await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
    await page.waitForTimeout(400);
    await page.locator('.spot-marker[data-spot-id="brandon"]').click();
    await expect(
      cards(page).filter({ hasText: "Brandon Bay" }),
    ).toBeInViewport();
  });

  test("the stations and buoys are gold-edged tags at their last reading, and a card says whose, what and when", async ({
    page,
  }) => {
    await openHome(page);
    await expect(readings(page)).toHaveCount(STATIONS, { timeout: 30000 });
    // Mace Head: its last reading, in knots, the gust raised.
    const mace = OBS.stations.ME_03963.latest;
    const pill = reading(page, "ME_03963");
    await expect(pill.locator("b")).toHaveText(kn(mace.speed));
    await expect(pill.locator("sup")).toHaveText(kn(mace.gust));
    await expect(pill).toHaveAccessibleName(
      new RegExp(
        `^Mace Head, Met Éireann: ${kn(mace.speed)} knots, gusting ${kn(mace.gust)}, from .+, measured 22:00$`,
      ),
    );
    // A gold edge, stepped back from the spots, and squarer than their pills.
    const look = await pill.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        edge: cs.borderLeftColor,
        radius: parseFloat(cs.borderTopLeftRadius),
      };
    });
    expect(look.edge).toBe("rgb(233, 178, 0)");
    expect(look.radius).toBeLessThan(8);
    // The station with no gusts says none.
    await expect(reading(page, "ME_03966").locator("sup")).toBeHidden();
    // A buoy that stopped reporting five hours ago is faded, and says so.
    await expect(page.locator(".obs-mark.is-stale")).toHaveCount(1);
    await expect(reading(page, "MI_M6")).toHaveAccessibleName(
      /M6 Atlantic buoy, Marine Institute: .+, measured 17:00, over 3 hours ago$/,
    );

    // Under the pointer: the card, beside the pill.
    await expect(card(page)).toBeHidden();
    await pill.hover();
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".map-card-name")).toHaveText("Mace Head");
    await expect(card(page).locator(".map-card-net")).toHaveText(
      "Met Éireann · Weather station",
    );
    await expect(card(page).locator(".map-card-speed")).toHaveText(
      kn(mace.speed),
    );
    await expect(card(page).locator(".map-card-gust")).toHaveText(
      `g${kn(mace.gust)}`,
    );
    await expect(card(page).locator(".map-card-unit")).toHaveText("kn");
    await expect(card(page).locator(".map-card-from")).toHaveText(
      /^[NESW]{1,3}$/,
    );
    await expect(card(page).locator(".map-card-when")).toHaveText(
      "Measured 22:00",
    );
    await expect(card(page).locator(".map-card-credit")).toHaveText(
      "Contains Met Éireann data, CC BY 4.0",
    );
    await expect(pill).toHaveAttribute(
      "aria-describedby",
      (await card(page).getAttribute("id"))!,
    );
    const p = (await pill.boundingBox())!;
    const c = (await card(page).boundingBox())!;
    expect(Math.abs(c.x + c.width / 2 - (p.x + p.width / 2))).toBeLessThan(
      c.width / 2 + 1,
    );
    // Off the pill, the card goes.
    await page.mouse.move(5, 5);
    await expect(card(page)).toBeHidden();

    // A buoy's card credits the Marine Institute; the keys open it too.
    await reading(page, "MI_M2").focus();
    await expect(card(page).locator(".map-card-net")).toHaveText(
      "Marine Institute · Weather buoy",
    );
    await expect(card(page).locator(".map-card-credit")).toHaveText(
      "Weather buoy data © Marine Institute, CC BY 4.0",
    );
    await reading(page, "MI_M6").focus();
    await expect(card(page).locator(".map-card-name")).toHaveText(
      "M6 Atlantic buoy",
    );
    await expect(card(page).locator(".map-card-when")).toHaveText(
      "Measured 17:00, over 3 hours ago",
    );
    await page.keyboard.press("Escape");
    await expect(card(page)).toBeHidden();
  });
});

test("on the full chart the Live wind layer is a switch under Wind, off until asked for", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?map");
  await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
  await page.waitForTimeout(1000);
  await expect(readings(page)).toHaveCount(0);
  // The rings, not the pills, on the chart.
  await expect(page.locator(".map-canvas.is-plain")).toHaveCount(0);
  await expect(lights(page).first().locator(".lt-pill")).toBeHidden();
  await page
    .getByRole("group", { name: "Map controls" })
    .getByRole("button", { name: "Layers", exact: true })
    .click();
  const live = page
    .getByRole("toolbar", { name: "Layers", exact: true })
    .getByRole("group", { name: "Wind" })
    .getByRole("button", { name: "Live wind", exact: true });
  await expect(live).toHaveAttribute("aria-pressed", "false");
  await live.click();
  await expect(live).toHaveAttribute("aria-pressed", "true");
  await expect(readings(page)).toHaveCount(STATIONS, { timeout: 30000 });
  // And off again.
  await live.click();
  await expect(readings(page)).toHaveCount(0);
  // The rider's choice is kept.
  await live.click();
  await page.reload();
  await expect(readings(page)).toHaveCount(STATIONS, { timeout: 30000 });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a reading tapped opens its card, which a tap elsewhere shuts", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        "wingfoil.map.layers.v1",
        JSON.stringify({ live: true }),
      ),
    );
    await page.goto("/?map");
    await expect(readings(page)).toHaveCount(STATIONS, { timeout: 30000 });
    await page.waitForTimeout(1000);
    const pill = reading(page, "ME_03963");
    await pill.tap();
    await expect(card(page)).toBeVisible();
    await expect(card(page).locator(".map-card-name")).toHaveText("Mace Head");
    // Inside the screen.
    const c = (await card(page).boundingBox())!;
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(390);
    // The tap read no point's forecast.
    await expect(page.locator(".scrub .sb-name")).toHaveCount(0);
    // Out over the open sea, west of Mayo: nothing there to tap but the chart.
    await page.touchscreen.tap(20, 200);
    await expect(card(page)).toBeHidden();
  });
});

test("the map's credits name both networks while the readings are shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHome(page, ["brandon"]);
  await expect(readings(page)).toHaveCount(STATIONS, { timeout: 30000 });
  await openFromMenu(page, "About the map");
  const info = page.getByRole("dialog", { name: "About the map" });
  await info.getByRole("tab", { name: "Sources & credits" }).click();
  await expect(info.getByRole("tabpanel")).toContainText(
    /Live wind: measured at Met Éireann.s weather stations \(contains Met Éireann data, CC BY 4\.0\) and the Marine Institute.s weather buoys \(weather buoy data © Marine Institute, CC BY 4\.0\)/,
  );
  // And the wind's part says what the gold pills are.
  await info.getByRole("tab", { name: "Wind & gusts" }).click();
  await expect(info.getByRole("heading", { name: /^Live wind/ })).toBeVisible();
});
