import {
  SITE_ROW_TEXTS,
  SITE_ROWS,
  closeLayers,
  expect,
  layerTile,
  layersButton,
  layersRail,
  openFromMenu,
  openMenu,
  scrubBar,
  setLayer,
  siteNav,
  siteRow,
  test,
} from "./fixtures";

test("the chart's controls: zoom and Layers on the right, Layers the rail on a phone, the menu by keyboard, with the credits behind the i", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?map");
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
  // Clear of the head and of the scrub bar.
  const box = (await controls.boundingBox())!;
  const bar = (await page.locator(".map-footer").boundingBox())!;
  const head = (await page.locator("[data-top-bar]").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(bar.y);
  expect(box.y).toBeGreaterThanOrEqual(head.y + head.height);
  // The menu is the site's navigation, in its groups, by keyboard, and no
  // layers in it: they are the rail.
  const menu = page.getByRole("button", { name: "Site menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(siteRow(page, "Chart")).toBeFocused();
  await expect(siteNav(page).getByRole("link")).toHaveText(SITE_ROW_TEXTS);
  await expect(
    page.getByRole("dialog", { name: "Site menu" }).getByText("Layers"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  // Layers opens the rail on a phone too: a column of round switches beside
  // the zoom, in the groups, with no panel behind it.
  await expect(layersRail(page)).toBeHidden();
  await layersButton(page).click();
  await expect(layersButton(page)).toHaveAttribute("aria-expanded", "true");
  const rail = layersRail(page);
  await expect(rail).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const group of [
    "Wind",
    "Sea",
    "Weather",
    "Ground",
    "Round your spot",
  ])
    await expect(rail.getByRole("group", { name: group })).toBeAttached();
  await expect(rail.getByRole("group", { name: "Chart" })).toHaveCount(0);
  // The depths are one switch under the sea, off until a rider asks.
  await expect(
    rail.getByRole("group", { name: "Sea" }).getByRole("button", {
      name: "Depths",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
  // The wind in two layers, each its own switch: the particles alone at first.
  const wind = rail.getByRole("group", { name: "Wind" });
  await expect(wind.getByRole("button")).toHaveCount(2);
  for (const [i, name] of ["Coloured wind", "Particles"].entries())
    await expect(wind.getByRole("button").nth(i)).toHaveAccessibleName(name);
  await expect(layerTile(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(layerTile(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // A tap switches one, the particles staying on over it, and says which.
  await layerTile(page, "Coloured wind").click();
  await expect(layerTile(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(layerTile(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // It stands clear of the scrub bar, scrolling in the room above it.
  const railBox = (await rail.boundingBox())!;
  expect(railBox.y + railBox.height).toBeLessThanOrEqual(bar.y);
  // A layer switched on stays on.
  await setLayer(page, "Currents", true);
  await page.reload();
  // The rail is as it was left on this device: open.
  await expect(layersRail(page)).toBeVisible({ timeout: 30000 });
  await expect(layerTile(page, "Currents")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await setLayer(page, "Currents", false);
  await closeLayers(page);
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

test("the map's information is one dialog over the dimmed chart, from the menu's About", async ({
  page,
}) => {
  // The tidal-depth layer on, as a rider who had it on last time.
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  // And Brandon Bay in the scrub bar, from the link: the stars' link names it.
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
  // The stars are explained in it, with the way on to the page that works
  // them through for the spot in view; the scrub bar has no "?" of its own.
  await expect(
    scrubBar(page).getByRole("button", { name: "How the stars work" }),
  ).toHaveCount(0);
  await openFromMenu(page, "About the map");
  await info.getByRole("tab", { name: "Stars" }).click();
  await expect(info.locator("#map-info-stars")).toBeAttached();
  await expect(
    info.getByRole("link", { name: "How the stars work, in full →" }),
  ).toHaveAttribute("href", "/stars?spot=brandon");
});

for (const width of [390, 1440]) {
  test(`the menu is the forecast, your settings, help and more, in named groups, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?map");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    const menu = page.getByRole("button", { name: "Site menu" });
    await openMenu(page);
    const finder = siteRow(page, "Spot finder");
    const at = async (name: string) =>
      (await siteRow(page, name).boundingBox())!;
    const rows = await Promise.all(SITE_ROWS.map(at));
    // In one column, down the menu in order, with a wider gap between the
    // groups than between the rows of one.
    for (const [i, box] of rows.entries()) {
      expect(box.x).toBe(rows[0].x);
      if (i) expect(box.y).toBeGreaterThan(rows[i - 1].y);
    }
    const step = (i: number) => rows[i].y - rows[i - 1].y;
    // Settings stands alone in its group: the gap before About is a group's.
    expect(step(2)).toBeGreaterThan(step(1) + 10);
    expect(step(3)).toBeGreaterThan(step(1) + 10);
    expect(step(6)).toBeGreaterThan(step(5) + 10);
    await finder.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-spot-finder]")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
