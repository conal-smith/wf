import {
  chooseModel,
  closePanel,
  expect,
  modelChoice,
  openFromMenu,
  test,
} from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleColumnsWithoutEcmwf, stripAt } from "./columns";

const ecmwf = readSample("ecmwf");

test("ECMWF on the map follows the strip's mixed cadence on a phone, and hands back to HARMONIE", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const clock = Date.parse(ecmwf.runTime) + 14 * 3600000;
  await page.clock.setFixedTime(new Date(clock));
  // A spot in the link, so the dock shows the strip.
  await page.goto("/?spot=brandon");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await chooseModel(page, "ecmwf");
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
    (c, i) =>
      i > 0 &&
      c.time - strip[i - 1].time >= 3 * 3600000 &&
      c.date === strip[i - 1].date,
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
  await expect(page.getByRole("button", { name: /on the map$/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  // Back to HARMONIE: it does not reach the hour, so the map hands it to
  // ECMWF, says so, and keeps HARMONIE as the reader's choice.
  await chooseModel(page, "harmonie");
  await expect(slider).toHaveValue(String(strip.length - 1));
  await expect(page.locator(".map-model")).toHaveAttribute(
    "data-reach",
    "handover",
  );
  // On a phone the label is the short form; the rest is for a screen reader.
  await expect(page.locator(".map-model")).toHaveText(
    /^ECMWF on the map from \w{3} \d\d:\d\d( · older run)?$/,
  );
  await expect(page.locator(".particle-canvas")).not.toHaveClass(/is-blank/);
  await expect(page.getByRole("button", { name: /on the map$/ })).toHaveCount(
    0,
  );
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
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  // Without ECMWF the long range falls to GFS, and the strip says so.
  await expect(page.locator(".dock tr.tt-hour td[data-i]")).toHaveCount(
    stripAt(SAMPLE_CLOCK.getTime(), sampleColumnsWithoutEcmwf).length,
  );
  for (const next of [null, { ...ecmwf, model: "wrong" }]) {
    body = next;
    await openFromMenu(page, "Display options");
    await modelChoice(page, "ecmwf").click();
    await expect(page.locator(".frame-status.is-error")).toBeVisible();
    await expect(modelChoice(page, "harmonie")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await closePanel(page);
    await page.getByRole("button", { name: "Dismiss" }).click();
  }
});

test("the chart pans out over the Atlantic as far as ECMWF reaches, and a smaller model there draws nothing, without failing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?map");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await chooseModel(page, "ecmwf");
  await expect(page.locator(".map-model")).toContainText("ECMWF");
  // Out as far as the chart goes, then west as far as it goes, by the keys
  // the chart's canvas takes.
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (let i = 0; i < 4; i++) {
    await zoomOut.click();
    await page.waitForTimeout(400);
  }
  await page.locator(".maplibregl-canvas").focus();
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
  }
  // The neatline names the meridians at least 400 px in from either edge
  // (force5/src/neatline.ts). The chart used to stop at 18° W, which kept
  // every label east of about 12° W; ECMWF's box reaches 30° W.
  const westmost = () =>
    page
      .locator(".nl-t")
      .allTextContents()
      .then((labels) =>
        Math.max(
          ...labels
            .filter((label) => label.endsWith("W"))
            .map((label) => parseInt(label, 10)),
        ),
      );
  await expect.poll(westmost, { timeout: 10000 }).toBeGreaterThanOrEqual(20);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  // HARMONIE out here: its box is behind the view, so it draws nothing in
  // most of it, and says nothing is wrong.
  await chooseModel(page, "harmonie");
  await expect(page.locator(".map-model")).toContainText("HARMONIE");
  await page.waitForTimeout(1500);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  expect(await westmost()).toBeGreaterThanOrEqual(20);
});
