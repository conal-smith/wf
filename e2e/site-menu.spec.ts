import {
  expect,
  layersRail,
  menuRow,
  openFromMenu,
  rowName,
  SITE_ROW_TEXTS,
  SITE_ROWS,
  test,
  type Page,
} from "./fixtures";

/**
 * The one menu that crosses between the three apps on this origin.
 *
 * The API is not running in this suite, so nothing here touches a listing or a
 * thread: the assertions are the header, the menu and each page's own chrome,
 * all of which have to render whether or not `/api` answers.
 */

const trigger = (page: Page) => page.getByRole("button", { name: "Site menu" });
const panel = (page: Page) => page.getByRole("navigation", { name: "Site" });
const row = (page: Page, name: string) =>
  panel(page).getByRole("link", { name, exact: true });
// The same rows in the same order, whichever bundle drew them.
const SECTIONS = SITE_ROW_TEXTS;

test("on the map the menu opens by keyboard and Escape closes only the menu", async ({
  page,
}) => {
  // A linked spot opens focused, and the map's own global Escape handler
  // clears the focus. That is the thing the menu must not let through.
  await page.goto("/?spot=keel");
  await expect(page.locator(".app-shell.is-focus")).toHaveCount(1, {
    timeout: 30000,
  });

  await trigger(page).focus();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  // A disclosure: no `aria-haspopup` promising menu semantics, and nothing
  // controlled until there is something to control.
  await expect(trigger(page)).not.toHaveAttribute("aria-haspopup", /.*/);
  await expect(trigger(page)).not.toHaveAttribute("aria-controls", /.*/);
  await page.keyboard.press("Enter");

  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
  await expect(trigger(page)).toHaveAttribute("aria-controls", /.+/);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  // The site's navigation, as on every page, and its first row takes the
  // focus; the chart is the page.
  await expect(row(page, "Chart")).toBeFocused();
  await expect(row(page, "Chart")).toHaveAttribute("aria-current", "page");
  await expect(row(page, "Marketplace")).toHaveAttribute("href", "/market");
  await expect(row(page, "Marketplace")).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(row(page, "Community")).toHaveAttribute("href", "/community");
  await expect(row(page, "Community")).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator(".app-shell.is-focus")).toHaveCount(1);

  // A second Escape, with the menu closed, reaches the map as it always did.
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell.is-focus")).toHaveCount(0);
});

/**
 * The owner's ruling of 2026-10-29: one menu, the same on every page, in its
 * groups. The chart's and the spot finder's are the same rows in the same
 * order, each marking its own page, and neither has a part of its own.
 */
test("the menu's navigation is the same on the full chart and on the home page's list", async ({
  page,
}) => {
  const read = async () => {
    await trigger(page).click();
    await settled(page);
    const rows = (await panel(page).getByRole("link").allTextContents()).map(
      rowName,
    );
    const marked = (
      await panel(page).locator('[aria-current="page"]').allTextContents()
    ).map(rowName);
    const own = await panel(page).getByRole("group").count();
    const lists = await panel(page).locator("ul").count();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    return { rows, marked, own, lists };
  };
  await page.goto("/?map");
  await expect(page.locator('[data-view-switch="spots"]')).toBeVisible({
    timeout: 30000,
  });
  const chart = await read();
  await page.goto("/");
  await expect(page.locator("[data-spot-finder]")).toBeVisible({
    timeout: 30000,
  });
  const spots = await read();
  expect(chart.rows).toEqual(SITE_ROWS);
  expect(spots.rows).toEqual(chart.rows);
  expect(chart.marked).toEqual(["Chart"]);
  expect(spots.marked).toEqual(["Spot finder"]);
  // No part of a page's own on either, and the same four groups.
  expect(chart.own).toBe(0);
  expect(spots.own).toBe(0);
  // The four named groups.
  expect(chart.lists).toBe(4);
  expect(spots.lists).toBe(4);
  // "Wind map" was the chart a second time: it is gone.
  await trigger(page).click();
  await expect(drawer(page)).not.toContainText("Wind map");
});

/** The drawer itself: the modal the trigger opens. */
const drawer = (page: Page) => page.getByRole("dialog", { name: "Site menu" });

/** How far the drawer's right edge is from the window's. */
const offRight = async (page: Page) => {
  const box = (await drawer(page).boundingBox())!;
  return Math.round(page.viewportSize()!.width - box.x - box.width);
};

/** Where the drawer stands, once it has slid in. */
async function settled(page: Page) {
  await expect(drawer(page)).toBeVisible();
  await expect.poll(() => offRight(page)).toBe(0);
  return (await drawer(page).boundingBox())!;
}

