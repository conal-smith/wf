import { expect, steadyFrames, test } from "./fixtures";

for (const width of [390, 1440]) {
  test(`the popup opens on a light, fits between the boxes, and closes on its own at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(146, {
      timeout: 30000,
    });
    await expect(page.locator(".spot-card")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Find a spot" }).fill("Blast");
    await page.locator(".spot-row").click();
    const popup = page.getByRole("dialog", { name: /Kilcrea.*at a glance/ });
    await expect(popup).toBeVisible();
    // A few figures and glyphs: the hour, its stars, the wind and the wing.
    await expect(popup).toContainText("Dublin");
    await expect(popup.locator(".sc-when .when")).toHaveText(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d$/,
    );
    await expect(popup.getByRole("link", { name: "How the stars work" })).toHaveAttribute(
      "href",
      "/stars",
    );
    await expect(popup.getByRole("link", { name: "Spot page →" })).toHaveAttribute(
      "href",
      "/spot/kilcrea",
    );
    await expect(
      popup.getByRole("button", { name: "Star Kilcrea — Malahide Estuary" }),
    ).toHaveAttribute("aria-pressed", "false");
    // Between the head and the dock, once the flight there has landed.
    await expect
      .poll(async () => {
        const card = (await popup.boundingBox())!;
        const dock = (await page.locator(".map-footer").boundingBox())!;
        return (
          card.x >= 0 &&
          card.x + card.width <= width &&
          card.y >= 0 &&
          card.y + card.height <= dock.y
        );
      })
      .toBe(true);
    // The reader can pan away: the card is fitted once, then goes with the map.
    const pin = page.locator('[data-spot-id="kilcrea"]');
    const restingX = async () => {
      let last = Number.NaN;
      await expect
        .poll(
          async () => {
            const x = (await pin.boundingBox())!.x;
            const same = Math.abs(x - last) < 0.5;
            last = x;
            return same;
          },
          { intervals: [250, 250, 250, 250, 250, 250, 250, 250] },
        )
        .toBe(true);
      return last;
    };
    await steadyFrames(page);
    const before = await restingX();
    await page.locator(".maplibregl-canvas").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Math.abs((await pin.boundingBox())!.x - before))
      .toBeGreaterThan(80);
    expect(Math.abs((await restingX()) - before)).toBeGreaterThan(80);
    await expect(popup).toBeVisible();
    // The hour moves; the card stays and reads the new hour.
    const was = await popup.locator(".sc-when .when").textContent();
    await page.getByRole("slider", { name: "Forecast time" }).fill("10");
    await expect(popup).toBeVisible();
    await expect(popup.locator(".sc-when .when")).not.toHaveText(was!);
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    // A light opens it again, by key as by tap.
    await pin.focus();
    await pin.press("Enter");
    await expect(popup).toBeVisible();
    await popup.getByRole("button", { name: "Close spot information" }).click();
    await expect(popup).toHaveCount(0);
    // Another spot takes its place.
    await page.getByRole("combobox", { name: "Find a spot" }).fill("Dollymount");
    await page.locator(".spot-row").click();
    await expect(page.locator(".spot-card")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "Dollymount at a glance" }),
    ).toBeVisible();
  });
}
