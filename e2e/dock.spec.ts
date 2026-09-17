import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { encodeFrame } from "../scripts/f5bin.mjs";

const harmonie = JSON.parse(
  readFileSync("public/weather/harmonie.json", "utf8"),
);

/**
 * A tide fixture, so the marine row is tested the same way whether or not
 * `public/marine` has been generated locally (it is git-ignored). Heights are a
 * plain semidiurnal curve; only the shape and the datum matter here.
 */
const STEP_MINUTES = 30;
const FROM = "2026-09-13T00:00:00Z";
const SAMPLES = 193; // four days at half-hourly steps.
const tideCurve = {
  stepMinutes: STEP_MINUTES,
  from: FROM,
  to: new Date(
    Date.parse(FROM) + (SAMPLES - 1) * STEP_MINUTES * 60000,
  ).toISOString(),
  datum: "LAT",
  curve: Array.from(
    { length: SAMPLES },
    (_, i) => 2.2 + 1.8 * Math.sin((i * Math.PI) / 12.42),
  ),
  events: [{ time: "2026-09-13T03:00:00Z", kind: "high", height: 4 }],
};
const tideManifest = {
  schemaVersion: 1,
  kind: "tide",
  stations: {
    Fenit: {
      name: "Fenit",
      lat: 52.27,
      lon: -9.87,
      url: "marine/tides-Fenit-test.json",
    },
  },
  spots: {
    brandon: { station: "Fenit", distanceKm: 10.9 },
    dollymount: {
      station: null,
      distanceKm: 103.9,
      reason: "Nearest station is 104 km away, beyond the 40 km limit.",
    },
  },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};

/**
 * A sea-temperature fixture, for the same reason as the tide one: the
 * observations are produced by `npm run sea:refresh` and are git-ignored, so the
 * Sea row has to be testable without them. The station is fake but the shape is
 * the adapter's own: a buoy with no published sensor depth, a latest reading two
 * hours before the clock below, and a seven-day series thinned to three hours.
 */
const SEA_CLOCK = "2026-09-13T21:00:00Z";
const SEA_LATEST = "2026-09-13T19:00:00Z";
const seaSeries = Array.from({ length: 8 }, (_, index) => ({
  time: new Date(
    Date.parse(SEA_LATEST) - (7 - index) * 3 * 3600000,
  ).toISOString(),
  value: Number((15.8 - index * 0.08).toFixed(2)),
}));
const seaManifest = (brandonCovered: boolean) => ({
  schemaVersion: 1,
  kind: "observation",
  model: "sea-temperature",
  run: "2026091319",
  generatedAt: SEA_LATEST,
  variable: { name: "seaTemperature", units: "°C" },
  stepMinutes: 180,
  maxDistanceKm: 60,
  maxObservationAgeHours: 48,
  stations: {
    IWB_M3: {
      id: "IWB_M3",
      name: "M3",
      lat: 51.216,
      lon: -10.551,
      network: "buoy",
      depth: null,
    },
  },
  spots: {
    brandon: brandonCovered
      ? {
          station: "IWB_M3",
          distanceKm: 60.8,
          latest: { time: SEA_LATEST, value: 15.24 },
          series: seaSeries,
        }
      : {
          station: null,
          distanceKm: 133.4,
          reason:
            "The nearest reporting station (M3) is 133 km away, beyond the 60 km limit.",
        },
  },
  attribution: "Sea temperature © Marine Institute, CC BY 4.0",
});
async function withSeaTemperature(page: Page, brandonCovered = true) {
  await page.route("**/marine/sea-temperature.json", (route) =>
    route.fulfill({ json: seaManifest(brandonCovered) }),
  );
}