test("the menu is a drawer from the right, over the dimmed map, with named groups and a glyph on every row", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  const box = await settled(page);
  // The right edge, the screen's full height, and clear of the left of it.
  expect(box.y).toBe(0);
  expect(box.height).toBe(page.viewportSize()!.height);
  expect(box.width).toBeLessThanOrEqual(360);
  // A modal over the kit's backdrop: the map under it is inert.
  expect(await drawer(page).evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(
    await drawer(page).evaluate(
      (el) => getComputedStyle(el, "::backdrop").backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)");
  // Its head: the way out, and the name.
  await expect(
    drawer(page).getByRole("button", { name: "Close menu" }),
  ).toBeVisible();
  await expect(drawer(page)).toContainText("wingfoil.ie");
  // The site's navigation and sections, and nothing else: no Layers, which
  // is the rail by the zoom. Each row has its glyph in the margin.
  const rows = panel(page).getByRole("link");
  await expect(rows).toHaveText(SECTIONS);
  for (const row of await rows.all())
    await expect(row.locator("svg")).toHaveCount(1);
  await expect(panel(page).getByRole("heading")).toHaveText([
    "Forecast",
    "Your settings",
    "Help",
    "More from wingfoil.ie",
  ]);
  // The page you are on is said in words, and to a screen reader by
  // aria-current, its name its own.
  await expect(row(page, "Chart")).toHaveAttribute("aria-current", "page");
  // The Almanac signs it no longer.
  await expect(drawer(page)).not.toContainText("Almanac");
  // The page behind does not scroll while it is open.
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).toBe("hidden");
});

test("the drawer closes on Escape, on its X and on the backdrop, the focus back on the trigger", async ({
  page,
}) => {
  await page.goto("/?map");
  // Escape.
  await trigger(page).click();
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  // Its own X.
  await trigger(page).click();
  await settled(page);
  await drawer(page).getByRole("button", { name: "Close menu" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  // A press on the dimmed map beside it, which moves nothing under it.
  await trigger(page).click();
  const box = await settled(page);
  await page.mouse.click(box.x - 200, 500);
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).overflow,
    ),
  ).not.toBe("hidden");
});

test("the focus stays in the drawer while it is open", async ({ page }) => {
  await page.goto("/?map");
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(row(page, "Chart")).toBeFocused();
  // Round the whole drawer and more: the focus never leaves it.
  for (const key of [
    ...Array(14).fill("Tab"),
    ...Array(14).fill("Shift+Tab"),
  ]) {
    await page.keyboard.press(key);
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("dialog[open]"),
      ),
    ).toBe(true);
  }
});

/**
 * A finger pushes the drawer back off to the right: it follows the finger,
 * and let go past the line it shuts, short of it it springs back. The mouse's
 * pointer events stand in for a finger's here: the drawer reads either.
 */
test("a drag to the right puts the drawer away, and a short one springs back", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  const box = await settled(page);
  // From the drawer's own ground, between its rows and its foot.
  const x = box.x + 30;
  const y = box.y + box.height - 150;
  const off = () => offRight(page);

  // A short drag: it follows, then springs back.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 });
  await page.mouse.move(x + 40, y, { steps: 4 });
  expect(await off()).toBeLessThan(-30);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect.poll(off).toBe(0);
  await expect(drawer(page)).toBeVisible();

  // Past the line: it goes, and the focus is back on the trigger.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
  await expect(trigger(page)).toBeFocused();
});

test("a drag that starts on a row is the drawer's, and a tap on a row still presses it", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  await settled(page);

  // Past the line, from the middle of a row: the drawer goes, the row's
  // dialog does not open.
  const settings = (await menuRow(page, "Settings").boundingBox())!;
  const x = settings.x + settings.width / 2;
  const y = settings.y + settings.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y, { steps: 12 });
  await page.mouse.up();
  await expect(drawer(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);

  // And a tap on a row is still a press of it.
  await trigger(page).click();
  await settled(page);
  await menuRow(page, "Settings").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  // And the layers are not in the menu: they are the rail by the zoom.
  await expect(layersRail(page)).toBeHidden();
});

/**
 * A flick: short of the line, but fast. Sent as one burst of pointer events,
 * so the speed is the drawer's to measure and not the test runner's pace
 * (the thresholds themselves are force5/src/siteMenu.test.ts's).
 */
test("a fast flick puts the drawer away short of the line", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  const box = await settled(page);
  await drawer(page).evaluate(
    (el, at) => {
      const send = (type: string, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            clientX: x,
            clientY: at.y,
          }),
        );
      send("pointerdown", at.x);
      send("pointermove", at.x + 12);
      send("pointermove", at.x + 24);
      send("pointermove", at.x + 36);
      send("pointerup", at.x + 36);
    },
    { x: box.x + 30, y: box.y + box.height - 150 },
  );
  await expect(drawer(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
});

