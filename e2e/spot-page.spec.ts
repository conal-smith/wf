import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * A riding place's own page, /spot/<id>, against the synthetic sample site.
 *
 * Every spec stands at SAMPLE_CLOCK (e2e/fixtures.ts): 21:00 UTC on 13 Sept
 * 2026, so the page opens on a night — today's rows are all dark — and the
 * daylight days follow. Tides are a fixture routed in, as in dock.spec.ts:
 * `public/marine` is git-ignored ingest output and never part of the e2e site.
 */

const HOUR = 3600000;
const clock = SAMPLE_CLOCK.getTime();
/** Semi-diurnal turns either side of the clock, for five days. */
const events = Array.from({ length: 20 }, (_, i) => ({
  time: new Date(clock - 14 * HOUR + i * 6.21 * HOUR).toISOString(),
  kind: i % 2 ? "low" : "high",
  height: i % 2 ? 0.8 : 4.1,
}));
const tideManifest = {
  schemaVersion: 1,
  kind: "tide",
  stations: {
    Fenit: {
      name: "Fenit",
      lat: 52.27,
      lon: -9.87,
      url: "marine/tides-Fenit-spot.json",
    },
  },
  spots: { brandon: { station: "Fenit", distanceKm: 10.9 } },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};
const tideCurve = {
  stepMinutes: 30,
  from: events[0].time,
  to: events.at(-1)!.time,
  datum: "LAT",
  curve: [2.2, 2.3],
  events,
};

async function withTides(page: Page) {
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-Fenit-spot.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
}

/** Every rated cell's solid stars, in order: the page's rating, as a string. */
const ratings = (page: Page) =>
  page
    .locator("[data-stars]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-stars")).join(","),
    );