async function withTides(page: Page) {
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-Fenit-test.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
}
async function withoutTides(page: Page) {
  await page.route("**/marine/**", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
}

const ticks = (page: Page) => page.locator(".axis-ticks i").allTextContents();

test("the blend draws every model that covers the spot, and candles share its axis", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await page.clock.setFixedTime(
    new Date(Date.parse(harmonie.runTime) + 8 * 3600000),
  );
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator(".dock-place strong")).toHaveText("Brandon Bay");
  await expect(page.locator(".dock-place small")).toContainText("Kerry");
  await expect(page.locator(".dock-place small")).toContainText("Fenit tide");
  await expect(page.locator(".blend-chart")).toBeVisible();

  // One faint line per model, in that model's own hue.
  const hues = await page
    .locator(".model-line")
    .evaluateAll((lines) =>
      Array.from(new Set(lines.map((line) => line.getAttribute("stroke")))),
    );
  expect(hues.length).toBeGreaterThanOrEqual(3);
  // Three stacked quantile bands, a white median and the wind gradient.
  await expect(page.locator(".blend-band")).toHaveCount(3);
  await expect(page.locator(".median-line")).toHaveCount(1);
  // The fill is keyed to the axis: a stop every five units, from zero to the top.
  expect(
    await page.locator(".blend-chart linearGradient stop").count(),
  ).toBeGreaterThanOrEqual(5);
  expect(
    await page
      .locator(".blend-chart .chart-night")
      .count()
      .then((count) => count > 0),
  ).toBe(true);
  await expect(page.locator(".forecast-now")).toHaveCount(1);
  // Every three-hourly column is the same width, including the ones whose day
  // group holds only them: the charts read the columns as evenly spaced.
  const widths = await page
    .locator(".forecast-table thead tr:nth-child(2) th")
    .evaluateAll((cells) =>
      cells
        .slice(1)
        .map((cell) => Math.round(cell.getBoundingClientRect().width)),
    );
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  await expect(page.locator(".tide-row")).toHaveCount(1);
  await expect(page.locator(".tide-underlay")).toHaveCount(1);
  await expect(page.locator(".forecast-credits")).toContainText("Fenit tide");
  await expect(page.locator(".forecast-credits")).toContainText("LAT");
  await expect(page.locator(".forecast-credits")).toContainText(
    "Marine Institute",
  );

  // Hovering a column names each model's reading, the spread and the agreement.
  const chart = (await page.locator(".chart-holder").boundingBox())!;
  await page.mouse.move(chart.x + 260, chart.y + chart.height / 2);
  const card = page.locator(".chart-hover-card");
  await expect(card).toBeVisible();
  // The dock is backdrop-filtered, which makes it the containing block for
  // fixed children: an unportalled card lands below the fold.
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.y).toBeGreaterThanOrEqual(0);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await expect(card).toContainText("HARMONIE");
  await expect(card).toContainText("Median");
  await expect(card).toContainText(/models agree|some spread|models disagree/);

  await page.locator('[data-view="candles"]').click();
  await expect(page.locator(".candle-chart")).toBeVisible();
  await expect(page.locator(".blend-chart")).toHaveCount(0);
  await expect(page.locator(".candle-body").first()).toBeVisible();
  await expect(page.locator(".candle-gust").first()).toHaveCount(1);
  await page.screenshot({ path: "test-results/dock-candles.png" });
  expect(errors).toEqual([]);
});

test("units drive the chart axis, the table and the map readouts together", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  const knots = await ticks(page);
  expect(knots).toContain("30");
  await page.getByLabel("Display options", { exact: true }).click();
  await page.locator('[data-units="m/s"]').click();
  await page.getByLabel("Close display options").click();
  const metres = await ticks(page);
  expect(metres).not.toEqual(knots);
  expect(Number(metres.at(-1))).toBeLessThan(Number(knots.at(-1)));
  await expect(page.locator(".row-label small").first()).toHaveText("m/s");
  await page.locator('[data-view="table"]').click();
  await expect(
    page.locator(".forecast-table tbody tr").first().locator("th small"),
  ).toHaveText("m/s");
  await expect(page.locator(".spot-marker.active")).toContainText(/^\d+$/);
});

test("display choices survive a reload", async ({ page }) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  // Spread only: the direction row is off by default, its arrows live on the chart.
  await expect(page.locator(".blend-row")).toHaveCount(1);
  await page.getByLabel("Display options", { exact: true }).click();
  await page.locator('input[data-row="gust"]').check();
  await page.locator('input[data-row="spread"]').uncheck();
  await page.locator('[data-units="km/h"]').click();
  await page.locator('input[data-model-toggle="gfs"]').uncheck();
  await page.getByLabel("Close display options").click();
  await expect(page.locator(".blend-row .gust-cell").first()).toBeVisible();

  await page.reload();
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".blend-row .gust-cell").first()).toBeVisible();
  await page.getByLabel("Display options", { exact: true }).click();
  await expect(page.locator('input[data-row="gust"]')).toBeChecked();
  await expect(page.locator('input[data-row="spread"]')).not.toBeChecked();
  await expect(page.locator('[data-units="km/h"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator('input[data-model-toggle="gfs"]'),
  ).not.toBeChecked();
});

test("the filter is reachable and dismissable from the keyboard", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  const trigger = page.getByLabel("Display options", { exact: true });
  await trigger.focus();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog.display-filter");
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Focus is inside the dialog, and Tab keeps it there.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document
        .querySelector("dialog.display-filter")!
        .contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Escape closed the popover, not the whole dock.
  await expect(page.locator(".forecast-sheet")).toBeVisible();
});

