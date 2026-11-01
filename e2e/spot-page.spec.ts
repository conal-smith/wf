import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * A riding place's own page, /spot/<id>, against the synthetic sample site:
 * the spot report the approved mock-up drew.
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
    .locator("[data-hour-table] [data-stars]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-stars")).join(","),
    );

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true });

test("a spot page is a spot report: the name, now, the week, one graph, and the spot", async ({
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
  // Now: the wind, the stars, the tide or the launch, the sea, the light.
  const now = page.locator("[data-now]");
  await expect(now).toContainText("Wind now");
  await expect(now).toContainText("Your stars");
  await expect(now).toContainText("Sea");
  await expect(now).toContainText(/Light left/);
  // The week, a card a day, and the graph on one clock with its readout.
  const days = page.locator("[data-day-card]");
  await expect.poll(() => days.count()).toBeGreaterThan(2);
  expect(await days.count()).toBeLessThanOrEqual(7);
  await expect(page.locator("[data-graph-svg]")).toBeVisible();
  await expect(page.locator("[data-readout]")).toContainText("Now");
  // The spot's own notes, and the small print.
  await expect(page.getByRole("heading", { name: "The spot" })).toBeVisible();
  await expect(page.getByText(/not a safety statement/)).toBeVisible();
  // Two faces: Fraunces for the name, Inter for the rest.
  const faces = await page.evaluate(() => ({
    name: getComputedStyle(document.querySelector("h1")!).fontFamily,
    body: getComputedStyle(document.querySelector("[data-now]")!).fontFamily,
  }));
  expect(faces.name).toMatch(/Fraunces/);
  expect(faces.body).toMatch(/Inter/);
  expect(errors).toEqual([]);
});

test("hovering the graph reads out that hour; a day card moves to its day", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-graph-svg]")).toBeVisible();
  // The graph's window, not its whole width: it scrolls along the week.
  await page.locator("[data-spot-graph]").scrollIntoViewIfNeeded();
  const box = (await page.locator("[data-spot-graph]").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + 80);
  await expect(page.locator("[data-readout]")).not.toContainText("Now");
  await page.mouse.move(box.x + box.width + 50, box.y - 50);
  await expect(page.locator("[data-readout]")).toContainText("Now");
  const second = page.locator("[data-day-card]").nth(1);
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
});

test("Table shows the day's hours with their stars, wind, sea and launch", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await page.locator("[data-day-card]").nth(1).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.locator("[data-hour-table]");
  await expect(table).toBeVisible();
  await expect.poll(() => table.locator("tbody tr").count()).toBeGreaterThan(3);
  await expect(table.locator("thead")).toContainText("Wind kn");
  await expect(table.locator("[data-stars]").first()).toBeAttached();
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.locator("[data-graph-svg]")).toBeVisible();
});

test("the rider's own stars, from Settings, re-rate every hour", async ({
  page,
}) => {
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await page.locator("[data-day-card]").nth(1).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.locator("[data-hour-table] [data-stars]").first(),
  ).toBeAttached();
  const ours = await ratings(page);
  // As Settings stores them: a rider who wants more wind, and never rides
  // cross-offshore.
  await page.evaluate(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({
        version: 3,
        rider: {
          weightKg: null,
          wings: [],
          custom: {
            version: 3,
            wind: { min: 16, sweetLow: 20, sweetHigh: 28, max: 38 },
            direction: {
              onshore: 0,
              crossOn: 0,
              cross: 0,
              crossOff: 5,
              offshore: 5,
            },
          },
        },
      }),
    ),
  );
  await page.reload();
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await page.locator("[data-day-card]").nth(1).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.locator("[data-hour-table] [data-stars]").first(),
  ).toBeAttached();
  await expect.poll(() => ratings(page)).not.toBe(ours);
});

