import { expect, moreRows, test, type Page } from "./fixtures";

/**
 * The layers' rail (src/LayerRail.tsx), the one way to the layers: Layers
 * under the zoom opens a column of round switches beside it, one a layer, in
 * the groups of src/layerGroups.tsx, on a desktop and on a phone. There is no
 * panel behind it; where it would run into the dock it scrolls.
 */

const RAIL_KEY = "wingfoil.map.rail.v1";

const rail = (page: Page) =>
  page.getByRole("toolbar", { name: "Layers", exact: true });
const zoomLayers = (page: Page) =>
  page
    .getByRole("group", { name: "Map controls" })
    .getByRole("button", { name: "Layers", exact: true });
const railButton = (page: Page, name: string) =>
  rail(page).getByRole("button", { name, exact: true });

async function openDock(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
    timeout: 30000,
  });
}

/** Each group's name and its layers' names, top to bottom. */
const groupsOf = (box: ReturnType<typeof rail>) =>
  box
    .getByRole("group")
    .evaluateAll((groups) =>
      groups.map((group) => [
        group.getAttribute("aria-label"),
        [...group.querySelectorAll("button")].map((button) =>
          button.getAttribute("aria-label"),
        ),
      ]),
    );

test("on a desktop, Layers opens the rail beside the zoom, clear of the dock, with every layer in its group", async ({
  page,
}) => {
  await openDock(page, 1440, 900);
  // Shut at first: zoom and Layers alone.
  await expect(rail(page)).toHaveCount(0);
  await expect(zoomLayers(page)).toHaveAttribute("aria-expanded", "false");
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();
  await expect(zoomLayers(page)).toHaveAttribute("aria-expanded", "true");
  // To the left of the zoom, at its top, with no panel open, and clear of
  // the spot's tools and the dock below it.
  const zbox = (await page.locator(".zbox").boundingBox())!;
  const box = (await rail(page).boundingBox())!;
  const tools = (await page.locator("#dk-tools").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(zbox.x);
  expect(Math.abs(box.y - zbox.y)).toBeLessThan(6);
  expect(box.y + box.height).toBeLessThan(tools.y);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Round switches.
  expect(
    await railButton(page, "Currents").evaluate(
      (el) => el.getBoundingClientRect().width,
    ),
  ).toBe(
    await railButton(page, "Currents").evaluate(
      (el) => el.getBoundingClientRect().height,
    ),
  );

  // Every layer, in its group, in order. "Nothing" round the spot is the
  // layer that is on, pressed again, so it has no switch of its own.
  expect(await groupsOf(rail(page))).toEqual([
    ["Wind", ["Coloured wind", "Particles"]],
    ["Sea", ["Tidal depth", "Currents"]],
    ["Weather", ["Rain"]],
    ["Chart", ["Depth tints", "Contours", "Land relief", "Spot names"]],
    ["Ground", ["Satellite, high tide", "Satellite, low tide"]],
    ["Round your spot", ["Loupe", "Range ring"]],
  ]);
});

test("the rail's switches: a part of the chart, the wind's two layers each by itself, one thing or nothing round the spot, one tide or none", async ({
  page,
}) => {
  await openDock(page, 1440, 900);
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();

  // A part of the chart, on and off.
  await expect(railButton(page, "Spot names")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await railButton(page, "Spot names").click();
  await expect(railButton(page, "Spot names")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".map-canvas")).toHaveClass(/no-names/);
  // Its name, and whether it is on, to its left under the pointer.
  await railButton(page, "Spot names").hover();
  const tip = railButton(page, "Spot names").locator(".lr-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText("Spot names · off");
  const at = (await tip.boundingBox())!;
  const button = (await railButton(page, "Spot names").boundingBox())!;
  expect(at.x + at.width).toBeLessThanOrEqual(button.x);
  await railButton(page, "Spot names").click();
  await expect(page.locator(".map-canvas")).not.toHaveClass(/no-names/);

  // The wind's two layers, each on and off by itself: the coloured wind on
  // leaves the particles on over it, and they go off and on alone.
  await railButton(page, "Coloured wind").click();
  await expect(railButton(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(railButton(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await railButton(page, "Particles").click();
  await expect(railButton(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(railButton(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await railButton(page, "Particles").click();
  await expect(railButton(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Round the spot, one or nothing: the loupe for the ring, then pressed
  // again, nothing.
  await expect(railButton(page, "Range ring")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await railButton(page, "Loupe").click();
  await expect(railButton(page, "Loupe")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(railButton(page, "Range ring")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await railButton(page, "Loupe").click();
  await expect(railButton(page, "Loupe")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(railButton(page, "Range ring")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator(".map-focus")).toHaveAttribute("data-focus", "off");
  // The satellite, one tide or none.
  const high = railButton(page, "Satellite, high tide");
  const low = railButton(page, "Satellite, low tide");
  await high.click();
  await expect(high).toHaveAttribute("aria-pressed", "true");
  await low.click();
  await expect(low).toHaveAttribute("aria-pressed", "true");
  await expect(high).toHaveAttribute("aria-pressed", "false");
  await low.click();
  await expect(low).toHaveAttribute("aria-pressed", "false");
});

test("the rail stays open or shut on the device, as it was left", async ({
  page,
}) => {
  await openDock(page, 1440, 900);
  await zoomLayers(page).click();
  await railButton(page, "Coloured wind").click();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), RAIL_KEY),
  ).toBe("1");
  // Open on the next visit, the layers as they were; shut, and shut on the
  // next.
  await page.reload();
  await expect(rail(page)).toBeVisible({ timeout: 30000 });
  await expect(railButton(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await zoomLayers(page).click();
  await expect(rail(page)).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), RAIL_KEY),
  ).toBe("0");
  await page.reload();
  await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(zoomLayers(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rail(page)).toHaveCount(0);
});

test("the rail is a toolbar: one stop on Tab, the arrows walk it, Space switches", async ({
  page,
}) => {
  await openDock(page, 1440, 900);
  await zoomLayers(page).focus();
  await page.keyboard.press("Enter");
  await expect(rail(page)).toBeVisible();
  await expect(rail(page)).toHaveAttribute("aria-orientation", "vertical");
  await page.keyboard.press("Tab");
  await expect(railButton(page, "Coloured wind")).toBeFocused();
  // Its name shows on the keys' focus too.
  await expect(
    railButton(page, "Coloured wind").locator(".lr-tip"),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(railButton(page, "Particles")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(railButton(page, "Particles")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.press("ArrowUp");
  await expect(railButton(page, "Coloured wind")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(railButton(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("End");
  await expect(railButton(page, "Range ring")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(railButton(page, "Coloured wind")).toBeFocused();
  // One stop: Tab leaves the rail, and Shift+Tab comes back to where it was.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  expect(
    await rail(page).evaluate((el) => el.contains(document.activeElement)),
  ).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await expect(railButton(page, "Tidal depth")).toBeFocused();
});

test("the dock has no Layers of its own; where the rail would run into the dock, it scrolls above it", async ({
  page,
}) => {
  await openDock(page, 1280, 720);
  await expect(
    page
      .getByRole("group", { name: "This spot" })
      .getByRole("button", { name: "Layers" }),
  ).toHaveCount(0);
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();
  const clear = async () => {
    const box = (await rail(page).boundingBox())!;
    const tools = (await page.locator("#dk-tools").boundingBox())!;
    expect(box.y + box.height).toBeLessThan(tools.y);
  };
  await clear();
  await zoomLayers(page).click();
  await expect(rail(page)).toHaveCount(0);
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();
  // The waves, sky and sea open: the dock is too tall for the whole rail
  // beside it, so it stays, shorter, and scrolls to its last layer.
  await moreRows(page);
  await page.mouse.move(400, 300);
  await expect(rail(page)).toBeVisible();
  await expect(zoomLayers(page)).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() =>
      rail(page).evaluate((el) => el.scrollHeight > el.clientHeight + 4),
    )
    .toBe(true);
  await clear();
  await railButton(page, "Range ring").scrollIntoViewIfNeeded();
  await expect(railButton(page, "Range ring")).toBeInViewport();
  await clear();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("Layers opens the rail from the zoom, clear of the dock, and a tap says what it switched", async ({
    page,
  }) => {
    await page.goto("/?spot=brandon");
    await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(rail(page)).toHaveCount(0);
    await zoomLayers(page).tap();
    await expect(rail(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Under the zoom, down the right edge, clear of the head beside it, and
    // above the dock's sheet, scrolling where it must.
    const zbox = (await page.locator(".zbox").boundingBox())!;
    const box = (await rail(page).boundingBox())!;
    const sheet = (await page.locator(".map-footer").boundingBox())!;
    const head = (await page.locator(".map-head").boundingBox())!;
    expect(Math.abs(box.x + box.width - (zbox.x + zbox.width))).toBeLessThan(2);
    expect(box.y).toBeGreaterThanOrEqual(zbox.y + zbox.height);
    expect(box.y + box.height).toBeLessThanOrEqual(sheet.y);
    const first = (await railButton(page, "Coloured wind").boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(head.y + head.height);
    // A finger has no pointer to rest on it: a tap names the layer, and
    // whether it is on now, for a moment.
    const names = railButton(page, "Spot names");
    await names.tap();
    await expect(names).toHaveAttribute("aria-pressed", "false");
    const tip = names.locator(".lr-tip");
    const shown = () =>
      tip.evaluate((el) => Number(getComputedStyle(el).opacity));
    await expect(tip).toHaveText("Spot names · off");
    await expect.poll(shown).toBe(1);
    await expect.poll(shown, { timeout: 3000 }).toBe(0);
    await expect(page.locator(".map-canvas")).toHaveClass(/no-names/);
    // And Layers shuts it.
    await zoomLayers(page).tap();
    await expect(rail(page)).toHaveCount(0);
  });
});
