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
    "Map information",
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
  // The key is a button away, in a dialog rather than on the chart.
  await controls.getByRole("button", { name: "Map information" }).click();
  await expect(
    page.getByRole("dialog", { name: "About the map" }),
  ).toContainText("Depths in metres below chart datum");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("the map's information is one dialog over the dimmed chart: the i under Layers, the foil layer's i and the stars' ?", async ({
  page,
}) => {
  // The foilable-depth layer on, as a rider who had it on last time.
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  // Its key is not drawn on the chart, nor anything of the dialog's until asked.
  await expect(page.locator(".foil-key")).toHaveCount(0);
  await expect(page.locator(".map-info")).toHaveCount(0);
  const controls = page.getByRole("group", { name: "Map controls" });
  const open = controls.getByRole("button", { name: "Map information" });
  await open.click();
  const info = page.getByRole("dialog", { name: "About the map" });
  await expect(info).toBeVisible();
  for (const name of ["Map key", "Star ratings", "Foilable depth", "Sources"])
    await expect(info.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(info).toContainText("Deep enough, 1.5 m or more");
  await expect(info).toContainText("Not for navigation");
  // Modal, over a scrim: the page behind is dimmed and cannot be reached.
  expect(
    await info.evaluate((el) => el.matches(":modal")),
  ).toBe(true);
  expect(
    await info.evaluate(
      (el) => getComputedStyle(el, "::backdrop").backgroundColor,
    ),
  ).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);
  await expect(open).toBeFocused();
  // The foil layer's own i opens it at the foil key.
  await controls.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("button", { name: "About foilable depth" }).click();
  await expect(info).toBeVisible();
  await expect(info.locator("#map-info-foil")).toBeInViewport();
  await info.getByRole("button", { name: "Close" }).click();
  await expect(info).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Layers" })).toHaveCount(0);
  // The "?" by the dock's stars opens it at the stars, with the way on to
  // the page that works them through for the spot in view.
  await page
    .locator(".dock")
    .getByRole("button", { name: "How the stars work" })
    .click();
  await expect(info).toBeVisible();
  await expect(info.locator("#map-info-stars")).toBeInViewport();
  await expect(
    info.getByRole("link", { name: "How the stars work, in full →" }),
  ).toHaveAttribute("href", "/stars?spot=brandon");
});
