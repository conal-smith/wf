import {
  barName,
  expect,
  openFromMenu,
  saveSettings,
  scrubBar,
  test,
  timeSlider,
  type Page,
} from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip } from "./columns";

/**
 * A riding place's own page, /spot/<id>, against the synthetic sample site:
 * the spot report the approved mock-up drew.
 *
 * Every spec stands at SAMPLE_CLOCK (e2e/fixtures.ts): 21:00 UTC on 13 Sept
 * 2026, so the page opens on a night — today's rows are all dark — and the
 * daylight days follow. Tides are a fixture routed in: `public/marine` is
 * git-ignored ingest output and never part of the e2e site.
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
  await expect(
    page.locator(`[data-top-bar] [data-view-switch="chart"]`),
  ).toHaveAttribute("href", "/?spot=brandon");
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

test("a wheel or a trackpad over the graph reads out the hour that comes under the pointer", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const graph = page.locator("[data-spot-graph]");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  const chip = page.locator("[data-readout] > div").first();
  const x = box.x + box.width * 0.5;
  const y = box.y + 80;
  await page.mouse.move(x, y);
  await expect(chip).not.toHaveText("Now");
  const pointed = await chip.textContent();
  // The hours scroll along under a pointer that stays put.
  const left = await graph.evaluate((el) => el.scrollLeft);
  await page.mouse.wheel(box.width / 3, 0);
  await expect
    .poll(() => graph.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(left + 50);
  await expect(chip).not.toHaveText(pointed ?? "");
  // The hour read out is the one now under the pointer, as a move there says.
  await expect
    .poll(async () => {
      const scrolled = await graph.evaluate((el) => el.scrollLeft);
      await page.waitForTimeout(100);
      return scrolled === (await graph.evaluate((el) => el.scrollLeft));
    })
    .toBe(true);
  const scrolled = await chip.textContent();
  await page.mouse.move(x + 1, y);
  await page.mouse.move(x, y);
  await expect(chip).toHaveText(scrolled ?? "");
});

/**
 * Where every cell of the readout stands, with the pill itself, the graph's
 * top and the key under it, in the page's own pixels.
 */
const readoutLayout = (page: Page) =>
  page.evaluate(() => {
    const at = (el: Element | null) => {
      const r = el!.getBoundingClientRect();
      return [r.x, r.y + scrollY, r.width, r.height].map(Math.round).join(",");
    };
    const readout = document.querySelector("[data-readout]")!;
    return {
      cells: [...readout.children].map(at),
      pill: at(readout.querySelector("span")),
      graph: at(document.querySelector("[data-spot-graph]")),
      key: at(document.querySelector("[data-legend]")),
    };
  });

for (const width of [1500, 1100, 390])
  test(`the readout holds still as the hours change, dark or rated, at ${width}px`, async ({
    page,
  }) => {
    await withTides(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    const graph = page.locator("[data-spot-graph]");
    const readout = page.locator("[data-readout]");
    await expect(page.locator("[data-graph-svg]")).toBeVisible();
    // The readout and the top of the graph in view, so nothing scrolls the
    // page while the hours are moved through.
    await readout.evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top - 60),
    );
    // The sample opens at night: the readout is now, and dark.
    await expect(readout).toContainText("Now");
    await expect(readout).toContainText("Dark");
    const still = await readoutLayout(page);
    const box = (await graph.boundingBox())!;
    const seen = { rated: false, dark: false, hour: false };
    const steps = 24;
    for (let i = 1; i < steps; i++) {
      if (width < 600)
        await graph.evaluate(
          (el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f),
          i / steps,
        );
      else await page.mouse.move(box.x + (box.width * i) / steps, box.y + 60);
      await page.waitForTimeout(60);
      const text = (await readout.textContent()) ?? "";
      if (!text.startsWith("Now")) seen.hour = true;
      if (/Dark/.test(text)) seen.dark = true;
      if (await readout.locator("[data-stars]").count()) seen.rated = true;
      expect(await readoutLayout(page), `at "${text}"`).toEqual(still);
    }
    // The hours moved through were dark and rated both.
    expect(seen).toEqual({ rated: true, dark: true, hour: true });
  });

