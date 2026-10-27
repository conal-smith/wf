import {
  closePanel,
  expect,
  layerTile,
  moreRows,
  openFromMenu,
  test,
  type Page,
} from "./fixtures";

/**
 * The layers' rail (src/LayerRail.tsx): on a desktop, Layers under the zoom
 * opens a column of round switches beside it, one a layer, in the Layers
 * panel's groups (src/layerGroups.tsx). On a phone, or where the rail would
 * run into the dock, Layers opens the panel instead.
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

test("on a desktop, Layers opens the rail beside the zoom, clear of the dock, with the Layers panel's groups and layers", async ({
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

  // The panel's groups and layers, in its order, from the same list: its
  // "Nothing" round the spot is the layer that is on, pressed again.
  const ours = await groupsOf(rail(page));
  await openFromMenu(page, "Layers");
  const panel = await page
    .getByRole("group", { name: "Layers", exact: true })
    .locator(".lp-tiles")
    .evaluateAll((groups) =>
      groups.map((group) => [
        group.closest("section")!.querySelector("h3")!.textContent,
        [...group.querySelectorAll(".lp-press")]
          .map((button) => button.querySelector(".lp-name")!.firstChild!)
          .map((name) => name.textContent)
          .filter((name) => name !== "Nothing"),
      ]),
    );
  expect(ours).toEqual(panel);
  expect(ours.map(([name]) => name)).toEqual([
    "Wind",
    "Sea",
    "Weather",
    "Chart",
    "Ground",
    "Round your spot",
  ]);
  await closePanel(page);
});

test("the rail's switches: a part of the chart, the wind's two layers each by itself, one thing or nothing round the spot, one tide or none", async ({
  page,
}) => {
  await openDock(page, 1440, 900);
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();
  const box = (await rail(page).boundingBox())!;

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
  expect(at.x + at.width).toBeLessThanOrEqual(box.x);
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
  // again, nothing, as the panel's "Nothing" is.
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
  await openFromMenu(page, "Layers");
  await expect(layerTile(page, "Nothing")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(layerTile(page, "Coloured wind")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await closePanel(page);
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

test("the dock has no Layers of its own; where the rail would run into the dock, Layers opens the panel", async ({
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
  const box = (await rail(page).boundingBox())!;
  const tools = (await page.locator("#dk-tools").boundingBox())!;
  expect(box.y + box.height).toBeLessThan(tools.y);
  await zoomLayers(page).click();
  await expect(rail(page)).toHaveCount(0);
  await zoomLayers(page).click();
  await expect(rail(page)).toBeVisible();
  // The waves, sky and sea open: the dock is too tall for the rail beside it,
  // so it goes, and Layers opens the panel.
  await moreRows(page);
  await page.mouse.move(400, 300);
  await expect(rail(page)).toHaveCount(0);
  await expect(zoomLayers(page)).toHaveAttribute("aria-expanded", "false");
  await zoomLayers(page).click();
  await expect(page.getByRole("dialog", { name: "Layers" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Layers" })).toHaveCount(0);
  await expect(zoomLayers(page)).toBeFocused();
  // Still open as far as the device knows: back once the dock has gone.
  await page
    .getByRole("button", { name: "Close the forecast for Brandon Bay" })
    .click();
  await expect(rail(page)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("Layers opens the panel from the zoom, and there is no rail", async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), RAIL_KEY);
    await page.goto("/?spot=brandon");
    await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator(".lr")).toHaveCount(0);
    await zoomLayers(page).click();
    await expect(page.getByRole("dialog", { name: "Layers" })).toBeVisible();
    await expect(page.locator(".lr")).toHaveCount(0);
    await closePanel(page);
  });

  test("the panel is half the screen over a clear chart, and its foot names the defaults as they are", async ({
    page,
  }) => {
    await page.goto("/?map");
    await zoomLayers(page).click();
    const panel = page.locator("dialog.layers-dialog");
    await expect(panel).toBeVisible();
    // Half the screen at most, so the chart above it is seen to change as a
    // layer is pressed, with no wash or blur over it.
    await expect
      .poll(async () => (await panel.boundingBox())!.y, { timeout: 5000 })
      .toBeGreaterThanOrEqual(844 / 2 - 2);
    expect(
      await panel.evaluate((el) => {
        const backdrop = getComputedStyle(el, "::backdrop");
        return [backdrop.backgroundColor, backdrop.backdropFilter];
      }),
    ).toEqual(["rgba(0, 0, 0, 0)", "none"]);
    // The foot names the defaults from the layers themselves: as what is on
    // at first, and as what Reset puts back once the rider has others.
    const foot = panel.locator("[data-layers-default]");
    await expect(foot).toHaveText(
      "The default layers are on: particles, tidal depth, the chart, range ring.",
    );
    await layerTile(page, "Coloured wind").click();
    await layerTile(page, "Particles").click();
    await expect(foot).toHaveText(
      "Reset for the default: particles, tidal depth, the chart, range ring.",
    );
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(layerTile(page, "Particles")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(foot).toHaveText(/^The default layers are on: /);
    await closePanel(page);
  });
});
