import { expect, rememberSpot, test } from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleColumnsWithoutEcmwf, stripAt } from "./columns";

const ecmwf = readSample("ecmwf");

test("ECMWF on the map follows the strip's mixed cadence on a phone, and hands back to HARMONIE", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const clock = Date.parse(ecmwf.runTime) + 14 * 3600000;
  await page.clock.setFixedTime(new Date(clock));
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(141, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  await layers.click();
  await page.locator('[data-model="ecmwf"]').click();
  await expect(page.locator('[data-model="ecmwf"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await layers.click();
  await expect(page.locator(".map-model")).toContainText("ECMWF");
  // Hourly where HARMONIE reaches, ECMWF's own three- and six-hourly steps after.
  const strip = stripAt(clock);
  const hours = page.locator(".dock tr.tt-hour td[data-i]");
  await expect(hours).toHaveCount(strip.length);
  const steps = strip
    .slice(1)
    .map((c, i) => (c.time - strip[i].time) / 3600000)
    .filter((h) => h < 12);
  expect(Math.min(...steps)).toBe(1);
  expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toHaveAttribute("max", String(strip.length - 1));
  // Step across the seam with the keys, and to the end.
  const seam = strip.findIndex(
    (c, i) => i > 0 && c.time - strip[i - 1].time >= 3 * 3600000 && c.date === strip[i - 1].date,
  );
  await slider.fill(String(seam));
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue(String(seam + 1));
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue(String(seam));
  await slider.press("End");
  await expect(slider).toHaveValue(String(strip.length - 1));
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${strip.length - 1}"]`),
  ).toHaveClass(/c-sel/);
  // ECMWF reaches the end: nothing to offer, nothing failing.
  await expect(page.getByRole("button", { name: /on the map$/ })).toHaveCount(0);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  // Back to HARMONIE: the map keeps its last frame there, and the chip offers
  // the run that reaches the hour.
  await layers.click();
  await page.locator('[data-model="harmonie"]').click();
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await layers.click();
  await expect(slider).toHaveValue(String(strip.length - 1));
  await expect(
    page.getByRole("button", { name: /Show ECMWF on the map/ }),
  ).toBeVisible();
});

test("an unavailable or mislabelled ECMWF snapshot leaves the map as it was", async ({
  page,
}) => {
  let body: unknown = null;
  // No published blend either: its columns would still carry ECMWF's run, and
  // this is the dock building its own from the manifests it could read.
  await page.route("**/weather/blend.json", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  await page.route("**/weather/ecmwf.json", (route) =>
    body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.clock.setFixedTime(SAMPLE_CLOCK);
  // A spot's dock, so its rows are there to read: Brandon Bay, chosen last.
  await rememberSpot(page, "brandon");
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({ timeout: 30000 });
  // Without ECMWF the long range falls to GFS, and the strip says so.
  await expect(page.locator(".dock tr.tt-hour td[data-i]")).toHaveCount(
    stripAt(SAMPLE_CLOCK.getTime(), sampleColumnsWithoutEcmwf).length,
  );
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  for (const next of [null, { ...ecmwf, model: "wrong" }]) {
    body = next;
    await layers.click();
    await page.locator('[data-model="ecmwf"]').click();
    await expect(page.locator(".frame-status.is-error")).toBeVisible();
    await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Dismiss" }).click();
  }
});
