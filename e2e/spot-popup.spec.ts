import { barName, expect, scrubBar, test, timeSlider } from "./fixtures";

for (const width of [390, 1440]) {
  test(`a light opens its spot in the scrub bar, with no box over the map, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?map");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    const opener = page.locator("[data-spot-search-open]");
    if (await opener.isVisible()) await opener.click();
    await page.getByRole("combobox", { name: "Search spots" }).fill("Blast");
    await page.locator("[data-spot-option]").click();
    const pin = page.locator('[data-spot-id="kilcrea"]');
    await expect(pin).toHaveClass(/\bsel\b/);
    // The scrub bar has the spot: its name and the way to its page, opened
    // at the hour in hand.
    const bar = scrubBar(page);
    await expect(bar).toHaveAttribute("data-spot", "kilcrea");
    await expect(barName(page)).toHaveText("Kilcrea — Malahide Estuary");
    await expect(
      bar.getByRole("link", { name: "Full forecast", exact: true }),
    ).toHaveAttribute("href", /^\/spot\/kilcrea\?at=/);
    // And nothing is hung on the light over the chart.
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The hour moves; still no box.
    await timeSlider(page).fill("10");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Escape clears the focus; a light chooses the spot again, by key as by tap.
    await page.keyboard.press("Escape");
    await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
    await pin.focus();
    await pin.press("Enter");
    await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    // Another spot takes its place in the scrub bar.
    if (await opener.isVisible()) await opener.click();
    await page
      .getByRole("combobox", { name: "Search spots" })
      .fill("Dollymount");
    await page.locator("[data-spot-option]").click();
    await expect(barName(page)).toHaveText("Dollymount");
    await expect(page.locator('[data-spot-id="dollymount"]')).toHaveClass(
      /\bsel\b/,
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