test("the place from above carries the chart's loupe, at high or low tide, credited", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withPictures(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const loupe = page.locator("[data-photo-loupe]");
  await expect(loupe).toBeVisible();
  const shown = loupe.locator("img.opacity-100");
  await expect(shown).toHaveAttribute("src", /brandon-(high|low)\.webp$/);
  await expect(loupe.locator("[data-loupe-foot]")).toBeVisible();
  await loupe.getByRole("button", { name: "Low tide" }).click();
  await expect(loupe).toHaveAttribute("data-tide", "low");
  await expect(shown).toHaveAttribute("src", /brandon-low\.webp$/);
  await loupe.getByRole("button", { name: "High tide" }).click();
  await expect(loupe).toHaveAttribute("data-tide", "high");
  await expect(page.getByText(/Copernicus Sentinel data/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("no picture leaves no gap: the cards take the room", async ({ page }) => {
  await page.route("**/satellite/spots.json", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-now]")).toBeVisible();
  await expect(page.locator("[data-photo-loupe]")).toHaveCount(0);
});

test("on a phone the name, now and the picture come first, and the week scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withPictures(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-now]")).toBeInViewport();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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
  // Answered 404, as any address with nothing behind it is, so a crawler or
  // a link checker does not keep it; the page is the app all the same.
  const missing = await page.goto("/spot/brandon-bay");
  expect(missing?.status()).toBe(404);
  await expect(page.getByText("No riding place at this address")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("“brandon-bay”")).toBeVisible();
  await expect(page.locator('a[href="/spot/brandon"]')).toBeVisible();
  expect((await page.request.get("/spot/nonexistent-spot")).status()).toBe(404);
  expect((await page.request.get("/spot/brandon")).status()).toBe(200);
  const index = await page.goto("/spot");
  expect(index?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Spot forecasts" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('a[href^="/spot/"]')).toHaveCount(149);
});

test("a map link to a spot that does not exist says so", async ({ page }) => {
  await page.goto("/?spot=does-not-exist");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  const status = page.locator(".frame-status");
  await expect(status).toContainText("Spot not found: “does-not-exist”.");
  await expect(page.locator(".dock .dk-name")).toHaveCount(0);
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toHaveCount(0);
});

test("the map's dock opens the spot page, for the spot it opens on and one chosen", async ({
  page,
}) => {
  await page.goto("/?spot=brandon");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
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
  const link = page.locator(".dock").getByRole("link", { name: "Spot page" });
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

test("How the stars work draws the four numbers, the gusts, the shore sectors and a live hour worked through", async ({
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
  // Ours, the only stars there are until the rider makes their own.
  const band = page.locator('[data-band-table] [data-band="ours"]');
  await expect(band).toContainText("11");
  await expect(band).toContainText("15–22");
  await expect(band).toContainText("35");
  await expect(band).toContainText("you");
  await expect(page.locator('[data-band="own"]')).toHaveCount(0);
  await expect(page.locator("[data-score-chart]")).toBeVisible();
  // The hours the stars were agreed on, worked out live: solid, and
  // outlined for what the gusts took.
  const agreed: [string, number, number][] = [
    ["15 kn gusting 25", 5, 5],
    ["20 kn gusting 25", 5, 5],
    ["20 kn gusting 30", 4, 5],
    ["25 kn gusting 30", 4, 4],
    ["30 kn, steady", 1, 1],
    ["22 kn gusting 35", 1, 5],
    ["32 kn or more, steady", 0, 0],
    ["10 kn, steady", 0, 0],
  ];
  const gusts = page.locator("[data-gust-table]");
  for (const [what, stars, potential] of agreed) {
    const cell = gusts
      .locator("tr", { hasText: what })
      .locator('[data-rated="ours"]');
    await expect(cell, what).toHaveAttribute(
      "data-example-stars",
      String(stars),
    );
    await expect(cell, what).toHaveAttribute(
      "data-example-potential",
      String(potential),
    );
  }
  await expect(page.locator("[data-sectors]")).toBeVisible();
  const shore = page.locator("[data-shore-table]");
  for (const range of ["0–30°", "30–70°", "70–110°", "110–150°", "150–180°"])
    await expect(shore).toContainText(range);
  // Cross-offshore costs a star; offshore is never.
  await expect(shore.locator("tr", { hasText: "110–150°" })).toContainText(
    "−1\u00a0star",
  );
  await expect(shore.locator("tr", { hasText: "150–180°" })).toContainText(
    "never",
  );
  await expect(shore.locator("tr", { hasText: "0–30°" })).toContainText("none");
  // No levels, no gusty-wind setting, no wing that costs a star.
  await expect(page.locator("main")).not.toContainText(
    /Learning|Advanced|very gusty|loses a star/,
  );
  await expect(page.locator("[data-other-table]")).toContainText(
    "Your weight, or your wings",
  );
  await expect(
    page.locator("main [data-settings-link]").first(),
  ).toHaveAttribute("href", "/?settings");
  const ledger = page.locator("[data-ledger]");
  await expect(ledger).toContainText("Steady wind");
  await expect(ledger).toContainText(/Rating(no stars|\d solid)/);
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
