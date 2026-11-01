import {
  chooseModel,
  closeSettings,
  expect,
  modelChoice,
  openFromMenu,
  saveSettings,
  test,
  barReady,
  timeSlider,
} from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleColumnsWithoutEcmwf, stripAt } from "./columns";
import { timeSpoken } from "../src/strip";

const ecmwf = readSample("ecmwf");

test("ECMWF on the map follows the strip's mixed cadence on a phone, and hands back to HARMONIE", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const clock = Date.parse(ecmwf.runTime) + 14 * 3600000;
  await page.clock.setFixedTime(new Date(clock));
  // A spot in the link, so the scrub bar draws its week.
  await page.goto("/?spot=brandon");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await chooseModel(page, "ecmwf");
  await expect(page.locator(".map-model")).toContainText("ECMWF");
  // Hourly where HARMONIE reaches, ECMWF's own three- and six-hourly steps after.
  const strip = stripAt(clock);
  const steps = strip
    .slice(1)
    .map((c, i) => (c.time - strip[i].time) / 3600000)
    .filter((h) => h < 12);
  expect(Math.min(...steps)).toBe(1);
  expect(Math.max(...steps)).toBeGreaterThanOrEqual(3);
  const slider = timeSlider(page);
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
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    timeSpoken(strip[strip.length - 1].time),
  );
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
  // this is the strip built from the manifests the page could read.
  await page.route("**/weather/blend.json", (route) =>
    route.fulfill({ status: 404, body: "Not found" }),
  );
  await page.route("**/weather/ecmwf.json", (route) =>
    body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.clock.setFixedTime(SAMPLE_CLOCK);
  // A spot's week in the scrub bar, so its hours are in: Brandon Bay.
  await page.goto("/?spot=brandon");
  await barReady(page);
  // Without ECMWF the long range falls to GFS, and the strip says so.
  await expect(timeSlider(page)).toHaveAttribute(
    "max",
    String(
      stripAt(SAMPLE_CLOCK.getTime(), sampleColumnsWithoutEcmwf).length - 1,
    ),
  );
  for (const next of [null, { ...ecmwf, model: "wrong" }]) {
    body = next;
    await openFromMenu(page, "Settings");
    await modelChoice(page, "ecmwf").click();
    await saveSettings(page);
    await expect(page.locator(".frame-status.is-error")).toBeVisible();
    // Asked, not had: the rider is back on HARMONIE.
    await openFromMenu(page, "Settings");
    await expect(modelChoice(page, "harmonie")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await closeSettings(page);
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
  // The chart pans well out past 18° W, where it used to stop: ECMWF's box
  // reaches 30° W. The centre the chart keeps for the spot finder says where
  // it stands (src/lastView.ts). Zoomed all the way out the chart is about
  // 32° of longitude across at this width, so the centre goes no further
  // west than about 14° W, with 30° W at the chart's edge; stopped at 18° W,
  // it went no further than about 2° W.
  const centreLon = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("wingfoil.map.centre.v1") ?? "{}")
          .lon as number,
    );
  await expect.poll(centreLon, { timeout: 10000 }).toBeLessThan(-12);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  // HARMONIE out here: its box is behind the view, so it draws nothing in
  // most of it, and says nothing is wrong.
  await chooseModel(page, "harmonie");
  await expect(page.locator(".map-model")).toContainText("HARMONIE");
  await page.waitForTimeout(1500);
  await expect(page.locator(".frame-status.is-error")).toHaveCount(0);
  expect(await centreLon()).toBeLessThan(-12);
});
