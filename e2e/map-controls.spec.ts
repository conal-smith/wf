import { expect, rememberSpot, test } from "./fixtures";

test("the chart's controls: zoom and the layers by keyboard, with the credits behind the i", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  const controls = page.getByRole("group", { name: "Map controls" });
  // No "all of Ireland": it flew out further than anyone wanted.
  await expect(
    controls.getByRole("button", { name: "Show all of Ireland" }),
  ).toHaveCount(0);
  for (const name of [
    "Zoom in",
    "Zoom out",
    "Layers",
    "Your spots",
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
  for (const name of ["Ink", "Coloured arrows", "Wash"])
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

test("the map's information is one dialog over the dimmed chart: the i under Layers and the foil layer's i", async ({
  page,
}) => {
  // The foilable-depth layer on, as a rider who had it on last time.
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  // And Brandon Bay in the dock, chosen last: the stars' link names it.
  await rememberSpot(page, "brandon");
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
  await expect(info).toContainText("Deep enough, 1 m or more");
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
  // The stars are explained in it, with the way on to the page that works
  // them through for the spot in view; the dock has no "?" of its own.
  await expect(
    page.locator(".dock").getByRole("button", { name: "How the stars work" }),
  ).toHaveCount(0);
  await open.click();
  await expect(info).toBeVisible();
  await expect(info.locator("#map-info-stars")).toBeAttached();
  await expect(
    info.getByRole("link", { name: "How the stars work, in full →" }),
  ).toHaveAttribute("href", "/stars?spot=brandon");
});

for (const width of [390, 1440]) {
  test(`your spots are behind the star under Layers, and open as the layers do, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem(
        "wingfoil.spots.v1",
        JSON.stringify({ starred: ["dollymount"] }),
      ),
    );
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(146, {
      timeout: 30000,
    });
    // Nothing of them on the chart until asked: no panel, no strip.
    const panel = page.getByRole("complementary", { name: "Your spots" });
    await expect(panel).toHaveCount(0);
    await expect(page.locator(".side")).toHaveCount(0);
    const controls = page.getByRole("group", { name: "Map controls" });
    const star = controls.getByRole("button", { name: "Your spots", exact: true });
    const layers = controls.getByRole("button", { name: "Layers", exact: true });
    // The star is under Layers, the "i" under it, all one column.
    const at = async (name: string) =>
      (await controls.getByRole("button", { name, exact: true }).boundingBox())!;
    const [l, s, i] = [
      await at("Layers"),
      await at("Your spots"),
      await at("Map information"),
    ];
    expect(s.x).toBe(l.x);
    expect(s.y).toBeGreaterThan(l.y);
    expect(i.y).toBeGreaterThan(s.y);
    await expect(star).toHaveAttribute("aria-expanded", "false");
    await star.click();
    await expect(panel).toBeVisible();
    await expect(star).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toContainText("Dollymount");
    await expect(panel).toContainText("Often opened");
    // Beside the controls, clear of the head and the dock, and on the page.
    const box = (await panel.boundingBox())!;
    const rail = (await controls.boundingBox())!;
    const dock = (await page.locator(".map-footer").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(rail.x);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThan(dock.y);
    // Its button closes it, as does Escape, as does a tap away.
    await star.click();
    await expect(panel).toHaveCount(0);
    await star.click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await star.click();
    await page.locator(".dock .dk-name").click();
    await expect(panel).toHaveCount(0);
    // One at a time: the layers close your spots, and the other way round.
    await star.click();
    await layers.click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Layers" })).toBeVisible();
    await star.click();
    await expect(page.getByRole("group", { name: "Layers" })).toHaveCount(0);
    await expect(panel).toBeVisible();
    // The small print's "i" in the panel opens a dialog, and a press in it
    // leaves the panel open behind it.
    await panel.getByRole("button", { name: "About your spots" }).click();
    const about = page.getByRole("dialog", { name: "About your spots" });
    await expect(about).toContainText("kept on this device");
    await about.click();
    await page.keyboard.press("Escape");
    await expect(about).toHaveCount(0);
    await expect(panel).toBeVisible();
    // A spot chosen from it is the dock's, and the panel makes way.
    await panel.getByRole("button", { name: /^Dollymount/ }).click();
    await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
    await expect(panel).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