test("a spot page has its week, its hours with stars, and its tide and daylight", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await page.goto("/spot/brandon");

  await expect(
    page.getByRole("heading", { level: 1, name: "Brandon Bay" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle(/Brandon Bay/);
  await expect(page.locator("[data-back-to-map]")).toHaveAttribute(
    "href",
    "/?spot=brandon",
  );
  await expect(page.locator("[data-shore-summary]")).toContainText(
    /Faces|rated on the wind alone/,
  );

  // The week: a card per Irish day the models reach, today first.
  const cards = page.locator("[data-day-card]");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first()).toContainText("Today");
  await expect(cards.first()).toHaveAttribute("aria-current", "true");

  // Today opens at night: its rows are folded away and none is rated.
  const today = page.locator("[data-day]").first();
  await expect(today.locator("tr[data-daylight]")).toHaveCount(0);
  const nightToggle = today.locator("[data-night-toggle]").first();
  await expect(nightToggle).toContainText("not rated");
  await expect(nightToggle).toHaveAttribute("aria-expanded", "false");
  await nightToggle.click();
  await expect(nightToggle).toHaveAttribute("aria-expanded", "true");
  expect(await today.locator("tr[data-hour]").count()).toBeGreaterThan(0);
  await expect(today.locator("[data-stars]")).toHaveCount(0);

  // Tomorrow is daylight, hour by hour, every row rated in stars a screen
  // reader can read.
  const tomorrow = page.locator("[data-day]").nth(1);
  await expect(tomorrow.locator("h3")).toContainText("Tomorrow");
  const light = tomorrow.locator("tr[data-daylight]");
  expect(await light.count()).toBeGreaterThanOrEqual(8);
  await expect(tomorrow.locator("[data-stars]")).toHaveCount(
    await light.count(),
  );
  await expect(
    tomorrow.getByRole("img", { name: /of 5 stars|No stars/ }).first(),
  ).toBeVisible();
  // The stars explain themselves: hovering them opens a card with the
  // verdict, the reasons and who it is rated for; Escape closes it.
  const stars = light.first().locator("[data-stars] button");
  await stars.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/of 5 stars|No stars|No wind reading/);
  await expect(tip).toContainText("Rated for");
  await expect(stars).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  // Choosing a day card takes the page to it.
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(tomorrow).toBeInViewport();

  // Tide and daylight: a curve from the turns, night shaded, the present
  // marked, and the turns and the sun as tables.
  const tide = page.locator("#tide-and-daylight");
  await expect(tide.getByRole("heading", { level: 2 })).toHaveText(
    "Tide and daylight for Brandon Bay",
  );
  await expect(tide).toContainText("Predicted at Fenit, 10.9 km away");
  await expect(tide.locator("[data-tide-curve]")).toHaveCount(1);
  await expect(tide.locator('[data-shade="night"]').first()).toBeAttached();
  await expect(tide.locator("[data-sun-table]")).toContainText("Sunrise");
  await expect(tide.locator("[data-sun-table]")).toContainText("Last light");
  // The day card chose tomorrow, and the tide follows it: no Now line there.
  await expect(tide.locator("[data-now-marker]")).toHaveCount(0);
  expect(await tide.locator("[data-tide-table] tbody tr").count()).toBe(
    await tide
      .locator("[data-tide-table] tbody tr")
      .filter({ hasText: /High|Low/ })
      .count(),
  );
  await tide
    .getByRole("button", { name: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/ })
    .first()
    .click();
  await expect(tide.locator("[data-now-marker]")).toHaveCount(1);

  // Sources and the line every forecast here ends on.
  await expect(page.locator("[data-sources]")).toContainText("HARMONIE");
  await expect(page.getByText("not a safety statement")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the rider switch re-rates every hour and is the map's rider too", async ({
  page,
}) => {
  await page.goto("/spot/brandon");
  await expect(page.locator("[data-stars]").first()).toBeAttached({
    timeout: 30000,
  });
  const summary = page.locator("[data-rider-summary]");
  await expect(summary).toHaveText("~80 kg");
  const level = page.getByRole("group", { name: "Riding level" });
  await expect(level.getByRole("button", { name: "Riding" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const riding = await ratings(page);
  await level.getByRole("button", { name: "Learning" }).click();
  await expect.poll(() => ratings(page)).not.toBe(riding);
  const learning = await ratings(page);
  await level.getByRole("button", { name: "Advanced" }).click();
  await expect.poll(() => ratings(page)).not.toBe(learning);

  // A heavier rider needs more wind: the stars move again, and the estimate
  // mark goes.
  const advanced = await ratings(page);
  await page.locator('[data-rider="weight"]').fill("110");
  await expect(summary).toHaveText("110 kg");
  await expect.poll(() => ratings(page)).not.toBe(advanced);

  // Saved where the map's Display options keep the rider.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("force5.prefs.v1") ?? "{}"),
  );
  expect(stored.rider).toEqual({
    weightKg: 110,
    skill: "advanced",
    wings: [],
  });
  await page.reload();
  await expect(page.locator("[data-rider-summary]")).toHaveText("110 kg", {
    timeout: 30000,
  });
});

test("an unknown spot says so and offers what it may have meant", async ({
  page,
}) => {
  await page.goto("/spot/brandon-bay");
  await expect(
    page.getByText("No riding place called “brandon-bay”"),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('a[href="/spot/brandon"]')).toBeVisible();
  await page.goto("/spot");
  await expect(
    page.getByRole("heading", { level: 1, name: "Spot forecasts" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('a[href^="/spot/"]')).toHaveCount(146);
});

test("the map's spot popup and dock both open the spot page", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  // The dock opens on Brandon Bay, and links to its page.
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
  await expect(
    page.locator(".dock [data-spot-page-link]"),
  ).toHaveAttribute("href", "/spot/brandon");

  await page.getByRole("combobox", { name: "Find a spot" }).fill("Brandon");
  await page.locator(".spot-row").first().click();
  const popup = page.getByRole("dialog", { name: /Brandon Bay at a glance/ });
  await expect(popup).toBeVisible();
  const link = popup.getByRole("link", { name: "Spot page →" });
  await expect(link).toHaveAttribute("href", "/spot/brandon");
  await link.click();
  await expect(page).toHaveURL(/\/spot\/brandon$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Brandon Bay" }),
  ).toBeVisible({ timeout: 30000 });
  // And back to the map, on the same place.
  await page.locator("[data-back-to-map]").click();
  await expect(page).toHaveURL(/\/\?spot=brandon$/);
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay", {
    timeout: 30000,
  });
});

test("on a phone the rider folds into one line, so the week is on the first screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/spot/brandon");
  const chip = page.locator("[data-rider-chip]");
  await expect(chip).toBeVisible({ timeout: 30000 });
  await expect(chip).toContainText("Rated for Riding · ~80 kg");
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  // Folded: the controls are not drawn at all, and the week is in view.
  await expect(page.locator('[data-rider="weight"]')).toHaveCount(0);
  await expect(page.locator("[data-day-card]").first()).toBeInViewport();

  // Change opens the same controls in place, and they re-rate the page.
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  const level = page.getByRole("group", { name: "Riding level" });
  await expect(level).toBeVisible();
  const riding = await ratings(page);
  await level.getByRole("button", { name: "Learning" }).click();
  await expect(chip).toContainText("Rated for Learning · ~80 kg");
  await expect.poll(() => ratings(page)).not.toBe(riding);
  await page.locator('[data-rider="weight"]').fill("95");
  await expect(chip).toContainText("Rated for Learning · 95 kg");
  await chip.click();
  await expect(page.locator('[data-rider="weight"]')).toHaveCount(0);

  // The desktop keeps the controls in the side panel, with no fold.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("[data-rider-chip]")).toHaveCount(0);
  await expect(page.locator('[data-rider="weight"]')).toHaveValue("95");
});