for (const width of [1440, 390])
  test(`the hours after dark can be left out of the week, the days side by side, at ${width}px`, async ({
    page,
  }) => {
    await withTides(page);
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    const svg = page.locator("[data-graph-svg]");
    const readout = page.locator("[data-readout]");
    const legend = page.locator("[data-legend]");
    await expect(svg).toBeVisible();
    // Round the clock by default: the night shaded, and now, at 22:00 on the
    // Sunday, read out as dark.
    await expect(svg.locator("[data-night]").first()).toBeAttached();
    await expect(readout).toContainText("Now");
    await expect(readout).toContainText("Dark");
    await expect(legend).toContainText("Dark");

    await openFromMenu(page, "Settings");
    const hours = page.getByRole("group", { name: "Hours", exact: true });
    await expect(
      hours.getByRole("button", { name: "Day and night" }),
    ).toHaveAttribute("aria-pressed", "true");
    await hours.getByRole("button", { name: "Daylight only" }).click();
    await saveSettings(page);

    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    await expect(svg).toBeVisible();
    // No night: nothing shaded, no key for it, and the days joined by their
    // lines alone.
    await expect(svg.locator("[data-night]")).toHaveCount(0);
    await expect(legend).not.toContainText("Dark");
    await expect(svg.locator("[data-day-line]").first()).toBeAttached();
    // Now is after dark: the readout is Monday's first light instead.
    await expect(readout).not.toContainText("Now");
    await expect(readout).toContainText(/Mon \d{2}:\d{2}/);
    await expect(readout).not.toContainText("Dark");
    // None of the small hours along the foot.
    const ticks = await svg
      .locator("text")
      .evaluateAll((texts) => texts.map((t) => t.textContent ?? ""));
    for (const small of ["00", "03", "21"]) expect(ticks).not.toContain(small);
    // And the readout never lands in the night, however far the hours go.
    const graph = page.locator("[data-spot-graph]");
    await readout.evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top - 60),
    );
    const box = (await graph.boundingBox())!;
    const phone = box.width < 600;
    for (let i = 1; i < 16; i++) {
      if (phone)
        await graph.evaluate(
          (el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f),
          i / 16,
        );
      else await page.mouse.move(box.x + (box.width * i) / 16, box.y + 60);
      await page.waitForTimeout(40);
      expect(await readout.textContent()).not.toMatch(/Dark/);
      const hour = Number(
        (await readout.textContent())?.match(/ (\d{2}):\d{2}/)?.[1] ?? 12,
      );
      expect(hour).toBeGreaterThanOrEqual(5);
      expect(hour).toBeLessThanOrEqual(21);
    }
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
  await expect(barName(page)).toHaveCount(0);
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toHaveCount(0);
});

/** The hour the scrub bar is on, as the spot page's link opens it. */
async function atHour(page: Page) {
  const at = Number(await timeSlider(page).inputValue());
  return encodeURIComponent(sampleStrip[at].validTime);
}