test("an arbitrary map point falls back to the table and says why", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  // The markers are the signal that the map has finished its opening move; a
  // click before that lands on a different place than the one aimed at.
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  const blend = page.locator('[data-view="blend"]');
  await expect(blend).toBeDisabled();
  await expect(blend).toHaveAttribute(
    "title",
    "Choose a named spot for the model blend",
  );
  await expect(page.locator('[data-view="candles"]')).toBeDisabled();
  await expect(page.locator('[data-view="table"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".blend-chart")).toHaveCount(0);
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    harmonie.frames.length,
  );
  // Returning to a named spot restores the chart the reader chose.
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page.getByRole("searchbox").fill("Brandon");
  await page.locator(".spot-row").first().click();
  await expect(page.locator(".blend-chart")).toBeVisible();
});

test("a riding place outside the original eight gets the blend too", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page.getByRole("searchbox").fill("Lahinch");
  await page.locator(".spot-row").first().click();
  await expect(page.locator(".dock-place strong")).toHaveText("Lahinch Beach");
  // The bundled runs were published before this spot existed; their series were
  // recomputed from the same frames, so the blend is no longer a table fallback.
  const blend = page.locator('[data-view="blend"]');
  await expect(blend).toBeEnabled();
  await expect(blend).not.toHaveAttribute("title", /named spot|precomputed/);
  await expect(blend).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".blend-chart")).toBeVisible();
  const hues = await page
    .locator(".model-line")
    .evaluateAll((lines) =>
      Array.from(new Set(lines.map((line) => line.getAttribute("stroke")))),
    );
  expect(hues.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".median-line")).toHaveCount(1);
});

test("a missing tide manifest hides the row and explains itself in the filter", async ({
  page,
}) => {
  await withoutTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".tide-row")).toHaveCount(0);
  await expect(page.locator(".tide-underlay")).toHaveCount(0);
  await expect(page.locator(".forecast-credits")).not.toContainText("tide");
  await page.getByLabel("Display options", { exact: true }).click();
  const tide = page.locator('.filter-switch:has(input[data-row="tide"])');
  await expect(tide.locator("input")).toBeDisabled();
  await expect(tide).toContainText("npm run tides:refresh");
  // The surface-weather rows have an adapter now, so they survive the tides
  // going missing too.
  for (const row of ["weather", "air", "rain", "cloud", "pressure", "sea"])
    await expect(
      page.locator(`.filter-switch:has(input[data-row="${row}"]) input`),
    ).toBeEnabled();
  // Waves do have one now, so the block survives the tides going missing.
  await expect(
    page.locator('.filter-switch:has(input[data-row="waves"]) input'),
  ).toBeEnabled();
  await expect(page.locator(".tide-row")).toHaveCount(0);
  await expect(page.locator('.wave-row[data-row="waves"]')).toHaveCount(1);
});

test("a missing weather manifest hides the rows and says why in the filter", async ({
  page,
}) => {
  await withTides(page);
  await page.route("**/weather/icon-eu-weather.json", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".weather-row")).toHaveCount(0);
  await expect(page.locator(".forecast-credits")).not.toContainText(
    "ICON-EU surface",
  );
  await page.getByLabel("Display options", { exact: true }).click();
  for (const row of ["weather", "air", "rain", "cloud", "pressure", "sea"]) {
    const entry = page.locator(`.filter-switch:has(input[data-row="${row}"])`);
    await expect(entry.locator("input")).toBeDisabled();
    await expect(entry).toContainText("no source yet");
  }
});

test("row glyphs explain themselves, and the dock fits its budget", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  const spread = page.getByRole("button", { name: "Spread", exact: true });
  await spread.focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Half the gap between the highest");
  const tipBox = (await tip.boundingBox())!;
  expect(tipBox.y).toBeGreaterThanOrEqual(0);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: "test-results/dock-row-tooltip-390.png" });
  const dock = (await page.locator(".map-footer").boundingBox())!;
  // Three surface-weather rows are on by default — weather, air and rain — at
  // the compact row height of 22px, which is 66px on top of the 307px this was
  // before they existed. The budget is per row, not per dock: a row that wanted
  // more than 22px here would be the failure.
  expect(dock.height).toBeLessThan(380);
  const compactRows = await page
    .locator(".forecast-table .marine-row td:first-of-type")
    .evaluateAll((cells) =>
      cells.map((cell) => Math.round(cell.getBoundingClientRect().height)),
    );
  expect(compactRows.length).toBeGreaterThanOrEqual(4);
  expect(Math.max(...compactRows)).toBeLessThanOrEqual(24);
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-blend-390.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".dock-views button > span").first()).toBeVisible();
  const wide = (await page.locator(".map-footer").boundingBox())!;
  // Two weather rows on by default at the full 24px: 48px on top of the previous 367px.
  expect(wide.height).toBeLessThan(450);
  const rows = await page
    .locator(".forecast-table .marine-row td:first-of-type")
    .evaluateAll((cells) =>
      cells.map((cell) => Math.round(cell.getBoundingClientRect().height)),
    );
  // The weather rows take the standard 24px; only waves and the tide take 28px.
  expect(
    await page
      .locator(".forecast-table .weather-row td:first-of-type")
      .evaluateAll((cells) =>
        cells.map((cell) => Math.round(cell.getBoundingClientRect().height)),
      ),
  ).toEqual([24, 24]);
  expect(Math.max(...rows)).toBeLessThanOrEqual(28);
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-blend-1440.png",
  });
});

