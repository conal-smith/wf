import { expect, test, type Page } from "./fixtures";
import { readSample } from "./sample";

const harmonie = readSample("harmonie");
const ecmwf = readSample("ecmwf");

/** Where the Now line sits relative to the centres of two named columns. */
async function relativePosition(page: Page, columns: [number, number]) {
  return page.locator(".forecast-now").evaluate((line, [first, second]) => {
    const parent = line.closest(".forecast-content")!;
    const centre = (i: number) => {
      const r = parent
        .querySelector(`[data-forecast-index="${i}"]`)!
        .closest("th")!
        .getBoundingClientRect();
      return r.left + r.width / 2;
    };
    return {
      line: line.getBoundingClientRect().left,
      a: centre(first),
      b: centre(second),
    };
  }, columns);
}

test("Now opens centred between timestamps and remains independent of scrubbing", async ({
  page,
}) => {
  // Half past the hour, so the line sits midway between two hourly columns.
  const now = new Date(Date.parse(harmonie.runTime) + 7.5 * 3600000);
  await page.clock.setFixedTime(now);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const line = page.getByRole("img", { name: /^Now:/ });
  await expect(line).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  // HARMONIE already covers now, so the axis opens on its own first hour and
  // +7 h is column seven, which is where the opening selection lands.
  await expect(slider).toHaveValue("7");
  await expect
    .poll(async () => {
      const p = await relativePosition(page, [7, 8]);
      return Math.abs(p.line - (p.a + p.b) / 2);
    })
    .toBeLessThan(1);
  const bounds = await line.boundingBox();
  expect(bounds!.x).toBeGreaterThan(100);
  expect(bounds!.x).toBeLessThan(365);
  const originalLeft = await line.evaluate(
    (el) => (el as HTMLElement).style.left,
  );
  await slider.fill("20");
  await expect(page.locator('[data-forecast-index="20"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(line).toHaveAttribute("data-time", now.toISOString());
  expect(await line.evaluate((el) => (el as HTMLElement).style.left)).toBe(
    originalLeft,
  );

  const before = await page
    .locator(".forecast-scroll")
    .evaluate((el) => el.scrollLeft);
  await page.clock.setFixedTime(new Date(now.getTime() + 30 * 60000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(line).toHaveAttribute(
    "data-time",
    new Date(now.getTime() + 30 * 60000).toISOString(),
  );
  await expect(slider).toHaveValue("20");
  expect(
    await page.locator(".forecast-scroll").evaluate((el) => el.scrollLeft),
  ).toBe(before);
  expect(
    parseFloat(await line.evaluate((el) => (el as HTMLElement).style.left)),
  ).toBeGreaterThan(parseFloat(originalLeft));
  await slider.fill("2");
  await page.setViewportSize({ width: 760, height: 844 });
  // The clock is now exactly +8 h, which is a published hour: the line lands on
  // that column's centre however the dock is resized around it.
  await expect
    .poll(async () => {
      const p = await relativePosition(page, [8, 9]);
      return Math.abs(p.line - p.a);
    })
    .toBeLessThan(1);
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/forecast-now-mobile.png" });
});

test("Now uses the dock's own column times and disappears past them", async ({
  page,
}) => {
  const now = new Date(Date.parse(ecmwf.runTime) + 147 * 3600000);
  await page.clock.setFixedTime(now);
  await page.goto("/");
  await expect(page.locator('[data-model="ecmwf"]')).toBeEnabled({
    timeout: 30000,
  });
  // HARMONIE's run expired two days ago, so it owns no column any more and the
  // dock's axis is ECMWF's. The Now line follows the columns, not the map, so
  // it is there before the reader switches the map to ECMWF as well.
  await expect(page.locator(".forecast-now")).toHaveCount(1);
  // And the dead run answers no cell: the band names ECMWF the whole way, and
  // every column carries a value, none of them from a forecast that has been
  // and gone.
  const band = page.locator(".forecast-model-band th[scope=colgroup]");
  await expect(band).toHaveCount(1);
  await expect(band).toContainText("ECMWF");
  await expect(band).not.toContainText("HARMONIE");
  await page.locator('[data-view="table"]').click();
  const wind = await page
    .locator(".forecast-table .wind-cell")
    .allTextContents();
  expect(wind).toHaveLength(ecmwf.frames.length);
  expect(wind.filter((text) => text === "\u2014")).toHaveLength(0);
  await page.locator('[data-view="blend"]').click();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="ecmwf"]').click();
  await expect(page.locator('[data-model="ecmwf"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".forecast-now")).toHaveCount(1);
  expect(
    await page.locator(".forecast-now").evaluate((line) => {
      const parent = line.closest(".forecast-content")!;
      const centres = [48, 49].map((i) => {
        const r = parent
          .querySelector(`[data-forecast-index="${i}"]`)!
          .closest("th")!
          .getBoundingClientRect();
        return r.left + r.width / 2;
      });
      return Math.abs(
        line.getBoundingClientRect().left - (centres[0] + centres[1]) / 2,
      );
    }),
  ).toBeLessThan(1);
  await page.clock.setFixedTime(
    new Date(Date.parse(ecmwf.runTime) + 361 * 3600000),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".forecast-now")).toHaveCount(0);
});
