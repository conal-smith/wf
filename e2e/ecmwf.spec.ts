import { expect, test } from "./fixtures";
import { readSample } from "./sample";
import {
  SAMPLE_CLOCK,
  sampleColumn,
  sampleColumns,
  sampleColumnsWithoutEcmwf,
} from "./columns";

const ecmwf = readSample("ecmwf");
const harmonie = readSample("harmonie");

test("ECMWF 15-day mobile outlook follows mixed-cadence scrubbing and returns to HARMONIE", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // An hour into HARMONIE's run, so the axis is the one `sampleColumns`
  // describes: the near run already covers now, so it opens the axis and there
  // is no head. ECMWF's own run is fourteen hours old here, still current.
  await page.clock.setFixedTime(
    new Date(Date.parse(ecmwf.runTime) + 14 * 3600000),
  );
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  const model = page.locator('[data-model="ecmwf"]');
  await expect(model).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await model.click();
  await expect(model).toHaveAttribute("aria-pressed", "true");
  // The gust semantics this test is about are the table view's cells. The
  // dock's columns come from every manifest, not from the map, so putting
  // ECMWF on the map does not change how many of them there are.
  await page.locator('[data-view="table"]').click();
  await expect(page.locator(".wind-cell")).toHaveCount(sampleColumns.length);
  // A gust window is the answering run's own: ECMWF is on the map and reaches
  // every column, and its short window runs an hour, widening to three past
  // +90 h.
  await expect(
    page.locator(".gust-cell").nth(sampleColumn("2026-09-16T06:00:00Z")),
  ).toHaveAttribute("title", /Maximum gust over 1 hour:/);
  await expect(
    page.locator(".gust-cell").nth(sampleColumn("2026-09-17T00:00:00Z")),
  ).toHaveAttribute("title", /Maximum gust over 3 hours:/);
  const last = sampleColumns.length - 1;
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toHaveAttribute("max", String(last));
  // The column where the axis turns from three-hourly to six-hourly.
  const widens = sampleColumn("2026-09-19T00:00:00Z");
  await slider.fill(String(widens));
  await expect(
    page.locator(`[data-forecast-index="${widens}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(widens + 1));
  await expect(
    page.locator(`[data-forecast-index="${widens + 1}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue(String(widens));
  await slider.press("End");
  await expect(slider).toHaveValue(String(last));
  const selected = page.locator(`[data-forecast-index="${last}"]`);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  const rect = await selected.boundingBox();
  expect(rect!.x).toBeGreaterThan(75);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  const expected = ecmwf.spotForecasts.brandon[84];
  await expect(page.locator(".wind-cell").last()).toHaveText(
    String(Math.round(Math.hypot(expected.u, expected.v) * 1.94384449)),
  );
  await expect(page.locator(".gust-cell").last()).toHaveText(
    String(Math.round(expected.gust * 1.94384449)),
  );
  await expect(page.locator(".gust-cell").last()).toHaveAttribute(
    "title",
    /Maximum gust over 6 hours/,
  );
  await expect(
    page.getByRole("button", {
      name: `Brandon Bay, ${Math.round(Math.hypot(expected.u, expected.v) * 1.94384449)} kn`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(slider).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator(".site-footer")).toContainText(
    "Long-range outlook",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "test-results/ecmwf-day15-mobile.png" });
  await page.clock.setFixedTime(
    new Date(Date.parse(ecmwf.runTime) + 19 * 3600000),
  );
  await slider.press("ArrowLeft");
  await slider.press("End");
  await expect(page.locator(".site-footer")).toHaveText(
    "Older run · long-range outlook",
  );
  await page.getByRole("button", { name: "Forecast data and sources" }).click();
  await expect(page.locator("dialog")).toContainText(
    "ECMWF shaped sample bundle",
  );
  await expect(page.locator("dialog")).toContainText("6-hourly through day 15");
  await page.getByLabel("Close forecast information").click();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="harmonie"]').click();
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The columns do not move with the map; only the selection does, back to the
  // last hour HARMONIE reaches.
  await expect(slider).toHaveValue(
    String(sampleColumn(harmonie.frames.at(-1)!.validTime)),
  );
  await expect(page.locator(".wind-cell")).toHaveCount(sampleColumns.length);
  // HARMONIE answers the columns it reaches, and its sample run has no gust.
  await expect(page.locator(".gust-cell").first()).toHaveText("—");
  // Past its range the columns are still filled, from the run that owns them.
  await expect(page.locator(".wind-cell").last()).not.toHaveText("—");
});

test("unavailable or mislabelled ECMWF snapshot preserves the current model", async ({
  page,
}) => {
  // Routed before the load: the dock warms every manifest on open, and a
  // manifest already in the five-minute cache would never be refetched.
  let body: unknown = null;
  await page.route("**/weather/ecmwf.json", (route) =>
    body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.clock.setFixedTime(SAMPLE_CLOCK);
  await page.goto("/");
  const model = page.locator('[data-model="ecmwf"]');
  await expect(model).toBeEnabled({ timeout: 30000 });
  await page.locator('[data-view="table"]').click();
  for (const next of [null, { ...ecmwf, model: "wrong" }]) {
    body = next;
    await page.route("**/weather/unused-ecmwf.json", (route) =>
      body
        ? route.fulfill({ json: body })
        : route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.getByLabel("Choose forecast model", { exact: true }).click();
    await model.click();
    await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".model-status.is-error")).toBeVisible();
    // ECMWF is missing, so the long range falls to AIFS, the next run that
    // reaches furthest; the columns stay put through both failed switches.
    await expect(page.locator(".wind-cell")).toHaveCount(
      sampleColumnsWithoutEcmwf.length,
    );
    await page.unroute("**/weather/unused-ecmwf.json");
  }
});