test("the menu carries the reader between the map and the marketplace", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  await row(page, "Marketplace").click();

  await page.waitForURL("**/market");
  await expect(
    page.getByRole("heading", { level: 1, name: "Market" }),
  ).toBeVisible();
  // The site's one top bar, the wordmark going home.
  await expect(
    page
      .locator("[data-top-bar]")
      .getByRole("link", { name: "wingfoil.ie, the Spot finder" }),
  ).toBeVisible();
  // The standalone Map button is gone: one control per destination.
  await expect(
    page
      .getByRole("navigation", { name: "Marketplace" })
      .getByRole("link", { name: "Map", exact: true }),
  ).toHaveCount(0);
  // The footer link is not beside it, and stays.
  await expect(
    page.getByRole("link", { name: "Back to the wind map" }),
  ).toBeVisible();

  await trigger(page).click();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  await expect(row(page, "Marketplace")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(row(page, "Chart")).not.toHaveAttribute("aria-current", "page");

  await row(page, "Chart").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator('[data-view-switch="spots"]')).toBeVisible();
  await expect(trigger(page)).toBeVisible();
});

test("a direct load of a marketplace URL renders the marketplace and its menu", async ({
  page,
}) => {
  // SPA fallback: the server has no /market/sell on disk and must answer with
  // index.html, which is where the pathname picks the marketplace bundle.
  await page.goto("/market/sell");
  await expect(page.locator("[data-top-bar]")).toBeVisible();
  await trigger(page).click();
  await expect(row(page, "Marketplace")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(row(page, "Chart")).toHaveAttribute("href", "/?map");
});

test("the menu carries the reader into the community and back out of it", async ({
  page,
}) => {
  await page.goto("/market");
  await trigger(page).click();
  await row(page, "Community").click();

  await page.waitForURL("**/community");
  await expect(page.locator("[data-top-bar]")).toBeVisible();

  await trigger(page).click();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  await expect(panel(page).locator('[aria-current="page"]')).toHaveText([
    /^Community/,
  ]);
  await expect(row(page, "Marketplace")).toHaveAttribute("href", "/market");

  await row(page, "Chart").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator('[data-view-switch="spots"]')).toBeVisible();
});

test("a direct load of a community URL renders the community and its menu", async ({
  page,
}) => {
  // The same fallback, for the third bundle: no /community/c/wings on disk.
  await page.goto("/community/c/wings");
  await expect(page.locator("[data-top-bar]")).toBeVisible();
  await trigger(page).click();
  await expect(row(page, "Community")).toHaveAttribute("aria-current", "page");
});

