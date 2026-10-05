import { expect, test, type Page } from "./fixtures";

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
  panel(page).getByRole("link", { name });
/**
 * The marketplace's header pill: the one box inside its banner, which is
 * Tailwind now and carries no class name worth writing down.
 */
const headerBar = (page: Page) => page.getByRole("banner").locator("> div");
// The same rows in the same order, whichever bundle drew them.
const SECTIONS = ["Wind map", "Marketplace", "Community", "Use with AI"];

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
  await expect(row(page, "Wind map")).toBeFocused();
  await expect(row(page, "Wind map")).toHaveAttribute("aria-current", "page");
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
  await expect(panel(page).getByRole("link")).toHaveText(SECTIONS);
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
  await expect(row(page, "Wind map")).toHaveAttribute("href", "/");
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

  await row(page, "Wind map").click();
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
  await page.goto("/");
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
  expect(Math.abs(menu.y + menu.height / 2 - (brand.y + brand.height / 2))).toBeLessThan(4);
  expect(menu.x + menu.width).toBeLessThanOrEqual(brand.x);
  expect(brand.x + brand.width).toBeLessThanOrEqual(search.x);
  expect(search.x + search.width).toBeLessThanOrEqual(controls.x);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await trigger(page).click();
  const open = (await panel(page).boundingBox())!;
  expect(open.x).toBeGreaterThanOrEqual(0);
  expect(open.x + open.width).toBeLessThanOrEqual(390);
  expect(open.y).toBeGreaterThanOrEqual(menu.y + menu.height);
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

  test("the map's trigger does not reach over the name beside it", async ({
    page,
  }) => {
    await page.goto("/");
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
