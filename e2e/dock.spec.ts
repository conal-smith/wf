import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

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
  // Sea and air temperature have no adapter at all yet, and say so.
  for (const row of ["sea", "air"]) {
    const entry = page.locator(`.filter-switch:has(input[data-row="${row}"])`);
    await expect(entry.locator("input")).toBeDisabled();
    await expect(entry).toContainText("no source yet");
  }
  // Waves do have one now, so the block survives the tides going missing.
  await expect(
    page.locator('.filter-switch:has(input[data-row="waves"]) input'),
  ).toBeEnabled();
  await expect(page.locator(".tide-row")).toHaveCount(0);
  await expect(page.locator('.wave-row[data-row="waves"]')).toHaveCount(1);
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
  expect(dock.height).toBeLessThan(320);
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-blend-390.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".dock-views button > span").first()).toBeVisible();
  const wide = (await page.locator(".map-footer").boundingBox())!;
  expect(wide.height).toBeLessThan(380);
  await page.locator(".map-footer").screenshot({
    path: "test-results/dock-blend-1440.png",
  });
});

/**
 * The bundled GFS-Wave run is 2026-09-16 18 UTC, +0 to +9 h. HARMONIE's bundled
 * run ends on 16 September at 01 UTC, so the dock's columns — which are the
 * selected wind model's own forecast times — have to come from a model that
 * reaches the wave hours. GFS runs from 16 September 12 UTC to 21 September.
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
  // Height in metres to one decimal; the run hour reads 0.66 m at 9.51 s.
  await expect(row.locator(".wave-cell b").first()).toHaveText("0.7");
  await expect(row.locator(".wave-cell small").first()).toHaveText("10s");
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
