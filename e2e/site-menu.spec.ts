import { expect, test, type Page } from "./fixtures";

/**
 * The one menu that crosses between the two apps on this origin.
 *
 * The marketplace API is not running in this suite, so nothing here touches a
 * listing: the assertions are the header, the menu and the browse page's own
 * chrome, all of which have to render whether or not `/api` answers.
 */

const trigger = (page: Page) => page.getByRole("button", { name: "Site menu" });
const panel = (page: Page) => page.getByRole("navigation", { name: "Site" });
const row = (page: Page, name: string) =>
  panel(page).getByRole("link", { name });

test("on the map the menu opens by keyboard and Escape closes only the menu", async ({
  page,
}) => {
  await page.goto("/");
  // The forecast sheet is open by default, and the map's own global Escape
  // handler closes it. That is the thing the menu must not let through.
  await expect(page.locator(".app-shell.sheet-open")).toHaveCount(1);

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
  await expect(row(page, "Wind map")).toBeFocused();
  await expect(row(page, "Wind map")).toHaveAttribute("aria-current", "page");
  await expect(row(page, "Marketplace")).toHaveAttribute("href", "/market");
  await expect(row(page, "Marketplace")).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(page.locator(".app-shell.sheet-open")).toHaveCount(1);

  // A second Escape, with the menu closed, reaches the map as it always did.
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell.sheet-open")).toHaveCount(0);
});

test("on the map the menu opens by click and closes on a click outside", async ({
  page,
}) => {
  await page.goto("/");
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  // Anything outside the menu closes it; the Layers button is a real control
  // rather than a spot on the map, so the click cannot move the camera.
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");
});

test("closing through the trigger returns focus to it, even unfocused", async ({
  page,
}) => {
  await page.goto("/");
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  // Safari does not focus a button it was clicked on, so the handler has to put
  // focus back itself or it lands on the body. Dispatching the click without
  // the focus that usually comes with it is what that looks like from here.
  await trigger(page).evaluate((el) => {
    (el as HTMLElement).blur();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  await expect(panel(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test("the menu carries the reader between the map and the marketplace", async ({
  page,
}) => {
  await page.goto("/");
  await trigger(page).click();
  await row(page, "Marketplace").click();

  await page.waitForURL("**/market");
  await expect(
    page.getByRole("heading", { name: /Second-hand wingfoil gear/ }),
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
  await expect(row(page, "Marketplace")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(row(page, "Wind map")).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  await row(page, "Wind map").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator(".site-header")).toBeVisible();
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
  await expect(row(page, "Wind map")).toHaveAttribute("href", "/");
});

test("at 390px the menu shares the header row without wrapping or scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const overflow = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );

  const menu = (await trigger(page).boundingBox())!;
  const search = (await page
    .getByRole("button", { name: "Open spot search" })
    .boundingBox())!;
  const topbar = (await page.locator(".map-topbar").boundingBox())!;
  // One row, in order, clear of the top-right chrome.
  expect(Math.abs(menu.y - search.y)).toBeLessThan(1);
  expect(menu.x + menu.width).toBeLessThanOrEqual(search.x);
  expect(search.x + search.width).toBeLessThanOrEqual(topbar.x);
  expect(menu.height).toBeGreaterThanOrEqual(40);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await trigger(page).click();
  const open = (await panel(page).boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(390);
  expect(open.y).toBeGreaterThanOrEqual(menu.y + menu.height);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // With the search open the whole row stands down, so the panel keeps the
  // header's width and its usual place.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Open spot search" }).click();
  await expect(trigger(page)).toBeHidden();
  const box = (await page.locator(".search-box").boundingBox())!;
  expect(box.y).toBeLessThanOrEqual(menu.y + 1);
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
    await page
      .locator(".mk-header__bar")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await trigger(page).click();
  const open = (await panel(page).boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(390);
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

  test("the map's trigger does not reach over the search button", async ({
    page,
  }) => {
    await page.goto("/");
    expect(
      await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches),
    ).toBe(true);

    const search = page.getByRole("button", { name: "Open spot search" });
    const box = (await search.boundingBox())!;
    // One pixel inside the search trigger's leading edge, at its middle.
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
    const bar = (await page.locator(".mk-header__bar").boundingBox())!;
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