/**
 * The sample GFS-Wave run is 2026-09-16 18 UTC, +0 to +9 h. HARMONIE's sample
 * run ends on 16 September at 01 UTC, so the dock's columns — which are the
 * selected wind model's own forecast times — have to come from a model that
 * reaches the wave hours. GFS runs from 16 September 06 UTC to +24 h. The
 * numbers below are the ones scripts/sample-weather.mjs publishes; the run
 * times, cadences and coverage are the ones the real adapters publish.
 */
const WAVE_CLOCK = "2026-09-16T20:00:00Z";
async function withWaveColumns(page: Page) {
  await withTides(page);
  await page.clock.setFixedTime(new Date(WAVE_CLOCK));
  await page.goto("/");
  await expect(page.locator('[data-model="gfs"]')).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="gfs"]').click();
  await expect(page.locator('[data-model="gfs"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".blend-chart")).toBeVisible();
}
/** The wave cells that actually carry a reading, in column order. */
const waveReadings = (page: Page, row: string) =>
  page
    .locator(`.wave-row[data-row="${row}"] .wave-cell`)
    .evaluateAll((cells) => cells.map((cell) => cell.textContent ?? ""));

test("the Waves row reads the bundled GFS-Wave run for Brandon Bay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withWaveColumns(page);
  await expect(page.locator(".dock-place strong")).toHaveText("Brandon Bay");

  const row = page.locator('.wave-row[data-row="waves"]');
  await expect(row).toHaveCount(1);
  // Four native wave steps land on four of GFS's three-hourly columns.
  expect(await waveReadings(page, "waves")).toHaveLength(4);
  // Height in metres to one decimal; the run hour reads 2.95 m at 7.29 s.
  await expect(row.locator(".wave-cell b").first()).toHaveText("3.0");
  await expect(row.locator(".wave-cell small").first()).toHaveText("7s");
  for (const part of ["b", "small"] as const)
    for (const text of await row
      .locator(`.wave-cell ${part}`)
      .allTextContents())
      expect(text).toMatch(part === "b" ? /^\d+\.\d$/ : /^\d+s$/);
  // The row's unit is stated once, on the glyph, not in every cell.
  await expect(row.locator("th .row-label small")).toHaveText("m");

  // Every other column is empty, and empty is a dash, never a zero.
  const cells = await row.locator("td").allTextContents();
  expect(cells.filter((text) => text === "—").length).toBe(cells.length - 4);
  expect(cells).not.toContain("0");
  expect(cells).not.toContain("0.0");

  // One arrow per reading, rotated to where the waves are going.
  const rotations = await row
    .locator(".wave-arrow")
    .evaluateAll((arrows) =>
      arrows.map((arrow) => (arrow as SVGElement).style.transform),
    );
  expect(rotations).toHaveLength(4);
  for (const rotation of rotations) expect(rotation).toMatch(/^rotate\(\d/);

  // The glyph says what the row means, and the credits name the source used.
  await page.getByRole("button", { name: "Waves", exact: true }).focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Significant wave height and peak period");
  await expect(tip).toContainText("direction is where waves come from");
  await expect(page.locator(".forecast-credits")).toContainText(
    "GFS-Wave waves",
  );
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-waves-1440.png",
  });
  expect(errors).toEqual([]);
});

test("the swell and wind-sea rows are off until the filter turns them on", async ({
  page,
}) => {
  await withWaveColumns(page);
  await expect(page.locator('.wave-row[data-row="swell"]')).toHaveCount(0);
  await expect(page.locator('.wave-row[data-row="windsea"]')).toHaveCount(0);

  await page.getByLabel("Display options", { exact: true }).click();
  for (const row of ["swell", "windsea", "waveOverlay"]) {
    const input = page.locator(`input[data-row="${row}"]`);
    await expect(input).toBeEnabled();
    await expect(input).not.toBeChecked();
    await input.check();
  }
  await page.getByLabel("Close display options").click();

  await expect(page.locator('.wave-row[data-row="windsea"]')).toHaveCount(1);
  await expect(page.locator('.wave-row[data-row="swell"]')).toHaveCount(1);
  // The wind sea is published at every step in this run; the first swell
  // partition is separated only at the run hour, so its row is sparser — and
  // the columns it has nothing for are dashes, not zeroes.
  expect(await waveReadings(page, "windsea")).toHaveLength(4);
  expect(await waveReadings(page, "swell")).toHaveLength(1);
  expect(
    await page.locator('.wave-row[data-row="swell"] td').allTextContents(),
  ).not.toContain("0.0");
  // The chart's wave band is a single path under the wind blend.
  await expect(page.locator(".blend-chart .wave-band")).toHaveCount(1);
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-waves-partitions-1440.png",
  });

  // And the choices persist, like every other row switch.
  await page.reload();
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Display options", { exact: true }).click();
  await expect(page.locator('input[data-row="swell"]')).toBeChecked();
  await expect(page.locator('input[data-row="waveOverlay"]')).toBeChecked();
});

