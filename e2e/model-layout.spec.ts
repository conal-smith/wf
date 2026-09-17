import { expect, test } from "@playwright/test";
import { sampleColumn, sampleColumns } from "./columns";

for (const width of [320, 390, 820, 1440]) {
  test(`all models keep the same dock geometry at ${width}px`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-13T21:00:00Z"));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator('[data-model="harmonie"]')).toBeEnabled({
      timeout: 30000,
    });
    await page.evaluate(() => document.fonts.ready);
    const geometry = () =>
      page.evaluate(() => {
        const rect = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height].map(
            (v) => Math.round(v * 10) / 10,
          );
        };
        return {
          dock: rect(".map-footer"),
          picker: rect(".map-model-picker"),
          play: rect(".play-button"),
          info: rect(".model-info"),
          columnWidth: document
            .querySelector('[data-forecast-index="0"]')!
            .closest("th")!
            .getBoundingClientRect().width,
        };
      });
    const baseline = await geometry();
    for (const model of ["icon-eu", "ecmwf", "harmonie"]) {
      await page.getByLabel("Choose forecast model", { exact: true }).click();
      await page.locator(`[data-model="${model}"]`).click();
      await expect(page.locator(`[data-model="${model}"]`)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect.poll(geometry).toEqual(baseline);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      if (width === 390)
        await page
          .locator(".map-footer")
          .screenshot({ path: `test-results/layout-${model}-mobile.png` });
    }
    await page.getByLabel("Choose forecast model", { exact: true }).click();
    await page.locator('[data-model="ecmwf"]').click();
    await expect(page.locator('[data-model="ecmwf"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const last = sampleColumns.length - 1;
    await page
      .getByRole("slider", { name: "Forecast time" })
      .fill(String(last));
    await expect(
      page.locator(`[data-forecast-index="${last}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".site-footer")).toContainText(
      "long-range outlook",
    );
    await expect.poll(geometry).toEqual(baseline);
    // Past day six the axis is six-hourly and those columns keep twice the room.
    const lateWidth = await page
      .locator(
        `[data-forecast-index="${sampleColumn("2026-09-19T06:00:00Z")}"]`,
      )
      .evaluate((el) => el.closest("th")!.getBoundingClientRect().width);
    expect(lateWidth).toBeCloseTo(baseline.columnWidth * 2, 0);
  });
}