test("at 390px the menu shares the top bar's row without wrapping or scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?map");
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

  // The top bar: the name, the search, Spots and the menu on one row, the
  // menu at the far right, the chart's controls under the bar.
  const bar = page.locator("[data-top-bar]");
  const menu = (await trigger(page).boundingBox())!;
  const brand = (await bar.getByText("wingfoil.ie").boundingBox())!;
  const search = (await bar
    .getByRole("button", { name: "Search spots" })
    .boundingBox())!;
  const head = (await bar.boundingBox())!;
  const controls = (await page.locator(".map-ctrl").boundingBox())!;
  expect(
    Math.abs(menu.y + menu.height / 2 - (brand.y + brand.height / 2)),
  ).toBeLessThan(4);
  expect(brand.x + brand.width).toBeLessThanOrEqual(search.x);
  expect(search.x + search.width).toBeLessThanOrEqual(menu.x);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  expect(controls.y).toBeGreaterThanOrEqual(head.y + head.height);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Open, the drawer stands at the right edge, the full height of the
  // screen, and leaves a strip of the map showing beside it. Light or dark
  // is not in it: it is the first part of Settings.
  await trigger(page).click();
  const open = await settled(page);
  expect(open.y).toBe(0);
  expect(open.height).toBe(844);
  expect(open.x).toBeGreaterThan(0);
  await expect(
    drawer(page).getByRole("group", { name: "Appearance" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("light, dark or auto first in Settings: dark by default, changed at once, and the choice kept", async ({
  page,
}) => {
  await page.goto("/?map");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await openFromMenu(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  // The first of its parts.
  await expect(settings.locator("h3").first()).toHaveText("Appearance");
  const appearance = settings.getByRole("group", { name: "Appearance" });
  await expect(
    appearance.getByRole("button", { name: "Dark" }),
  ).toHaveAttribute("aria-pressed", "true");
  await appearance.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  await expect(
    appearance.getByRole("button", { name: "Light" }),
  ).toHaveAttribute("aria-pressed", "true");
  // It is not a draft: closed without saving, it stays.
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  // Auto follows the device.
  await page.emulateMedia({ colorScheme: "dark" });
  await openFromMenu(page, "Settings");
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("group", { name: "Appearance" })
    .getByRole("button", { name: "Auto" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("at 390px the marketplace's top bar takes its own actions without overflowing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/market");
  const bar = page.locator("[data-top-bar]");
  await expect(bar).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The menu at the far right, the section's action and Chart (its glyph
  // only, beside an action) before it, nothing spilling out of the row.
  const menu = (await trigger(page).boundingBox())!;
  const chart = (await bar.getByRole("link", { name: "Chart" }).boundingBox())!;
  const account = (await bar
    .getByRole("navigation", { name: "Marketplace" })
    .boundingBox())!;
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  expect(chart.x + chart.width).toBeLessThanOrEqual(menu.x);
  expect(account.x + account.width).toBeLessThanOrEqual(chart.x);
  expect(Math.abs(menu.y - chart.y)).toBeLessThan(4);
  expect(
    await bar.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await trigger(page).click();
  const open = await settled(page);
  expect(open.x).toBeGreaterThan(0);
});

/**
 * On a finger the trigger's hit area grows to the 44px floor — down the block
 * axis only. A header row has no room along the inline axis, and an overhanging
 * target there silently swallows taps meant for whatever sits beside it. The
 * pseudo-element that does the growing hit-tests as the button, so
 * `elementFromPoint` is the honest way to ask who would receive a tap.
 */
test.describe("on a coarse pointer", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  const ownerAt = (page: Page, x: number, y: number) =>
    page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px as number, py as number);
        return {
          onTrigger: !!el?.closest(".f5-site-menu"),
          tag: el?.tagName ?? null,
        };
      },
      [x, y],
    );

  test("the map's trigger does not reach over the button beside it", async ({
    page,
  }) => {
    await page.goto("/?map");
    expect(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
    ).toBe(true);

    const search = page
      .locator("[data-top-bar]")
      .getByRole("link", { name: "wingfoil.ie, the Spot finder" });
    const box = (await search.boundingBox())!;
    // One pixel inside the name's leading edge, at its middle.
    const owner = await ownerAt(page, box.x + 1, box.y + box.height / 2);
    expect(owner.onTrigger).toBe(false);

    // And the menu's own middle still belongs to the menu.
    const menu = (await trigger(page).boundingBox())!;
    expect(
      (await ownerAt(page, menu.x + menu.width / 2, menu.y + menu.height / 2))
        .onTrigger,
    ).toBe(true);
  });

  test("the marketplace's trigger does not reach over the button beside it", async ({
    page,
  }) => {
    await page.goto("/market");
    const chart = page
      .locator("[data-top-bar]")
      .getByRole("link", { name: "Chart" });
    const box = (await chart.boundingBox())!;
    // One pixel inside the button's trailing edge, at its middle.
    const owner = await ownerAt(
      page,
      box.x + box.width - 1,
      box.y + box.height / 2,
    );
    expect(owner.onTrigger).toBe(false);
    // The menu's own middle belongs to the menu, a thumb's size.
    const menu = (await trigger(page).boundingBox())!;
    expect(menu.height).toBeGreaterThanOrEqual(44);
    expect(
      (await ownerAt(page, menu.x + menu.width / 2, menu.y + menu.height / 2))
        .onTrigger,
    ).toBe(true);
  });
});

/**
 * The owner's ruling of 2026-10-29: the same menu on every page, so
 * Settings, About and the tour are rows on a page that is not the chart's
 * too. From there each is the home page's address with a word on it
 * (force5/src/siteNav.ts `askHref`), which the map answers and takes away.
 */
test("Settings, About and the tour open over the map from another page's menu", async ({
  page,
}) => {
  // The AI page, loaded by itself: its own bundle, so each row is a page load.
  await page.goto("/ai");
  await trigger(page).click();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  await expect(row(page, "Settings")).toHaveAttribute("href", "/?settings");
  await row(page, "Settings").click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Escape");

  // The display options' old address opens Settings, which took them in.
  await page.goto("/?options");
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
    timeout: 30000,
  });
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Escape");

  // About, from the AI page again: the map's information over the list.
  await page.goto("/ai");
  await trigger(page).click();
  await row(page, "About the map").click();
  await expect(page.getByRole("dialog", { name: "About the map" })).toBeVisible(
    { timeout: 30000 },
  );
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Escape");

  // The tour, from the spot finder's own menu: no page load, the chart opens
  // under its first card.
  await trigger(page).click();
  await row(page, "Take the tour").click();
  await expect(page.locator(".tour")).toHaveAttribute("data-step", "lights", {
    timeout: 30000,
  });
  await expect(page).toHaveURL(/\/\?map$/);
});