test("a spot with no wave coverage hides the row and says so in the filter", async ({
  page,
}) => {
  await withWaveColumns(page);
  // Rusheen is land-masked in every cell reaching it, so GFS-Wave publishes it
  // as nulls with a stated reason rather than borrowing a neighbour's sea.
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page.getByRole("searchbox").fill("Rusheen");
  await page.locator(".spot-row").first().click();
  await expect(page.locator(".wave-row")).toHaveCount(0);
  await expect(page.locator(".forecast-credits")).not.toContainText("waves");

  await page.getByLabel("Display options", { exact: true }).click();
  for (const row of ["waves", "swell", "windsea", "waveOverlay"]) {
    const entry = page.locator(`.filter-switch:has(input[data-row="${row}"])`);
    await expect(entry.locator("input")).toBeDisabled();
    await expect(entry).toContainText("no wave data at this spot");
  }
});

/**
 * The bundled ICON-EU surface run is 2026-09-16 18 UTC, +0 and +3 h only, so it
 * needs the same overlapping wind columns the wave rows do: GFS, whose 16
 * September 12 UTC run reaches those hours. Its own `icon-eu` wind sibling ends
 * before them and HARMONIE never reaches them at all.
 */
const weatherReadings = (page: Page, row: string) =>
  page
    .locator(`.weather-row[data-row="${row}"] td`)
    .evaluateAll((cells) =>
      cells.map((cell) => (cell.textContent ?? "").trim()),
    );

test("the Air and Rain rows read the bundled ICON-EU run for Brandon Bay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withWaveColumns(page);
  await expect(page.locator(".dock-place strong")).toHaveText("Brandon Bay");

  // Air and Weather are on by default; Rain, Cloud, Pressure and Sea are not.
  // The weather glyph already says when it rains, so the Rain row is opt-in.
  await expect(page.locator('.weather-row[data-row="air"]')).toHaveCount(1);
  await expect(page.locator('.weather-row[data-row="weather"]')).toHaveCount(1);
  for (const row of ["rain", "cloud", "pressure", "sea"])
    await expect(page.locator(`.weather-row[data-row="${row}"]`)).toHaveCount(
      0,
    );
  await page.getByLabel("Display options", { exact: true }).click();
  await page.locator('input[data-row="rain"]').check();
  await page.getByLabel("Close display options").click();
  await expect(page.locator('.weather-row[data-row="rain"]')).toHaveCount(1);

  // Two native steps land on two of GFS's three-hourly columns: 13.6 °C then
  // 11.2 °C, as whole degrees. Every other column is a dash, never a zero.
  const air = await weatherReadings(page, "air");
  expect(air.filter((text) => text !== "—")).toEqual(["14", "11"]);
  expect(air.filter((text) => text === "—").length).toBe(air.length - 2);
  expect(air).not.toContain("0");

  // The run hour has no interval to difference, so its rain is a dash with the
  // reason in the cell; the 18–21 UTC interval carries 1.2 mm.
  const rain = page.locator('.weather-row[data-row="rain"]');
  expect(await weatherReadings(page, "rain")).toContain("1.2");
  await expect(rain.locator("td.rain-cell")).toHaveCount(1);
  await expect(rain.locator("td.rain-cell")).toHaveAttribute(
    "title",
    /1\.2 mm in the 3 hours to/,
  );
  // The unit is stated once on each glyph, not in every cell.
  await expect(rain.locator("th .row-label small")).toHaveText("mm");
  await expect(
    page.locator('.weather-row[data-row="air"] th .row-label small'),
  ).toHaveText("°C");

  // The air cell's own tooltip adds the dew point and the humidity.
  await expect(
    page.locator('.weather-row[data-row="air"] td[title]').first(),
  ).toHaveAttribute("title", /dew point .* humidity \d+ %/);

  // Present weather is an inline stroke glyph per code, with the code's words.
  const glyphs = page.locator(".weather-cell");
  await expect(glyphs).toHaveCount(2);
  await expect(glyphs.nth(0)).toHaveAttribute("data-weather", "cloudy");
  await expect(glyphs.nth(0)).toHaveAttribute("data-code", "3");
  await expect(glyphs.nth(1)).toHaveAttribute("data-weather", "rain");
  await expect(glyphs.nth(1)).toHaveAttribute("data-code", "61");
  await expect(glyphs.first().locator("svg")).toHaveAttribute(
    "stroke",
    "currentColor",
  );
  await expect(
    page.locator('.weather-row[data-row="weather"] td[title]').first(),
  ).toHaveAttribute("title", /WMO present-weather code 3/);
  await expect(page.locator(".weather-cell .sr-only").nth(1)).toHaveText(
    "Slight rain",
  );

  // The glyph explains the row, and the credits name DWD for it.
  await page.getByRole("button", { name: "Rain", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "an amount, not a rate",
  );
  // The credits name the source the row used; a sample bundle names itself.
  await expect(page.locator(".forecast-credits")).toContainText(
    "ICON-EU surface weather, Synthetic sample data",
  );
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-weather-1440.png",
  });
  expect(errors).toEqual([]);
});

