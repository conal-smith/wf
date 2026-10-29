import {
  expect,
  layersRail,
  menuRow,
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
/**
 * The marketplace's header pill: the one box inside its banner, which is
 * Tailwind now and carries no class name worth writing down.
 */
const headerBar = (page: Page) => page.getByRole("banner").locator("> div");
// The same rows in the same order, whichever bundle drew them.
const SECTIONS = SITE_ROWS;

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
    const rows = await panel(page).getByRole("link").allTextContents();
    const marked = await panel(page)
      .locator('[aria-current="page"]')
      .allTextContents();
    const own = await drawer(page).getByRole("group").count();
    const lists = await panel(page).locator("ul").count();
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    return { rows, marked, own, lists };
  };
  await page.goto("/?map");
  await expect(page.locator(".map-head")).toBeVisible({ timeout: 30000 });
  const chart = await read();
  await page.goto("/");
  await expect(page.locator("[data-spot-finder]")).toBeVisible({
    timeout: 30000,
  });
  const spots = await read();
  expect(chart.rows).toEqual(SECTIONS);
  expect(spots.rows).toEqual(chart.rows);
  expect(chart.marked).toEqual(["Chart"]);
  expect(spots.marked).toEqual(["Spot finder"]);
  // No part of a page's own on either, and the same four groups.
  expect(chart.own).toBe(0);
  expect(spots.own).toBe(0);
  expect(chart.lists).toBe(4);
  expect(spots.lists).toBe(4);
  // "Wind map" was the chart a second time: it is gone.
  await trigger(page).click();
  await expect(drawer(page)).not.toContainText("Wind map");
});

/** The drawer itself: the modal the trigger opens. */
const drawer = (page: Page) => page.getByRole("dialog", { name: "Site menu" });

/** Where the drawer stands, once it has slid in. */
async function settled(page: Page) {
  await expect(drawer(page)).toBeVisible();
  await expect.poll(async () => (await drawer(page).boundingBox())?.x).toBe(0);
  return (await drawer(page).boundingBox())!;
}

test("the menu is a drawer from the left, over the dimmed map, with a glyph on every row", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  const box = await settled(page);
  // The left edge, the screen's full height, and clear of the right of it.
  expect(box.y).toBe(0);
  expect(box.height).toBe(page.viewportSize()!.height);
  expect(box.width).toBeLessThanOrEqual(320);
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
  const rows = drawer(page).locator("li > :is(a, button)");
  await expect(rows).toHaveText(SECTIONS);
  for (const row of await rows.all())
    await expect(row.locator("svg")).toHaveCount(1);
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
  await page.mouse.click(box.x + box.width + 200, 500);
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
 * A finger pushes the drawer back off to the left: it follows the finger, and
 * let go past the line it shuts, short of it it springs back. The mouse's
 * pointer events stand in for a finger's here: the drawer reads either.
 */
test("a drag to the left puts the drawer away, and a short one springs back", async ({
  page,
}) => {
  await page.goto("/?map");
  await trigger(page).click();
  const box = await settled(page);
  // From the drawer's own paper, under its rows.
  const x = box.x + box.width - 30;
  const y = box.y + box.height - 60;
  const left = async () => (await drawer(page).boundingBox())!.x;

  // A short drag: it follows, then springs back.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 20, y, { steps: 4 });
  await page.mouse.move(x - 40, y, { steps: 4 });
  expect(await left()).toBeLessThan(-30);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect.poll(left).toBe(0);
  await expect(drawer(page)).toBeVisible();

  // Past the line: it goes, and the focus is back on the trigger.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 12 });
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
  const options = (await menuRow(page, "Display options").boundingBox())!;
  const x = options.x + options.width / 2;
  const y = options.y + options.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 12 });
  await page.mouse.up();
  await expect(drawer(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(
    page.getByRole("dialog", { name: "Display options" }),
  ).toHaveCount(0);

  // And a tap on a row is still a press of it.
  await trigger(page).click();
  await settled(page);
  await menuRow(page, "Display options").click();
  await expect(
    page.getByRole("dialog", { name: "Display options" }),
  ).toBeVisible();
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
      send("pointermove", at.x - 12);
      send("pointermove", at.x - 24);
      send("pointermove", at.x - 36);
      send("pointerup", at.x - 36);
    },
    { x: box.x + box.width - 30, y: box.y + box.height - 60 },
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
    page.getByRole("heading", { name: /Second-hand gear/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "wingfoil.ie Market, home" }),
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
  await expect(page.locator(".map-head")).toBeVisible();
  await expect(trigger(page)).toBeVisible();
});

