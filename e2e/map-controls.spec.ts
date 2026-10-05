import { expect, test } from "./fixtures";

test("the chart's controls: zoom, all of Ireland, and the layers by keyboard, with the credits behind the i", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  const controls = page.getByRole("group", { name: "Map controls" });
  for (const name of [
    "Zoom in",
    "Zoom out",
    "Show all of Ireland",
    "Layers",
    "Your spots and the key",
  ])
    await expect(controls.getByRole("button", { name, exact: true })).toBeVisible();
  // Clear of the head and of the dock.
  const box = (await controls.boundingBox())!;
  const dock = (await page.locator(".map-footer").boundingBox())!;
  const head = (await page.locator(".map-head").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(dock.y);
  expect(head.x + head.width).toBeLessThanOrEqual(box.x);
  // The layers open from the keyboard and close on Escape, focus kept.
  const layers = controls.getByRole("button", { name: "Layers", exact: true });
  await layers.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("group", { name: "Layers" });
  await expect(panel).toBeVisible();
  for (const name of ["Ink", "Coloured arrows", "Faint wash"])
    await expect(panel.getByRole("radio", { name })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Ink" })).toBeChecked();
  await expect(panel.locator(".knot-scale")).toBeVisible();
  await expect(panel.getByRole("group", { name: "Weather model" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // The chart's parts switch off and stay off.
  await layers.click();
  await panel.getByRole("checkbox", { name: "Spot names" }).uncheck();
  await expect(page.locator(".map-canvas")).toHaveClass(/no-names/);
  await page.reload();
  await expect(page.locator(".map-canvas")).toHaveClass(/no-names/, {
    timeout: 30000,
  });
  await layers.click();
  await panel.getByRole("checkbox", { name: "Spot names" }).check();
  await page.keyboard.press("Escape");
  // On a phone the key is a button away.
  await controls.getByRole("button", { name: "Your spots and the key" }).click();
  await expect(
    page.getByRole("complementary", { name: "Your spots and the key" }),
  ).toContainText("Depths in metres below chart datum");
  await page.keyboard.press("Escape");
  // The credits, linked, behind the i.
  await page.getByRole("button", { name: "Sources and small print" }).click();
  const print = page.getByRole("dialog", { name: "Sources and small print" });
  await expect(
    print.locator('a[href="https://www.openstreetmap.org/copyright"]'),
  ).toBeVisible();
  await expect(print.locator('a[href="https://openfreemap.org/"]')).toBeVisible();
  await expect(print).toContainText("EMODnet");
  await expect(print).toContainText("Not for navigation");
});