test("the cloud, pressure and sea rows are off until the filter turns them on", async ({
  page,
}) => {
  await withWaveColumns(page);
  await page.getByLabel("Display options", { exact: true }).click();
  for (const row of ["cloud", "pressure", "sea"]) {
    const input = page.locator(`input[data-row="${row}"]`);
    await expect(input).toBeEnabled();
    await expect(input).not.toBeChecked();
    await input.check();
  }
  await page.getByLabel("Close display options").click();

  // Cloud is a number plus a three-level bar for high, medium and low.
  const cloud = page.locator('.weather-row[data-row="cloud"]');
  await expect(cloud.locator(".cloud-cell b").first()).toHaveText("68");
  await expect(
    cloud.locator(".cloud-cell").first().locator(".cloud-bars s"),
  ).toHaveCount(3);
  await expect(cloud.locator("td[title]").first()).toHaveAttribute(
    "title",
    /high 35 %, medium 23 %, low 66 %/,
  );
  // Pressure is whole hectopascals.
  expect(
    (await weatherReadings(page, "pressure")).filter((text) => text !== "—"),
  ).toEqual(["1017", "1014"]);
  // The sea row is the model's skin temperature, drawn back and labelled as an
  // approximation in both the cell and the row's explanation.
  const sea = page.locator('.weather-row[data-row="sea"]');
  await expect(sea.locator("td.proxy-cell")).toHaveCount(2);
  await expect(sea.locator("td.proxy-cell").first()).toHaveAttribute(
    "title",
    /Model skin temperature .* not a measured sea temperature/,
  );
  await page.getByRole("button", { name: "Sea temp", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Model skin temperature, approximate",
  );
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-weather-all-1440.png",
  });

  // And the choices persist, like every other row switch.
  await page.reload();
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await page.getByLabel("Display options", { exact: true }).click();
  for (const row of ["cloud", "pressure", "sea"])
    await expect(page.locator(`input[data-row="${row}"]`)).toBeChecked();
});

test("a wind model whose hours miss the weather run reads as dashes", async ({
  page,
}) => {
  // HARMONIE's bundled run ends on 16 September at 01 UTC, hours the ICON-EU
  // surface run does not reach. The rows stay, and say nothing, rather than
  // borrowing a step from three days away.
  await withTides(page);
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.weather-row[data-row="air"]')).toHaveCount(1);
  const air = await weatherReadings(page, "air");
  expect(air.length).toBeGreaterThan(0);
  expect(new Set(air)).toEqual(new Set(["—"]));
  await expect(page.locator(".weather-cell")).toHaveCount(0);
});

test("an instantaneous-gust model reads at initialization", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/");
  await expect(page.locator('[data-model="gfs"]')).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="gfs"]').click();
  await expect(page.locator('[data-model="gfs"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator('[data-view="table"]').click();
  const first = page.locator(".gust-cell").first();
  await expect(first).toHaveText(/^\d+$/);
  await expect(first).toHaveAttribute("title", /^Instantaneous gust at/);
  await page.locator(".model-info").click();
  await expect(page.locator("dialog.info-dialog")).toContainText(
    "publishes instantaneous gusts",
  );
  await expect(page.locator("dialog.info-dialog")).toContainText(
    "accumulation window",
  );
});

