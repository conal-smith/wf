import { expect, test, unfoldTools } from "./fixtures";

for (const width of [390, 1440]) {
  test(`a light opens its spot in the dock, with no box over the map, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    await page.getByRole("combobox", { name: "Find a spot" }).fill("Blast");
    await page.locator(".spot-row").click();
    const pin = page.locator('[data-spot-id="kilcrea"]');
    await expect(pin).toHaveClass(/\bsel\b/);
    // The dock has the spot: its name, its star and the way to its page.
    const dock = page.locator(".dock");
    await expect(dock.locator(".dk-name")).toHaveText(
      "Kilcrea — Malahide Estuary",
    );
    await unfoldTools(page);
    await expect(
      dock.getByRole("button", { name: "Star Kilcrea — Malahide Estuary" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(dock.getByRole("link", { name: "Spot page" })).toHaveAttribute(
      "href",
      "/spot/kilcrea",
    );
    // And nothing is hung on the light over the chart.
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The hour moves; still no box.
    await page.getByRole("slider", { name: "Forecast time" }).fill("10");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Escape clears the focus; a light chooses the spot again, by key as by tap.
    await page.keyboard.press("Escape");
    await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
    await pin.focus();
    await pin.press("Enter");
    await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    // Another spot takes its place in the dock.
    await page.getByRole("combobox", { name: "Find a spot" }).fill("Dollymount");
    await page.locator(".spot-row").click();
    await expect(dock.locator(".dk-name")).toHaveText("Dollymount");
    await expect(page.locator('[data-spot-id="dollymount"]')).toHaveClass(
      /\bsel\b/,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
