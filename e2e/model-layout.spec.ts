import { barReady, chooseModel, expect, test, type Page } from "./fixtures";

/** Where the scrub bar and the boxes over the chart stand, to a tenth of a pixel. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    };
    return {
      footer: rect(".map-footer"),
      bar: rect(".scrub"),
      strip: rect(".scrub .sb-strip"),
      head: rect("[data-top-bar]"),
      controls: rect(".zbox"),
      print: rect(".map-print .info-i"),
    };
  });

for (const width of [320, 390, 820, 1440]) {
  test(`every model keeps the same scrub bar geometry at ${width}px`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-13T21:00:00Z"));
    await page.setViewportSize({ width, height: 900 });
    // A spot's week: Brandon Bay, chosen last.
    await page.goto("/?spot=brandon");
    await barReady(page);
    await page.evaluate(() => document.fonts.ready);
    const baseline = await geometry(page);
    for (const model of ["icon-eu", "ecmwf", "harmonie"]) {
      await chooseModel(page, model);
      await expect.poll(() => geometry(page)).toEqual(baseline);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
    // To the strip's end, where the hours are coarser: the bar stands still.
    await page.getByRole("slider", { name: "Forecast time" }).press("End");
    await expect.poll(() => geometry(page)).toEqual(baseline);
  });
}
