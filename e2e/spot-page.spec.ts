import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * A riding place's own page, /spot/<id>, against the synthetic sample site.
 *
 * Every spec stands at SAMPLE_CLOCK (e2e/fixtures.ts): 21:00 UTC on 13 Sept
 * 2026, so the page opens on a night — today's rows are all dark — and the
 * daylight days follow. Tides are a fixture routed in, as in dock.spec.ts:
 * `public/marine` is git-ignored ingest output and never part of the e2e site.
 * So is an ensemble with its members (the sample site publishes none), for
 * the chance it rides.
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

/**
 * A four-member GEFS whose members sit at 3, 5, 6 and 8 m/s through the sample
 * days: steady, so the chance it rides is the same every hour and moves only
 * with the rider.
 */
const members = Array.from({ length: 24 }, (_, i) => ({
  hour: i * 6,
  validTime: new Date(clock - 12 * HOUR + i * 6 * HOUR)
    .toISOString()
    .replace(".000", ""),
  u: [0, 0, 0, 0],
  v: [-3, -5, -6, -8],
  gust: [null, 8, null, null],
}));
const gefs = {
  schemaVersion: 1,
  model: "gefs",
  modelName: "GEFS",
  runTime: members[0].validTime,
  gustAvailable: true,
  ensemble: { members: 4, control: 0, description: "e2e" },
  spotForecasts: {
    brandon: members.map((m) => ({
      hour: m.hour,
      validTime: m.validTime,
      u: 0,
      v: -5.5,
      gust: 7,
    })),
  },
  spotMembers: { brandon: members },
};

async function withEnsemble(page: Page) {
  await page.route("**/weather/gefs.json", (route) =>
    route.fulfill({ json: gefs }),
  );
}

/** Every rated cell's solid stars, in order: the page's rating, as a string. */
const ratings = (page: Page) =>
  page
    .locator("[data-stars]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-stars")).join(","),
    );

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: /^Brandon Bay:/ });

test("a spot page is the week day by day: hours in figures, the pen, the tide and the light", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await withEnsemble(page);
  await page.goto("/spot/brandon");

  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle(/Brandon Bay/);
  await expect(page.locator("[data-back-to-map]")).toHaveAttribute(
    "href",
    "/?spot=brandon",
  );
  await expect(page.locator("[data-shore-summary]")).toContainText(
    /Faces|rated on the wind alone/,
  );

  // The week: a column per Irish day the models reach, today first.
  const cards = page.locator("[data-day-card]");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first()).toHaveAttribute("aria-current", "true");

  // Today opens at night: its rows are folded away and none is rated.
  const today = page.locator("[data-day]").first();
  await expect(today.getByRole("heading", { level: 2 })).toContainText("Today");
  await expect(today.locator("tr[data-daylight]")).toHaveCount(0);
  const nightToggle = today.locator("[data-night-toggle]").first();
  await expect(nightToggle).toContainText("not rated");
  await expect(nightToggle).toHaveAttribute("aria-expanded", "false");
  await nightToggle.click();
  await expect(nightToggle).toHaveAttribute("aria-expanded", "true");
  expect(await today.locator("tr[data-hour]").count()).toBeGreaterThan(0);
  await expect(today.locator("[data-stars]")).toHaveCount(0);

  // Tomorrow is daylight, hour by hour, every row rated in stars a screen
  // reader can read, with the chance it rides from the ensemble's members.
  const tomorrow = page.locator("[data-day]").nth(1);
  await expect(tomorrow.getByRole("heading", { level: 2 })).toContainText(
    "Tomorrow",
  );
  const light = tomorrow.locator("tr[data-daylight]");
  expect(await light.count()).toBeGreaterThanOrEqual(8);
  await expect(tomorrow.locator("[data-stars]")).toHaveCount(
    await light.count(),
  );
  await expect(
    tomorrow.getByRole("img", { name: /of 5 stars/ }).first(),
  ).toBeAttached();
  // 15.6, 11.7 and (with its gust) 9.7 kn reach an intermediate's 10 kn.
  await expect(light.first().locator("[data-chance]")).toHaveText("75%");

  // The stars explain themselves: hovering them opens the chart's box with
  // the verdict, the reasons and who it is rated for; Escape closes it.
  const stars = light.first().locator("[data-stars] button");
  await stars.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Rated for Riding");
  await expect(tip.getByRole("link", { name: "How?" })).toHaveAttribute(
    "href",
    "/stars",
  );
  await expect(stars).toHaveAttribute("aria-describedby", /.+/);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);

  // A tap on the row opens its second line: the spread and the reasons.
  const row = light.nth(2);
  await row.locator("[data-chance]").click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const more = tomorrow.locator("[data-hour-detail]");
  await expect(more).toHaveCount(1);
  await expect(more.locator("[data-spread]")).toContainText("4 members");
  await expect(more.locator("[data-range-bar]")).toBeAttached();
  await row.press("Enter");
  await expect(more).toHaveCount(0);

  // The pen says each rated day's verdict.
  await expect(tomorrow.locator("[data-pen-note]")).toHaveText(
    /^(Go|Worth it|Thin:|Leave it on the roof)/,
  );

  // Choosing a day takes the page to it.
  await cards.nth(2).click();
  await expect(cards.nth(2)).toHaveAttribute("aria-current", "true");
  await expect(
    page.locator("[data-day]").nth(2).getByRole("heading", { level: 2 }),
  ).toBeInViewport();

  // Under each day, the tide over its 24 hours, night shaded, the present
  // marked on today alone, then the high and low waters and the light.
  const tide = tomorrow.locator("[data-tide-day]");
  await expect(tide.locator("[data-tide-curve]")).toHaveCount(1);
  await expect(tide.locator('[data-shade="night"]').first()).toBeAttached();
  await expect(tide.locator("[data-now-marker]")).toHaveCount(0);
  await expect(today.locator("[data-tide-day] [data-now-marker]")).toHaveCount(
    1,
  );
  await expect(tide.locator("[data-sun-table]")).toContainText("Sunrise");
  await expect(tide.locator("[data-sun-table]")).toContainText("Last light");
  const turns = tide.locator("[data-tide-table] tr");
  expect(await turns.count()).toBeGreaterThan(0);
  expect(await turns.count()).toBe(
    await turns.filter({ hasText: /^(High|Low) tide\d\d:\d\d/ }).count(),
  );

  // Sources, the way to how the stars work, and the line every forecast
  // here ends on.
  await expect(page.locator("[data-sources]")).toContainText("HARMONIE");
  await expect(page.locator("[data-sources]")).toContainText("GEFS members");
  await expect(page.getByText("not a safety statement")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the rider switch re-rates every hour and its chance, and is the map's rider too", async ({
  page,
}) => {
  await withEnsemble(page);
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
  const chance = page.locator("tr[data-daylight] [data-chance]").first();
  await expect(chance).toHaveText("75%");

  const riding = await ratings(page);
  await level.getByRole("button", { name: "Learning" }).click();
  await expect.poll(() => ratings(page)).not.toBe(riding);
  // A learner's floor is 12 kn: only the 15.6 kn member reaches it.
  await expect(chance).toHaveText("25%");
  const learning = await ratings(page);
  await level.getByRole("button", { name: "Advanced" }).click();
  await expect.poll(() => ratings(page)).not.toBe(learning);

  // The weight and wings fold behind the one line until asked for. A heavier
  // rider needs more wind: the stars move again, and the estimate mark goes.
  const advanced = await ratings(page);
  await expect(page.locator('[data-rider="weight"]')).toHaveCount(0);
  await page.locator("[data-rider-chip]").click();
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

test("a star keeps the place where the map keeps it, and opening it counts", async ({
  page,
}) => {
  await page.goto("/spot/brandon");
  const star = page.locator("[data-keep-star]");
  await expect(star).toHaveAttribute("aria-pressed", "false", {
    timeout: 30000,
  });
  await expect(star).toHaveAccessibleName("Star Brandon Bay");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wingfoil.spots.v1") ?? "{}"),
  );
  expect(stored.starred).toEqual(["brandon"]);
  expect(stored.visits.brandon.count).toBe(1);
  await page.reload();
  await expect(page.locator("[data-keep-star]")).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 30000 },
  );
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
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  // And back to the map, on the same place.
  await page.locator("[data-back-to-map]").click();
  await expect(page).toHaveURL(/\/\?spot=brandon$/);
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay", {
    timeout: 30000,
  });
});

