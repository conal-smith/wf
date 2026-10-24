import {
  expect,
  layerTile,
  menuRow,
  openFromMenu,
  openMenu,
  setLayer,
  test,
} from "./fixtures";

test("the chart's controls: zoom and Layers on the right, the layers from the menu by keyboard, with the credits behind the i", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  const controls = page.getByRole("group", { name: "Map controls" });
  // No "all of Ireland": it flew out further than anyone wanted.
  await expect(
    controls.getByRole("button", { name: "Show all of Ireland" }),
  ).toHaveCount(0);
  // Zoom, and under it Layers; the chart's other tools are in the site menu.
  await expect(controls.getByRole("button")).toHaveText(["+", "−", ""]);
  for (const name of ["Zoom in", "Zoom out", "Layers"])
    await expect(
      controls.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  // Clear of the head and of the dock.
  const box = (await controls.boundingBox())!;
  const dock = (await page.locator(".map-footer").boundingBox())!;
  const head = (await page.locator(".map-head").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(dock.y);
  expect(head.x + head.width).toBeLessThanOrEqual(box.x);
  // The layers open from the menu by keyboard, and close on Escape with the
  // focus back on the menu's trigger.
  const menu = page.getByRole("button", { name: "Site menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menuRow(page, "Customise")).toBeFocused();
  await expect(
    page.getByRole("group", { name: "The chart" }).getByRole("button"),
  ).toHaveText([
    "Customise",
    "Layers",
    "Display options",
    "About the map",
    "Take the tour",
  ]);
  await expect(
    page.getByRole("group", { name: "The chart" }).getByRole("link"),
  ).toHaveText(["Spot finder"]);
  await page.keyboard.press("Tab");
  await expect(menuRow(page, "Layers")).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("group", { name: "Layers" });
  await expect(panel).toBeVisible();
  // Each layer a tile with a picture of it, a toggle under its group's name.
  const wind = panel.getByRole("group", { name: "Wind" });
  await expect(wind.getByRole("button")).toHaveCount(3);
  for (const [i, name] of ["Ink", "Coloured wind", "Coloured arrows"].entries())
    await expect(wind.getByRole("button").nth(i)).toHaveAccessibleName(name);
  await expect(layerTile(page, "Ink")).toHaveAttribute("aria-pressed", "true");
  await expect(layerTile(page, "Ink")).toHaveAccessibleDescription(
    "Streaks, the default",
  );
  for (const group of [
    "Sea",
    "Chart",
    "Ground",
    "Round your spot",
    "Weather model",
  ])
    await expect(panel.getByRole("group", { name: group })).toBeVisible();
  // The knot scale is there while the wind is drawn in its colours.
  await expect(panel.locator(".knot-scale")).toHaveCount(0);
  // The tiles take the keys: Tab reaches Ink first, Space presses it.
  await page.keyboard.press("Tab");
  await expect(layerTile(page, "Ink")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(layerTile(page, "Coloured wind")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(layerTile(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(layerTile(page, "Ink")).toHaveAttribute("aria-pressed", "false");
  await expect(panel.locator(".knot-scale")).toBeVisible();
  // Reset puts the defaults back.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(layerTile(page, "Ink")).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByRole("group", { name: "Weather model" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  // The chart's parts switch off and stay off.
  await openFromMenu(page, "Layers");
  await setLayer(page, "Spot names", false);
  await expect(page.locator(".map-canvas")).toHaveClass(/no-names/);
  await page.reload();
  await expect(page.locator(".map-canvas")).toHaveClass(/no-names/, {
    timeout: 30000,
  });
  await openFromMenu(page, "Layers");
  await setLayer(page, "Spot names", true);
  await page.keyboard.press("Escape");
  // The key is in the menu, in a dialog rather than on the chart.
  await openFromMenu(page, "About the map");
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
  await expect(
    print.locator('a[href="https://openfreemap.org/"]'),
  ).toBeVisible();
  await expect(print).toContainText("EMODnet");
  await expect(print).toContainText("Not for navigation");
});

test("the map's information is one dialog over the dimmed chart: from the menu and from the tidal depth's i", async ({
  page,
}) => {
  // The tidal-depth layer on, as a rider who had it on last time.
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  // And Brandon Bay in the dock, from the link: the stars' link names it.
  await page.goto("/?spot=brandon");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  // Its key is not drawn on the chart, nor anything of the dialog's until asked.
  await expect(page.locator(".foil-key")).toHaveCount(0);
  await expect(page.locator(".map-info")).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Site menu" });
  await openFromMenu(page, "About the map");
  const info = page.getByRole("dialog", { name: "About the map" });
  await expect(info).toBeVisible();
  // A rail of parts, the key chosen; each part in its own panel beside it.
  expect(
    await info
      .getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label"))),
  ).toEqual([
    "The map’s key",
    "Stars",
    "Wind & gusts",
    "The blend & models",
    "Tidal depth",
    "Currents",
    "Rain",
    "Satellite",
    "Sources & credits",
    "About",
  ]);
  await expect(
    info.getByRole("tab", { name: "The map’s key" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    info.getByRole("heading", { name: /^The lights/ }),
  ).toBeVisible();
  await info.getByRole("tab", { name: "Tidal depth" }).click();
  await expect(info.getByRole("tabpanel")).toContainText(
    "Deep enough, 1 m or more",
  );
  // The arrows walk the rail.
  await page.keyboard.press("ArrowDown");
  await expect(info.getByRole("tab", { name: "Currents" })).toBeFocused();
  await info.getByRole("tab", { name: "Sources & credits" }).click();
  await expect(info.getByRole("tabpanel")).toContainText("Not for navigation");
  // Modal, over a scrim: the page behind is dimmed and cannot be reached.
  expect(await info.evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(
    await info.evaluate(
      (el) => getComputedStyle(el, "::backdrop").backgroundColor,
    ),
  ).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);
  await expect(menu).toBeFocused();
  // The tidal depth's own i opens it at its key.
  await openFromMenu(page, "Layers");
  await page.getByRole("button", { name: "About tidal depth" }).click();
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
  await openFromMenu(page, "About the map");
  await info.getByRole("tab", { name: "Stars" }).click();
  await expect(info.locator("#map-info-stars")).toBeAttached();
  await expect(
    info.getByRole("link", { name: "How the stars work, in full →" }),
  ).toHaveAttribute("href", "/stars?spot=brandon");
});

for (const width of [390, 1440]) {
  test(`the spot finder is in the menu under the layers, in place of your spots, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    const menu = page.getByRole("button", { name: "Site menu" });
    await openMenu(page);
    const tools = page.getByRole("group", { name: "The chart" });
    const finder = tools.getByRole("link", { name: "Spot finder" });
    const l = (await menuRow(page, "Layers").boundingBox())!;
    const f = (await finder.boundingBox())!;
    const o = (await menuRow(page, "Display options").boundingBox())!;
    expect(f.x).toBe(l.x);
    expect(f.y).toBeGreaterThan(l.y);
    expect(o.y).toBeGreaterThan(f.y);
    await finder.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/\/spots$/);
    await expect(page.locator("[data-spot-finder]")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
