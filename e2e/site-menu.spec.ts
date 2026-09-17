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
  await page.keyboard.press("Enter");

  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
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