test("on a phone the week and the first day are on the first screen, and far days draw as they come", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-rider-chip]")).toContainText("~80 kg");
  await expect(page.locator('[data-rider="weight"]')).toHaveCount(0);
  await expect(page.locator("[data-day-card]").last()).toBeInViewport();
  await expect(
    page.locator("[data-day]").first().getByRole("heading", { level: 2 }),
  ).toBeInViewport();
  // The columns a phone has no room for are in the second line instead.
  await expect(
    page.locator("tr[data-daylight] [data-range-bar]").first(),
  ).toBeHidden();

  // The last day keeps a space and draws its rows only once it comes near.
  const last = page.locator("[data-day]").last();
  await expect(last.locator("tr[data-hour]")).toHaveCount(0);
  await last.scrollIntoViewIfNeeded();
  await expect
    .poll(() => last.locator("tr[data-hour], [data-night-toggle]").count())
    .toBeGreaterThan(0);

  // The day's header sticks while its hours pass under it.
  const second = page.locator("[data-day]").nth(1);
  await second.evaluate((el) =>
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + 300),
  );
  const top = await second
    .locator("header")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(top)).toBeLessThan(2);
});

test("How the stars work draws the bands, the shore sectors and a live hour worked through", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/stars?spot=brandon");
  await expect(
    page.getByRole("heading", { level: 1, name: "How the stars work" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle(/How the stars work/);
  await expect(page.locator("[data-back-to-map]")).toHaveAttribute(
    "href",
    "/?spot=brandon",
  );
  await expect(page.locator("[data-band-table]")).toContainText("14–24");
  await expect(page.locator("[data-sectors]")).toBeVisible();
  const shore = page.locator("[data-shore-table]");
  for (const range of ["0–30°", "30–70°", "70–110°", "110–150°", "150–180°"])
    await expect(shore).toContainText(range);
  await expect(shore).toContainText("at most 1★");
  const ledger = page.locator("[data-ledger]");
  await expect(ledger).toContainText("Rides like");
  await expect(ledger).toContainText(/Left.*→ \d★ solid/);
  // The rider is the page's: a learner's sweet spot is marked as theirs.
  await page
    .getByRole("group", { name: "Riding level" })
    .getByRole("button", { name: "Learning" })
    .click();
  await expect(
    page.locator("[data-band-table] tr", { hasText: "Learning" }),
  ).toContainText("you");
  expect(errors).toEqual([]);
});