test("the scrub bar opens the spot page at its hour, for the spot it opens on and one chosen", async ({
  page,
}) => {
  await page.goto("/?spot=brandon");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  // The scrub bar opens on Brandon Bay, from the link, and its Full forecast
  // (for the keys: on the screen, the spot's name on the map) is the spot's
  // page at the hour in hand.
  await expect(barName(page)).toHaveText("Brandon Bay");
  const link = scrubBar(page).locator("[data-spot-page-link]");
  await expect(link).toHaveAccessibleName("Full forecast");
  await expect(link).toHaveAttribute(
    "href",
    `/spot/brandon?at=${await atHour(page)}`,
  );
  // It follows the hour.
  await timeSlider(page).fill("20");
  await expect(link).toHaveAttribute(
    "href",
    `/spot/brandon?at=${encodeURIComponent(sampleStrip[20].validTime)}`,
  );

  // A spot chosen on the map is the scrub bar's, with no box over the chart.
  const opener = page.locator("[data-spot-search-open]");
  if (await opener.isVisible()) await opener.click();
  await page.getByRole("combobox", { name: "Search spots" }).fill("Dollymount");
  await page.locator("[data-spot-option]").first().click();
  await expect(barName(page)).toHaveText("Dollymount");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const full = scrubBar(page).getByRole("link", {
    name: "Full forecast",
    exact: true,
  });
  await expect(full).toHaveAttribute(
    "href",
    `/spot/dollymount?at=${await atHour(page)}`,
  );
  // Out of sight until the keys reach it.
  await full.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/spot\/dollymount\?at=/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Dollymount", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  // And back to the map, on the same place.
  await page.locator(`[data-top-bar] [data-view-switch="chart"]`).click();
  await expect(page).toHaveURL(/\/\?spot=dollymount$/);
  await expect(barName(page)).toHaveText("Dollymount", {
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
  await expect(
    page.locator(`[data-top-bar] [data-view-switch="chart"]`),
  ).toHaveAttribute("href", "/?spot=brandon");
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

/*
 * Under the week graph, the rows the chart's dock used to draw: every model's
 * own wind, the gust factor, the waves' period and direction, the current
 * and the rain, on the graph's hours. The sample's wind runs (harmonie,
 * ecmwf and the rest), its hourly ICON-EU rain, its 72 hours of currents and
 * its short GFS-Wave run on 16 September all reach Brandon.
 */
test("under the week graph: the models, the gusts, the waves, the current and the rain", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const graph = page.locator("[data-graph-svg]");
  await expect(graph).toBeVisible();

  // Models: a line of its own for each model the rider blends, named below.
  const lines = graph.locator('[data-band="models"] path[data-model]');
  await expect.poll(() => lines.count()).toBeGreaterThanOrEqual(2);
  for (const d of await lines.evaluateAll((paths) =>
    paths.map((path) => path.getAttribute("d") ?? ""),
  ))
    expect(d).toMatch(/^M[\d.]+,[\d.]+C/);
  // On the tens either side of the models' winds, so the lines fill the
  // band between its first dotted line and its last.
  const fill = await graph.locator('[data-band="models"]').evaluate((band) => {
    const ys = [...band.querySelectorAll("line")].map((line) =>
      Number(line.getAttribute("y1")),
    );
    const boxes = [...band.querySelectorAll("path[data-model]")].map((path) =>
      (path as SVGGraphicsElement).getBBox(),
    );
    return {
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      high: Math.min(...boxes.map((box) => box.y)),
      low: Math.max(...boxes.map((box) => box.y + box.height)),
    };
  });
  expect(fill.high).toBeGreaterThanOrEqual(fill.top - 2);
  expect(fill.low).toBeLessThanOrEqual(fill.bottom + 2);
  expect(fill.low - fill.high).toBeGreaterThan((fill.bottom - fill.top) / 3);
  const legend = page.locator("[data-models-legend]");
  await expect(legend).toContainText("HARMONIE");
  await expect(legend).toContainText("ECMWF");

  // Gusts: the factor, to a tenth, as the dock wrote it.
  const factors = await graph
    .locator("[data-gust-factor]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-gust-factor")!),
    );
  expect(factors.length).toBeGreaterThan(5);
  for (const factor of factors) {
    expect(factor).toMatch(/^\d\.\d×$/);
    expect(parseFloat(factor)).toBeGreaterThanOrEqual(1);
    // The sample's gusts are synthetic, and gustier than any real day.
    expect(parseFloat(factor)).toBeLessThan(10);
  }

  // Waves: a period in seconds, under an arrow that says where they run.
  const periods = await graph
    .locator("[data-wave-period]")
    .evaluateAll((cells) =>
      cells.map((cell) => Number(cell.getAttribute("data-wave-period"))),
    );
  expect(periods.length).toBeGreaterThan(0);
  for (const period of periods) {
    expect(period).toBeGreaterThan(2);
    expect(period).toBeLessThan(25);
  }

  // Current: a speed in knots every third hour for the run's 72 hours.
  const currents = await graph
    .locator("[data-current]")
    .evaluateAll((cells) =>
      cells.map((cell) => Number(cell.getAttribute("data-current"))),
    );
  expect(currents.length).toBeGreaterThan(5);
  for (const knots of currents) expect(knots).toBeLessThan(6);

  // Rain: bars as tall as the rain, mm/h.
  const rain = await graph
    .locator('[data-band="rain"] rect[data-rain]')
    .evaluateAll((bars) =>
      bars.map((bar) => ({
        mm: Number(bar.getAttribute("data-rain")),
        tall: Number(bar.getAttribute("height")),
      })),
    );
  expect(rain.length).toBeGreaterThan(10);
  for (const bar of rain) {
    expect(bar.mm).toBeGreaterThan(0);
    expect(bar.tall).toBeGreaterThan(0);
  }
  const wettest = rain.reduce((a, b) => (b.mm > a.mm ? b : a));
  const driest = rain.reduce((a, b) => (b.mm < a.mm ? b : a));
  expect(wettest.tall).toBeGreaterThan(driest.tall);

  // The readout says each of them for the hour under the pointer.
  const readout = page.locator("[data-readout]");
  await expect(readout.locator("[data-readout-current]")).toContainText(
    /\d\.\d kn/,
  );
  await expect(readout.locator("[data-readout-rain]")).toContainText(
    /mm\/h|Dry/,
  );
  // An hour with a gust: its factor too (HARMONIE gives none at its first).
  await page.locator("[data-spot-graph]").scrollIntoViewIfNeeded();
  const box = (await page.locator("[data-spot-graph]").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + 80);
  await expect(readout.locator("[data-readout-gust]")).toContainText(
    /^Gusts\d\.\d×$/,
  );
  expect(errors).toEqual([]);
});

test("with no current published, the current's band says so", async ({
  page,
}) => {
  await page.route("**/weather/currents.json", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-current-note]")).toHaveText(
    "No current forecast is published just now",
  );
  await expect(page.locator('[data-band="current"]')).toHaveCount(0);
});