test("the Sea row shows the observed water temperature, once, and by default", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withTides(page);
  await withSeaTemperature(page);
  await page.clock.setFixedTime(new Date(SEA_CLOCK));
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".dock-place strong")).toHaveText("Brandon Bay");

  // Nobody switched it on: an observation exists for this spot, so the row is.
  const sea = page.locator('.weather-row[data-row="sea"]');
  await expect(sea).toHaveCount(1);
  await expect(sea).toHaveClass(/observed-row/);
  await page.getByLabel("Display options", { exact: true }).click();
  await expect(page.locator('input[data-row="sea"]')).toBeChecked();
  await page.getByLabel("Close display options").click();

  // One reading spanning the row, at the left: a measurement is not a forecast
  // per column, so there is exactly one cell and it is not a per-hour value.
  const cell = sea.locator("td.observed-cell");
  await expect(cell).toHaveCount(1);
  await expect(sea.locator("td")).toHaveCount(1);
  await expect(sea.locator("td.proxy-cell")).toHaveCount(0);
  await expect(cell.locator("b")).toHaveText("15.2 °C");
  await expect(cell.locator("small")).toHaveText("· M3 buoy, 61 km, 2 h ago");

  // The tooltip names the station, the network, the distance, the unpublished
  // depth, when it was measured and who measured it.
  const title = (await cell.getAttribute("title"))!;
  expect(title).toContain("15.2 °C measured at M3");
  expect(title).toContain("weather buoy");
  expect(title).toContain("60.8 km from Brandon Bay");
  expect(title).toContain("sensor depth not published");
  expect(title).toContain("2 h ago");
  expect(title).toContain("Marine Institute");

  // Seven days of readings as a sparkline, inside the row's own height.
  const spark = cell.locator(".observed-spark polyline");
  await expect(spark).toHaveCount(1);
  expect((await spark.getAttribute("points"))!.split(" ").length).toBe(8);
  const box = (await cell.boundingBox())!;
  expect(Math.round(box.height)).toBeLessThanOrEqual(24);

  // The glyph says it is a measurement, and the credits name the source.
  await page.getByRole("button", { name: "Sea temp", exact: true }).focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Measured water temperature from M3");
  await expect(tip).toContainText("A measurement, not a forecast");
  await expect(page.locator(".forecast-credits")).toContainText(
    "Sea temperature: Marine Institute observations",
  );
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-sea-observed-1440.png",
  });
  expect(errors).toEqual([]);
});

test("a spot with no station in range falls back to the model's skin temperature", async ({
  page,
}) => {
  await withSeaTemperature(page, false);
  await withWaveColumns(page);

  // No observation, so the row is off: the model's skin temperature is an
  // approximation and does not earn a row on its own.
  await expect(page.locator('.weather-row[data-row="sea"]')).toHaveCount(0);
  await page.getByLabel("Display options", { exact: true }).click();
  const entry = page.locator('.filter-switch:has(input[data-row="sea"])');
  await expect(entry.locator("input")).toBeEnabled();
  await expect(entry.locator("input")).not.toBeChecked();
  await entry.locator("input").check();
  await page.getByLabel("Close display options").click();

  // Switched on, it is the weather model's own field again: one muted value per
  // column, and the row says which of the two sources it is showing.
  const sea = page.locator('.weather-row[data-row="sea"]');
  await expect(sea).toHaveClass(/weather-row/);
  await expect(sea).not.toHaveClass(/observed-row/);
  await expect(sea.locator("td.observed-cell")).toHaveCount(0);
  await expect(sea.locator("td.proxy-cell")).toHaveCount(2);
  await expect(sea.locator("td.proxy-cell").first()).toHaveAttribute(
    "title",
    /Model skin temperature .* No observation is in range/,
  );
  await page.getByRole("button", { name: "Sea temp", exact: true }).focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Model skin temperature, approximate");
  await expect(tip).toContainText("beyond the 60 km limit");
  await expect(page.locator(".forecast-credits")).not.toContainText(
    "Marine Institute observations",
  );
});

/**
 * A newer HARMONIE run: the bundled one is 13 UTC, this is the 16 UTC that
 * replaces it three hours later. It has frames of its own rather than a
 * relabelling of the committed ones, because a frame file carries its own run and
 * hour and is validated against the manifest that referenced it — which is
 * exactly the check that makes an atomic swap safe. The grid is the real one and
 * the wind is a flat field: this is a test of the swap, not of the weather.
 */
const NEWER_RUN = "2026091316";
const NEWER_RUN_TIME = "2026-09-13T16:00:00Z";
const NEWER_RUN_DIR = `weather/harmonie-${NEWER_RUN}-24h-test`;
const newerValidTime = (hour: number) =>
  new Date(Date.parse(NEWER_RUN_TIME) + hour * 3600000).toISOString();
