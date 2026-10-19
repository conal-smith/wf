import { expect, test, type Page } from "./fixtures";

/** Where the dock and the boxes over the chart stand, to a tenth of a pixel. */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    };
    return {
      dock: rect(".map-footer"),
      head: rect(".map-head"),
      controls: rect(".zbox"),
      print: rect(".map-print .info-i"),
      columnWidth: document
        .querySelector(".dock tr.tt-hour td[data-i]")!
        .getBoundingClientRect().width,
    };
  });

for (const width of [320, 390, 820, 1440]) {
  test(`every model keeps the same dock geometry at ${width}px`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-13T21:00:00Z"));
    await page.setViewportSize({ width, height: 900 });
    // A spot's dock: Brandon Bay, chosen last.
    await page.goto("/?spot=brandon");
    await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
      timeout: 30000,
    });
    await page.evaluate(() => document.fonts.ready);
    const baseline = await geometry(page);
    for (const model of ["icon-eu", "ecmwf", "harmonie"]) {
      const layers = page.getByRole("button", { name: "Layers", exact: true });
      await layers.click();
      await page.locator(`[data-model="${model}"]`).click();
      await expect(page.locator(`[data-model="${model}"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await layers.click();
      await expect.poll(() => geometry(page)).toEqual(baseline);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    }
    // To the strip's end, where the hours are coarser: the same column width.
    await page.getByRole("slider", { name: "Forecast time" }).press("End");
    await expect.poll(() => geometry(page)).toEqual(baseline);
  });
}