test("Table adds the gust factor, the wave period and the rain", async ({
  page,
}) => {
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await page.locator("[data-day-card]").nth(1).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.locator("[data-hour-table]");
  await expect(table.locator("thead")).toContainText("Gusts");
  await expect(table.locator("thead")).toContainText("Period");
  await expect(table.locator("thead")).toContainText("Rain mm/h");
  await expect(table.locator("[data-gust-cell]").first()).toHaveText(
    /^\d\.\d×$/,
  );
  await expect(table.locator("[data-rain-cell]").first()).toHaveText(
    /^(\d+\.\d|0|<0\.1|–)$/,
  );
});

test("?at= opens the week at that hour, as the pointer would", async ({
  page,
}) => {
  await withPictures(page);
  // 13:00 UTC on Tuesday 15 September: 14:00 in Ireland.
  await page.goto("/spot/brandon?at=2026-09-15T13:00:00Z");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const readout = page.locator("[data-readout]");
  await expect(readout).toContainText("Tue 14:00");
  await expect(readout).not.toContainText("Now");
  await expect(page.locator('[data-day-card="2026-09-15"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The loupe on the picture reads the same hour as the readout.
  const wind = await readout
    .locator("div", { hasText: /^Wind/ })
    .first()
    .textContent();
  const kn = /Wind(\d+)/.exec(wind ?? "")![1];
  await expect(page.locator("[data-loupe-foot]")).toContainText(kn);
  // The graph is scrolled along to it, past the hours before.
  const graph = page.locator("[data-spot-graph]");
  await expect
    .poll(() => graph.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(400);
  // The pointer moving off it lets the week go back to now.
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + 80);
  await page.mouse.move(box.x + box.width + 50, box.y - 50);
  await expect(readout).toContainText("Now");
});

test("?at= that is no time, or not in the week, opens on now", async ({
  page,
}) => {
  for (const at of [
    "tomorrow",
    "2027-01-01T12:00:00Z",
    "2026-09-01T12:00:00Z",
  ]) {
    await page.goto(`/spot/brandon?at=${at}`);
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    await expect(page.locator("[data-readout]")).toContainText("Now");
  }
});

test("a point on the open water has a page: its wind, no stars, and the nearest spot", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Off Brandon Bay, between it and the Maharees.
  const response = await page.goto("/spot/@52.3000,-10.1000");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "52.30° N, 10.10° W" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveTitle(/52\.30° N, 10\.10° W/);
  // The forecast: the point's own wind, now and across the week.
  const now = page.locator("[data-now]");
  await expect(now).toContainText("Wind now");
  await expect(now.locator(".text-big-sm").first()).toHaveText(/^\d+/);
  await expect(page.locator("[data-graph-svg] path").first()).toBeAttached();
  // No stars anywhere: not now, not in the week, not in an hour.
  await expect(page.locator('[data-your-stars="none"]')).toContainText(
    "No stars on open water",
  );
  await expect(page.locator("[data-point-no-stars]")).toBeVisible();
  for (const where of ["[data-now]", "[data-day-card]", "[data-readout]"])
    await expect(page.locator(`${where} [data-stars]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.locator("[data-hour-table] thead")).not.toContainText(
    "Stars",
  );
  // The nearest riding place, named and linked, and no star to keep a point by.
  const nearest = page.locator("[data-point-line] a[data-nearest-spot]");
  await expect(nearest).toHaveText("Garrywilliam Point");
  await expect(nearest).toHaveAttribute("href", "/spot/garrywilliam-point");
  await expect(page.locator("[data-point-line]")).toContainText(/\d\.\d km/);
  await expect(page.locator("[data-keep-star]")).toHaveCount(0);
  // Back goes to the chart: the map has no light for a point.
  await expect(
    page.locator(`[data-top-bar] [data-view-switch="chart"]`),
  ).toHaveAttribute("href", "/?map");
  expect(errors).toEqual([]);
});

test("below the spot: the wind and the waves through the year, with their figures on hover", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await page.goto("/spot/brandon");
  const year = page.locator("[data-climate]");
  await expect(year).toBeAttached({ timeout: 30000 });
  await year.scrollIntoViewIfNeeded();
  // After everything the page had: the spot's notes come first, the small print last.
  const order = await page.evaluate(() => {
    const at = (sel: string) => {
      const el = document.querySelector(sel);
      return el
        ? Array.from(document.querySelectorAll("main *")).indexOf(el)
        : -1;
    };
    return {
      spot: at("#the-spot"),
      year: at("[data-climate]"),
      print: at("[data-warnings-source]"),
    };
  });
  expect(order.spot).toBeGreaterThan(-1);
  expect(order.year).toBeGreaterThan(order.spot);
  expect(order.print).toBeGreaterThan(order.year);
  await expect(
    page.getByRole("heading", { name: "The wind through the year" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The waves through the year" }),
  ).toBeVisible();
  await expect(year).toContainText("How often it blows 12 kn or more");
  await expect(year).toContainText(
    "Generated using E.U. Copernicus Marine Service Information",
  );
  // Every figure says what it is: the whole sea's height, the swell alone, and where it was read.
  await expect(year).toContainText(
    "The whole sea, wind waves and swell together",
  );
  await expect(page.locator("[data-climate-candles]")).toContainText(
    "Bar: from 1 in 10 to 9 in 10 of those days",
  );
  await expect(year).toContainText(
    /Waves at the wave model’s point \d+\.\d km from the spot/,
  );
  // A month's column answers a hover with its figures.
  await page
    .locator("[data-climate-wind] rect[data-tip-target]")
    .first()
    .hover();
  const tip = page.locator("[data-climate-tip]");
  await expect(tip).toContainText("January");
  await expect(tip).toContainText("12 kn or more");
  // The swell's sizes: another size, another chart.
  const swell = page.locator("[data-climate-swell]");
  const before = await swell.locator("polyline").first().getAttribute("points");
  await swell.getByRole("button", { name: "1.2 to 1.8 m" }).click();
  await expect(
    swell.getByRole("button", { name: "1.2 to 1.8 m" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await swell.locator("polyline").first().getAttribute("points"),
  ).not.toBe(before);
  await page
    .locator("[data-climate-candles] rect[data-tip-target]")
    .first()
    .hover();
  await expect(tip).toContainText("Days a month");
  expect(errors).toEqual([]);
});

test("sheltered water says the open sea's waves do not reach it, rather than showing them", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/spot/malahide-estuary");
  const year = page.locator("[data-climate]");
  await expect(year).toBeAttached({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: "The wind through the year" }),
  ).toBeVisible();
  const sheltered = page.locator("[data-climate-sheltered]");
  await expect(sheltered).toContainText("Sheltered water");
  await expect(sheltered).toContainText(
    "The open sea’s waves don’t reach here",
  );
  await expect(page.locator("[data-climate-waves]")).toHaveCount(0);
});

test("a point on the open water has no year of its own", async ({ page }) => {
  await page.goto("/spot/@52.3000,-10.1000");
  await expect(
    page.getByRole("heading", { level: 1, name: "52.30° N, 10.10° W" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-climate]")).toHaveCount(0);
});

/** The figures in a wind, in order: "3 g5 kn W" is ["3", "5"]. */
const figures = (text: string | null) => (text ?? "").match(/\d+/g) ?? [];
/** The compass point a wind is from, the first one in its text. */
const point = (text: string | null) =>
  (text ?? "").match(/\b[NESW]{1,3}\b/)?.[0] ?? null;

for (const [id, station] of [
  ["belmullet", "ME_03976"],
  ["brandon", null],
] as const) {
  test(`the Wind now card, the readout at Now and the picture's rose say the same wind, ${station ? "as measured" : "the forecast's"}, at ${id}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    // A picture of each place, so its rose and its line are drawn.
    await withPictures(page);
    await page.route("**/satellite/spots.json", (route) =>
      route.fulfill({
        json: {
          ...pictures,
          spots: [
            ...pictures.spots,
            {
              id: "belmullet",
              lonLat: [-9.9919, 54.2234],
              high: "belmullet-high.webp",
              low: "belmullet-low.webp",
            },
          ],
        },
      }),
    );
    await page.goto(`/spot/${id}`);
    const readout = page.locator("[data-readout]");
    await expect(readout).toContainText("Now", { timeout: 30000 });
    const card = page.locator("[data-now]");
    const cardWind = card.locator("[data-now-wind]");
    const readWind = page.locator("[data-readout-wind] b");
    const foot = page.locator("[data-photo-loupe] [data-loupe-foot]");
    await expect(cardWind).toBeVisible();
    await expect(foot).toBeVisible();
    if (station) {
      // All the station's last reading; the card and the readout say where
      // and when.
      await expect(cardWind).toHaveAttribute("data-measured", station);
      await expect(readWind).toHaveAttribute("data-measured", station);
      await expect(foot).toHaveAttribute("data-measured", station);
      await expect(card.locator("[data-now-source]")).toHaveText(
        "· Belmullet 1 km, 22:00",
      );
      await expect(card.locator("[data-now-source]")).toHaveText(
        (await page
          .locator("[data-readout-wind] [data-readout-source]")
          .textContent())!,
      );
    } else {
      // No station within reach: both the forecast, from nowhere else.
      await expect(cardWind).not.toHaveAttribute("data-measured", /.*/);
      await expect(readWind).not.toHaveAttribute("data-measured", /.*/);
      await expect(foot).not.toHaveAttribute("data-measured", /.*/);
      await expect(card.locator("[data-now-source]")).toHaveCount(0);
    }
    const cardText = await cardWind.textContent();
    const readText = await readWind.textContent();
    expect(figures(cardText).length).toBeGreaterThan(0);
    expect(figures(cardText)).toEqual(figures(readText));
    expect(
      point(await card.locator("[data-now-direction]").textContent()),
    ).toBe(point(readText));
    // The picture's line: "ENE 4 g6 · offshore", the same wind, gust and way.
    const footText = await foot.textContent();
    expect(figures(footText)).toEqual(figures(readText));
    expect(point(footText)).toBe(point(readText));
    // And the same word for the shore as the card, where it has one.
    const shoreWord = (text: string | null) =>
      (text ?? "").match(
        /(cross-shore|cross-off|cross-on|offshore|onshore)/,
      )?.[0] ?? null;
    const cardShore = shoreWord(
      await card.locator("[data-now-direction]").textContent(),
    );
    if (cardShore) expect(shoreWord(footText)).toBe(cardShore);
  });
}

/**
 * A finger's drag from one point to another, as the phone's own touch events
 * (Chrome's DevTools protocol): unlike `page.touchscreen`, which only taps,
 * the browser scrolls under it as it would under a finger, by the page's own
 * `touch-action`.
 */
async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let i = 1; i <= steps; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

test.describe("on a phone, the week graph", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  const graphState = (page: Page) =>
    page.evaluate(() => ({
      left: document.querySelector("[data-spot-graph]")!.scrollLeft,
      top: Math.round(scrollY),
      hour: document.querySelector("[data-readout]")!.textContent!.slice(0, 9),
    }));
  /** Where the hours and the page come to rest, once a fling has run out. */
  const settled = async (page: Page) => {
    let last = await graphState(page);
    for (;;) {
      await page.waitForTimeout(150);
      const now = await graphState(page);
      if (now.left === last.left && now.top === last.top) return now;
      last = now;
    }
  };

  test("a finger drags the hours along the graph, and scrolls the page up and down it", async ({
    page,
  }) => {
    await withTides(page);
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    const graph = page.locator("[data-spot-graph]");
    const readout = page.locator("[data-readout]");
    await expect(page.locator("[data-graph-svg]")).toBeVisible();
    // Everything above the graph in, so nothing moves the page but a finger.
    await page.waitForLoadState("networkidle");
    await readout.evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top),
    );
    const box = (await graph.boundingBox())!;
    // Across the graph, from its wind row to its current: the hours move
    // under the playhead and the readout follows, and the page stays put.
    for (const down of [60, 200, 330, 480]) {
      const before = await settled(page);
      const y = box.y + down;
      await swipe(page, { x: box.x + 250, y }, { x: box.x + 50, y });
      await expect
        .poll(async () => (await graphState(page)).left, {
          message: `a drag ${down}px down the graph`,
        })
        .toBeGreaterThan(before.left + 100);
      const after = await settled(page);
      expect(after.top).toBe(before.top);
      expect(after.hour).not.toBe(before.hour);
    }
    // Up the graph: the page scrolls, the hours stay where they were.
    const before = await settled(page);
    await swipe(
      page,
      { x: box.x + 150, y: box.y + 400 },
      { x: box.x + 150, y: box.y + 150 },
    );
    await expect
      .poll(async () => (await graphState(page)).top)
      .toBeGreaterThan(before.top + 100);
    expect((await settled(page)).left).toBe(before.left);
  });

  test("the band names stand beside the hours, never over them, and clear of the readout", async ({
    page,
  }) => {
    await withTides(page);
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    const graph = page.locator("[data-spot-graph]");
    const readout = page.locator("[data-readout]");
    await expect(page.locator("[data-graph-svg]")).toBeVisible();
    const names = page.locator("[data-band-name]");
    await expect(names).toHaveText([
      "Stars",
      "Wind",
      "Direction",
      "Sea",
      "Tide",
      "Sky",
      "Rain",
      "Models",
      "Gusts",
      "Waves",
      "Current",
    ]);
    // Every name whole, and left of the hours, wherever they are scrolled.
    const left = (await graph.boundingBox())!.x;
    await graph.evaluate((el) => (el.scrollLeft = el.scrollWidth / 3));
    for (const box of await names.evaluateAll((spans) =>
      spans.map((span) => {
        const { left, right } = span.getBoundingClientRect();
        return { left, right };
      }),
    )) {
      expect(box.right).toBeLessThanOrEqual(left);
      expect(box.left).toBeGreaterThanOrEqual(0);
    }
    // The page scrolled until the top of the wind band is under the readout,
    // which is held at the top of the screen: the band's name is held below
    // the readout's foot rather than going under it.
    const wind = names.filter({ hasText: "Wind" });
    await readout.evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top),
    );
    const foot = await readout.evaluate(
      (el) => el.parentElement!.getBoundingClientRect().bottom,
    );
    const svgTop = (await page.locator("[data-graph-svg]").boundingBox())!.y;
    // 60px of the 118px wind band, which starts 34px down, under the readout.
    await page.evaluate((by) => scrollBy(0, by), svgTop + 34 + 60 - foot);
    await expect
      .poll(async () => (await wind.boundingBox())!.y)
      .toBeGreaterThanOrEqual(foot - 0.5);
    expect((await wind.boundingBox())!.y).toBeLessThan(foot + 4);
  });

  test("the readout's stars have room for a warning's mark beside them", async ({
    page,
  }) => {
    // A yellow small-craft warning over the rated hours of the next two days.
    const at = (hours: number) => new Date(clock + hours * HOUR).toISOString();
    const runTime =
      new Date(clock - HOUR).toISOString().slice(0, 14) + "00:00.000Z";
    await page.route("**/marine/warnings.json", (route) =>
      route.fulfill({
        json: {
          schemaVersion: 1,
          kind: "warnings",
          model: "warnings",
          run: runTime.slice(0, 13).replace(/[-T]/g, ""),
          runTime,
          generatedAt: runTime.replace(":00.000Z", ":25.000Z"),
          sourceUrl: "https://www.met.ie/Open_Data/json/warning_ALL.json",
          attribution: "Weather warnings from Met Éireann (met.ie), CC BY 4.0",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          warnings: [
            {
              id: 1,
              capId: "test.yellow",
              type: "small-craft",
              level: "yellow",
              severity: "Moderate",
              certainty: "Likely",
              status: "Warning",
              issued: at(-10),
              updated: at(-10),
              onset: at(5),
              expiry: at(60),
              headline: "Small Craft warning for all coasts of Ireland",
              description: "<p>Southwest winds will reach force 6.</p>",
              regions: ["EI816", "EI817", "EI818"],
            },
          ],
        },
      }),
    );
    await withTides(page);
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    const graph = page.locator("[data-spot-graph]");
    const readout = page.locator("[data-readout]");
    const mark = readout.locator("[data-notice-mark]");
    await expect(page.locator("[data-graph-svg]")).toBeVisible();
    await readout.evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top),
    );
    // Along the hours until one under the warning is read out.
    for (let i = 0; i < 100 && !(await mark.count()); i++) {
      await graph.evaluate(
        (el, f) => (el.scrollLeft = (el.scrollWidth - el.clientWidth) * f),
        i / 100,
      );
      await page.waitForTimeout(20);
    }
    await expect(mark).toHaveCount(1);
    await expect(readout.locator("[data-stars]")).toBeVisible();
    const room = await mark.evaluate((el) => {
      const cell = el.closest("[data-readout] > *")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const gust = document
        .querySelector("[data-readout-gust]")!
        .getBoundingClientRect();
      return {
        inCell: box.left >= cell.left && box.right <= cell.right,
        clear:
          box.right <= gust.left ||
          box.left >= gust.right ||
          box.bottom <= gust.top ||
          box.top >= gust.bottom,
      };
    });
    expect(room).toEqual({ inCell: true, clear: true });
  });
});
