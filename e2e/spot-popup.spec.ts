import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`spot popout opens, follows selection, and closes independently at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(25, {
      timeout: 30000,
    });
    await expect(page.locator(".spot-popout-card")).toHaveCount(0);
    await page.getByLabel("Open spot search").click();
    await page.getByRole("searchbox").fill("Blast");
    await page.locator(".spot-row").click();
    const popup = page.getByRole("dialog", { name: /Kilcrea.*information/ });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("Spot · Dublin");
    await expect(popup).toContainText("Kilcrea Road");
    await expect(popup).toContainText("53.46908, -6.17555");
    await expect(popup.getByRole("link", { name: "Website" })).toHaveCount(0);
    await expect(popup.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      /10816824305/,
    );
    await expect(page.locator(".sheet-loading")).toHaveCount(0, {
      timeout: 30000,
    });
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
    // The reader can pan away from the spot: the popout is fitted once, when
    // the camera that opened it lands, and never re-clamped afterwards.
    const pin = page.locator('[data-spot-id="kilcrea"]');
    const pinBefore = (await pin.boundingBox())!.x;
    // The keyboard pan is a reader's gesture like any other, and it lands
    // wherever the markers happen to be.
    await page.locator(".maplibregl-canvas").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // The map really moved — and stays moved. Nothing pans it back to put the
    // card where it was, which is what a refit after every move used to do.
    await expect
      .poll(async () => Math.abs((await pin.boundingBox())!.x - pinBefore))
      .toBeGreaterThan(80);
    let resting = Number.NaN;
    await expect
      .poll(async () => {
        const x = (await pin.boundingBox())!.x;
        const same = Math.abs(x - resting) < 0.5;
        resting = x;
        return same;
      })
      .toBe(true);
    expect(Math.abs(resting - pinBefore)).toBeGreaterThan(80);
    await expect(popup).toBeVisible();
    await page.getByRole("slider", { name: "Forecast time" }).fill("10");
    await expect(popup).toBeVisible();
    await page.screenshot({ path: `test-results/spot-popup-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(page.locator(".forecast-sheet")).toBeVisible();
    const marker = page.locator('[data-spot-id="kilcrea"]');
    await expect(marker).toBeFocused();
    await marker.press("Enter");
    await expect(popup).toBeVisible();
    await page.getByLabel("Close spot information").click();
    await expect(popup).toHaveCount(0);
    await marker.click();
    await expect(popup).toBeVisible();
    await page.getByLabel("Open spot search").click();
    await page.getByRole("searchbox").fill("Dollymount");
    await page.locator(".spot-row").click();
    await expect(page.locator(".spot-popout-card")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "Dollymount information" }),
    ).toContainText("Dublin Bay");
    await expect(popup).toHaveCount(0);
    await page.getByLabel("Layers", { exact: true }).click();
    await page.getByLabel("Wind-sport locations", { exact: true }).uncheck();
    await expect(page.locator(".spot-popout-card")).toHaveCount(0);
    await page.getByLabel("Wind-sport locations", { exact: true }).check();
    await expect(page.locator(".spot-popout-card")).toHaveCount(0);
  });
}