test("a direct load of a marketplace URL renders the marketplace and its menu", async ({
  page,
}) => {
  // SPA fallback: the server has no /market/sell on disk and must answer with
  // index.html, which is where the pathname picks the marketplace bundle.
  await page.goto("/market/sell");
  await expect(
    page.getByRole("link", { name: "wingfoil.ie Market, home" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("link", { name: "wingfoil.ie Community, home" }),
  ).toBeVisible();

  await trigger(page).click();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  await expect(panel(page).locator('[aria-current="page"]')).toHaveText([
    "Community",
  ]);
  await expect(row(page, "Marketplace")).toHaveAttribute("href", "/market");

  await row(page, "Chart").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator(".map-head")).toBeVisible();
});

test("a direct load of a community URL renders the community and its menu", async ({
  page,
}) => {
  // The same fallback, for the third bundle: no /community/c/wings on disk.
  await page.goto("/community/c/wings");
  await expect(
    page.getByRole("link", { name: "wingfoil.ie Community, home" }),
  ).toBeVisible();
  await trigger(page).click();
  await expect(row(page, "Community")).toHaveAttribute("aria-current", "page");
});

test("at 390px the menu shares the header row without wrapping or scrolling", async ({
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

  // The chart's head: the menu, the name and "Find a spot…" on one row, clear
  // of the controls on the right.
  const menu = (await trigger(page).boundingBox())!;
  const brand = (await page.locator(".map-brand").boundingBox())!;
  const search = (await page
    .getByRole("combobox", { name: "Find a spot" })
    .boundingBox())!;
  const controls = (await page.locator(".map-ctrl").boundingBox())!;
  expect(
    Math.abs(menu.y + menu.height / 2 - (brand.y + brand.height / 2)),
  ).toBeLessThan(4);
  expect(menu.x + menu.width).toBeLessThanOrEqual(brand.x);
  expect(brand.x + brand.width).toBeLessThanOrEqual(search.x);
  expect(search.x + search.width).toBeLessThanOrEqual(controls.x);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Open, the drawer stands at the left edge, the full height of the
  // screen, and leaves a strip of the map showing beside it.
  await trigger(page).click();
  const open = await settled(page);
  expect(open.y).toBe(0);
  expect(open.height).toBe(844);
  expect(open.x + open.width).toBeLessThan(390);
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("at 390px the marketplace header takes the menu without squeezing a label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/market");
  await expect(
    page.getByRole("link", { name: "wingfoil.ie Market, home" }),
  ).toBeVisible();

  const menu = (await trigger(page).boundingBox())!;
  const brand = (await page
    .getByRole("link", { name: "wingfoil.ie Market, home" })
    .boundingBox())!;
  expect(menu.x + menu.width).toBeLessThanOrEqual(brand.x);

  // The bar shrinks its own insets to make room, so the menu costs the labels
  // beside it nothing: "Sign in" is laid out exactly as it is with the menu
  // taken out of the row. Measured against itself rather than against a number,
  // and only once the webfont has settled — this header is tight at 390px with
  // the fallback metrics whatever is in it, and the question here is whether
  // the menu made it tighter.
  await page.evaluate(() => document.fonts.ready);
  const label = page
    .getByRole("navigation", { name: "Marketplace" })
    .getByText("Sign in", { exact: true });
  const height = () =>
    label.evaluate((el) => el.getBoundingClientRect().height);
  const withMenu = await height();
  await page
    .locator(".f5-site-menu")
    .evaluate((el: HTMLElement) => (el.style.display = "none"));
  expect(withMenu).toBe(await height());
  await page
    .locator(".f5-site-menu")
    .evaluate((el: HTMLElement) => (el.style.display = ""));

  // Nothing inside the pill overflows it, font or no font.
  expect(
    await headerBar(page).evaluate((el) => el.scrollWidth - el.clientWidth),
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
  expect(open.x + open.width).toBeLessThan(390);
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

  test("the map's trigger does not reach over the name beside it", async ({
    page,
  }) => {
    await page.goto("/?map");
    expect(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
    ).toBe(true);

    const search = page.locator(".map-brand");
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

  test("the marketplace's trigger does not reach over the brand link", async ({
    page,
  }) => {
    await page.goto("/market");
    const brand = page.getByRole("link", { name: "wingfoil.ie Market, home" });
    const box = (await brand.boundingBox())!;
    const owner = await ownerAt(page, box.x + 1, box.y + box.height / 2);
    expect(owner.onTrigger).toBe(false);

    // The grown area also stays inside the header pill it sits in.
    const bar = (await headerBar(page).boundingBox())!;
    const menu = (await trigger(page).boundingBox())!;
    const grown = await trigger(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const after = getComputedStyle(el, "::after");
      return {
        height: parseFloat(after.height) || rect.height,
        width: parseFloat(after.width) || rect.width,
      };
    });
    expect(grown.height).toBeGreaterThanOrEqual(44);
    expect(grown.width).toBeLessThanOrEqual(menu.width + 0.5);
    const top = menu.y + menu.height / 2 - grown.height / 2;
    expect(top).toBeGreaterThanOrEqual(bar.y - 0.5);
    expect(top + grown.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
  });
});

/**
 * The owner's ruling of 2026-10-29: the same menu on every page, so the
 * display options, About and the tour are rows on a page that is not the
 * chart's too. From there each is the home page's address with a word on it
 * (force5/src/siteNav.ts `askHref`), which the map answers and takes away.
 */
test("the display options, About and the tour open over the map from another page's menu", async ({
  page,
}) => {
  // The AI page, loaded by itself: its own bundle, so each row is a page load.
  await page.goto("/ai");
  await trigger(page).click();
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
  await expect(row(page, "Display options")).toHaveAttribute(
    "href",
    "/?options",
  );
  await row(page, "Display options").click();
  // The display options are the chart's: it opens, with them over it.
  await expect(
    page.getByRole("dialog", { name: "Display options" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/\?map$/);
  await page.keyboard.press("Escape");

  // About, from the AI page again: the map's information over the list.
  await page.goto("/ai");
  await trigger(page).click();
  await row(page, "About").click();
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
