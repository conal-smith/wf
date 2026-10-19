import { expect, rememberSpot, test, type Page } from "./fixtures";
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

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true });

test("a spot page is the week day by day: hours in figures, the tide and the light", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
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

  // The week: a column per Irish day the models reach, today first, each
  // named and never rated: no stars, no best window.
  const cards = page.locator("[data-day-card]");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-day-card] svg")).toHaveCount(0);
  await expect(cards.first()).not.toHaveAttribute("aria-label", /star/);

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
  // reader can read.
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
  // No "chance it rides" column: the hours' stars say when to go. The day's
  // heading names the day and rates nothing.
  await expect(tomorrow.locator("[data-chance]")).toHaveCount(0);
  await expect(page.locator("[data-day-best]")).toHaveCount(0);
  await expect(tomorrow.locator("header svg")).toHaveCount(0);
  await expect(tomorrow.locator("header")).not.toContainText(/best|no stars/);

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

  // A row is not a button: a tap on it opens nothing.
  const row = light.nth(2);
  await row.locator("td").last().click();
  await expect(row).not.toHaveAttribute("aria-expanded");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  // The frame opens the hour's wind, broken down: the headline (HARMONIE's own
  // while it reaches the hour, else the blend), the models one by one, where it
  // sits in the rider's range. No session, no advice.
  const frame = row.locator("[data-range-bar]");
  await frame.click();
  const card = page.locator("[data-range-detail]");
  await expect(card).toBeVisible();
  await expect(card.locator("dt").first()).toHaveText(/^(HARMONIE|Blend)$/i);
  await expect(card.locator("[data-range-text]")).toContainText("your");
  await expect(
    card.locator("[data-range-models] tbody tr").first(),
  ).toBeVisible();
  await expect(card).not.toContainText("rides like");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // The day is figures, not a verdict in words.
  await expect(page.locator("[data-pen-note]")).toHaveCount(0);

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
  await expect(page.getByText("not a safety statement")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the rider switch re-rates every hour, and is the map's rider too", async ({
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
  await expect(page.getByText("No riding place at this address")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("“brandon-bay”")).toBeVisible();
  await expect(page.locator('a[href="/spot/brandon"]')).toBeVisible();
  await page.goto("/spot");
  await expect(
    page.getByRole("heading", { level: 1, name: "Spot forecasts" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('a[href^="/spot/"]')).toHaveCount(148);
});

test("the map's dock opens the spot page, for the spot it opens on and one chosen", async ({
  page,
}) => {
  await rememberSpot(page, "brandon");
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  // The dock opens on Brandon Bay, chosen last, and links to its page.
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
  await expect(page.locator(".dock [data-spot-page-link]")).toHaveAttribute(
    "href",
    "/spot/brandon",
  );

  // A spot chosen on the map is the dock's, with no box over the chart.
  await page.getByRole("combobox", { name: "Find a spot" }).fill("Dollymount");
  await page.locator(".spot-row").first().click();
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const link = page.locator(".dock").getByRole("link", { name: "Spot page →" });
  await expect(link).toHaveAttribute("href", "/spot/dollymount");
  await link.click();
  await expect(page).toHaveURL(/\/spot\/dollymount$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Dollymount", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  // And back to the map, on the same place.
  await page.locator("[data-back-to-map]").click();
  await expect(page).toHaveURL(/\/\?spot=dollymount$/);
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount", {
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
  // A phone has no room for the frame: the wind figure opens its card.
  const phoneRow = page.locator("tr[data-daylight]").first();
  await expect(phoneRow.locator("[data-range-bar]")).toBeHidden();
  await phoneRow.getByRole("button", { name: /HARMONIE|blend/i }).click();
  await expect(page.locator("[data-range-detail]")).toBeVisible();
  await page.keyboard.press("Escape");

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
  // Offshore takes stars off as every other direction does.
  await expect(shore.locator("tr", { hasText: "150–180°" })).toContainText(
    "−4\u00a0stars",
  );
  await expect(page.locator("[data-gust-table]")).toContainText("28\u00a0kn");
  const ledger = page.locator("[data-ledger]");
  await expect(ledger).toContainText("is rated as");
  await expect(ledger).toContainText(/Rating.*, so \d solid/);
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

/** A published set of spot pictures (scripts/satellite/spots.py), Brandon's only. */
const pictures = {
  schemaVersion: 1,
  kind: "satellite-spots",
  base: "satellite/v0123456789ab/",
  zoom: 14.5,
  width: 1200,
  height: 600,
  attribution:
    "Contains modified Copernicus Sentinel data 2017–2026, composited for wingfoil.ie; tide levels from the Marine Institute (CC BY 4.0)",
  spots: [
    {
      id: "brandon",
      lonLat: [-10.024, 52.276],
      high: "brandon-high.webp",
      low: "brandon-low.webp",
    },
  ],
};
/** A 12 by 6 lossless WebP: the sea, in one colour. */
const WEBP = Buffer.from(
  "UklGRh4AAABXRUJQVlA4TBEAAAAvC0ABAAdQt6IUr/+BiOh/AAA=",
  "base64",
);

async function withPictures(page: Page, served = true) {
  await page.route("**/satellite/spots.json", (route) =>
    route.fulfill({ json: pictures }),
  );
  await page.route("**/satellite/v0123456789ab/*.webp", (route) =>
    served
      ? route.fulfill({ body: WEBP, contentType: "image/webp" })
      : route.fulfill({ status: 404 }),
  );
}

const picture = (page: Page) => page.locator("[data-spot-satellite]");

test("the place from above: framed under the header, at high or low tide, marked and credited", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withPictures(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });

  // Under the header's facts, before the rider and the week.
  await expect(picture(page)).toBeVisible();
  const order = await page
    .locator("[data-shore-summary], [data-spot-satellite], [data-rider-chip]")
    .evaluateAll((els) =>
      els.map((el) =>
        el.hasAttribute("data-spot-satellite")
          ? "picture"
          : el.hasAttribute("data-shore-summary")
            ? "header"
            : "rider",
      ),
    );
  expect(order.slice(0, 3)).toEqual(["header", "picture", "rider"]);

  const image = picture(page).getByRole("img", {
    name: /Brandon Bay from above/,
  });
  await expect(image).toHaveAttribute(
    "src",
    /\/satellite\/v0123456789ab\/brandon-high\.webp$/,
  );
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("alt", /high tide, north up/);
  // The place ringed where it is (the picture's centre), the scale in round metres.
  const frame = await picture(page).locator("img").boundingBox();
  const mark = await picture(page).locator("[data-place-mark]").boundingBox();
  expect(frame && mark).toBeTruthy();
  expect(
    Math.abs(mark!.x + mark!.width / 2 - (frame!.x + frame!.width / 2)),
  ).toBeLessThan(2);
  expect(
    Math.abs(mark!.y + mark!.height / 2 - (frame!.y + frame!.height / 2)),
  ).toBeLessThan(2);
  await expect(picture(page).locator("[data-scale]")).toHaveText(
    /^\d+(\.\d+)? k?m$/,
  );
  await expect(picture(page)).toContainText(
    "Contains modified Copernicus Sentinel data 2017–2026, composited for wingfoil.ie",
  );

  // Low tide: the other picture, the same frame.
  await picture(page).getByRole("button", { name: "Low tide" }).click();
  await expect(picture(page)).toHaveAttribute("data-tide", "low");
  await expect(picture(page).locator("img")).toHaveAttribute(
    "src",
    /brandon-low\.webp$/,
  );
  await expect(picture(page).locator("img")).toHaveAttribute("alt", /low tide/);

  // The whole credit is with the page's other sources.
  await expect(page.locator("[data-satellite-source]")).toContainText(
    "Copernicus Sentinel data",
  );
  expect(errors).toEqual([]);
});

test("no picture leaves no gap: none published, none of this place, or one that will not load", async ({
  page,
}) => {
  // No list published, as production before its first set: the site answers 404.
  await page.route("**/satellite/spots.json", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-rider-chip]")).toBeVisible();
  await expect(picture(page)).toHaveCount(0);
  await expect(page.locator("[data-satellite-source]")).toHaveCount(0);

  // A picture that is listed but not there takes its frame away with it.
  await page.unrouteAll();
  await withPictures(page, false);
  await page.reload();
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-rider-chip]")).toBeVisible();
  await expect(picture(page)).toHaveCount(0);
});

test("on a phone the picture is under the header and the week still on the first screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withPictures(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(picture(page)).toBeInViewport();
  await expect(page.locator("[data-day-card]").last()).toBeInViewport();
});
