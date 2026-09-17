import { expect, test } from "./fixtures";

test("glyph rows and map dropdown replace the bottom toolbar, with keyboard dismissal and linked credits", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-13T17:00:00Z"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('[data-model="harmonie"]')).toBeEnabled({
    timeout: 30000,
  });
  await expect(page.locator(".forecast-toolbar")).toHaveCount(0);
  await expect(page.locator(".site-footer")).toBeEmpty();
  await page.locator('[data-view="table"]').click();
  for (const name of [
    "Wind speed (kn)",
    "Wind gusts (kn)",
    "Wind direction (from)",
  ]) {
    const label = page.getByRole("rowheader", { name, exact: true });
    await expect(label).toBeVisible();
    await expect(label.locator("svg")).toHaveCount(1);
    await expect(label).not.toContainText(/Wind|Gusts|Direction/);
  }
  await expect(
    page.locator(".platform-brand svg[aria-label=Force5]"),
  ).toHaveAttribute("viewBox", "90 150 580 400");
  await expect(page.locator(".map-credits")).not.toContainText("OpenFreeMap");
  await expect(
    page.locator('.map-credits a[href="https://openmaptiles.org/"]'),
  ).toBeVisible();
  await expect(
    page.locator(
      '.map-credits a[href="https://www.openstreetmap.org/copyright"]',
    ),
  ).toBeVisible();
  const trigger = page.getByLabel("Choose forecast model", { exact: true });
  const options = page.getByRole("group", { name: "Weather model" });
  await expect(options).toBeHidden();
  const dock = (await page.locator(".map-footer").boundingBox())!;
  const picker = (await trigger.boundingBox())!;
  expect(picker.y + picker.height).toBeLessThan(dock.y);
  // The Table view of the new dock: toolbar, scrubber, day and hour header, the
  // three wind rows, the marine block and the credits line. Measured 334px, or
  // 310px with no tides; the three default-on surface-weather rows added 66px.
  expect(dock.height).toBeLessThan(340);
  await trigger.focus();
  await trigger.press("Enter");
  await expect(options).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-model="harmonie"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator(".forecast-sheet")).toBeVisible();
  await trigger.click();
  await page.getByLabel("Layers", { exact: true }).click();
  await expect(options).toBeHidden();
  await page.getByLabel("Close layers").click();
  await trigger.click();
  await page.screenshot({ path: "test-results/model-dropdown-mobile.png" });
  await page.locator('[data-model="ecmwf"]').click();
  await expect(trigger).toContainText("ECMWF");
  await expect(options).toBeHidden();
  await expect(page.locator(".forecast-sheet")).toBeVisible();
});