const newerFrames = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => ({
  hour,
  validTime: newerValidTime(hour),
  // The fixture bundle publishes binary frames, and this synthetic newer run
  // inherits its `encoding`, so its frames must be binary too.
  url: `${NEWER_RUN_DIR}/${String(hour).padStart(3, "0")}.bin`,
  gustIntervalHours: null,
}));
const newerHarmonie = {
  ...harmonie,
  run: NEWER_RUN,
  runTime: NEWER_RUN_TIME,
  generatedAt: NEWER_RUN_TIME,
  frames: newerFrames,
  spotForecasts: Object.fromEntries(
    Object.keys(harmonie.spotForecasts as Record<string, unknown>).map(
      (spot) => [
        spot,
        newerFrames.map((frame, column) => ({
          hour: frame.hour,
          validTime: frame.validTime,
          u: 6 + column * 0.2,
          v: -4,
          gust: null,
        })),
      ],
    ),
  ),
};
const CELLS = harmonie.grid.width * harmonie.grid.height;
const newerFrame = (hour: number) => ({
  model: "harmonie",
  run: NEWER_RUN,
  hour,
  validTime: newerValidTime(hour),
  grid: harmonie.grid,
  gustIntervalHours: null,
  u: Array.from({ length: CELLS }, () => 6),
  v: Array.from({ length: CELLS }, () => -4),
  gust: null,
});
async function withNewerRunFrames(page: Page) {
  await page.route(`**/${NEWER_RUN_DIR}/*`, (route) => {
    const hour = Number(
      /(\d+)\.bin$/.exec(new URL(route.request().url()).pathname)?.[1] ?? -1,
    );
    return route.fulfill({
      body: encodeFrame(newerFrame(hour)),
      contentType: "application/octet-stream",
    });
  });
}

test("an open tab moves to a newer run and keeps the time it was showing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let published = harmonie;
  await withTides(page);
  await withNewerRunFrames(page);
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ json: published }),
  );
  // A controlled clock, so five minutes can pass without waiting for them.
  await page.clock.install({
    time: new Date(Date.parse(harmonie.runTime) + 8 * 3600000),
  });
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });

  // Step two columns off the opening hour, with the step buttons rather than the
  // scrubber: focus in the range input is itself a reason to defer a refresh.
  const slider = page.getByLabel("Forecast time", { exact: true });
  await page.getByLabel("Next forecast", { exact: true }).click();
  await page.getByLabel("Next forecast", { exact: true }).click();
  published = newerHarmonie;

  // A check that comes due with the scrubber under the reader's hand is put off,
  // not taken: the forecast must not move while they are reading along it.
  await slider.focus();
  await page.clock.fastForward("05:01");
  await expect(page.locator(".model-status")).toHaveCount(0);

  // Hands off, and a minute later the deferred check goes through.
  await page.getByLabel("Display options", { exact: true }).focus();
  const showing = (await slider.getAttribute("aria-valuetext"))!;
  const column = Number(await slider.inputValue());
  expect(column).toBeGreaterThan(0);
  await page.clock.fastForward("01:00");

  // The notice names the new run, unobtrusively, in the model-message strip.
  const status = page.locator(".model-status");
  await expect(status).toContainText("Updated to the 16:00 UTC run", {
    timeout: 20000,
  });
  await expect(page.locator(".model-status.is-error")).toHaveCount(0);

  // The reader keeps the valid time they were reading. It is one column further
  // left, because the newer run starts three hours later than the old one.
  await expect(slider).toHaveAttribute("aria-valuetext", showing);
  expect(Number(await slider.inputValue())).toBe(column - 1);
  await expect(page.locator(".forecast-now")).toHaveCount(1);
  await expect(page.locator(".blend-chart")).toBeVisible();

  // And it really is the new run that is on screen now.
  await page.locator(".model-info").click();
  await expect(page.locator("dialog.info-dialog")).toContainText(
    "16:00:00 GMT",
  );
  expect(errors).toEqual([]);
});

test("a failed background check leaves the forecast alone and says nothing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let broken = false;
  await withTides(page);
  await page.route("**/weather/harmonie.json", (route) =>
    broken
      ? route.fulfill({ status: 503, body: "Gone" })
      : route.fulfill({ json: harmonie }),
  );
  await page.clock.install({
    time: new Date(Date.parse(harmonie.runTime) + 8 * 3600000),
  });
  await page.goto("/");
  await expect(page.locator(".blend-chart")).toBeVisible({ timeout: 30000 });
  const showing = (await page
    .getByLabel("Forecast time", { exact: true })
    .getAttribute("aria-valuetext"))!;

  broken = true;
  await page.clock.fastForward("05:01");
  await page.clock.fastForward("05:01");

  // Nothing is said and nothing moves: the run already on screen is still it.
  await expect(page.locator(".model-status")).toHaveCount(0);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  await expect(
    page.getByLabel("Forecast time", { exact: true }),
  ).toHaveAttribute("aria-valuetext", showing);
  await expect(page.locator(".blend-chart")).toBeVisible();
  expect(errors).toEqual([]);
});
