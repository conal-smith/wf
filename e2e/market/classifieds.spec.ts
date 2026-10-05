import type { Browser, Page } from "@playwright/test";
import { BUYER, SELLER, expect, test } from "./fixtures";

/**
 * The marketplace in the chart's style, as a reader meets it: the classifieds
 * on a phone and a laptop, an ad, a seller and the sell form. What is asked is
 * what the brand promises (docs/BRAND.md) and what a thumb needs: ruled ads,
 * prices as figures, the chart's stars, one pen mark at most, 44px targets and
 * nothing wider than the screen.
 *
 * It stands on the baseline's fixtures (fixtures.ts) but reads them at the
 * real time, so the newest ad is minutes old and the pen calls it new.
 */

const DEV_USER_KEY = "wingfoil:dev-user";

/** A page in a window of its own, signed in as `who`, at a phone's or a laptop's width. */
async function open(
  browser: Browser,
  baseURL: string | undefined,
  who: string,
  phone: boolean,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: phone,
    hasTouch: phone,
  });
  await context.addInitScript(
    ([key, name]) => localStorage.setItem(key, name),
    [DEV_USER_KEY, who],
  );
  return context.newPage();
}

/** Nothing on the page is wider than the window. */
async function fits(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over, "horizontal overflow").toBeLessThanOrEqual(0);
}

const ads = (page: Page) => page.locator("main a[href^='/market/listing/']");

for (const phone of [true, false]) {
  const width = phone ? "a phone" : "a laptop";

  test(`browse is the classifieds on ${width}`, async ({
    browser,
    baseURL,
    baseline,
  }) => {
    const page = await open(browser, baseURL, BUYER, phone);
    await page.goto("/market");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Second-hand gear: across Ireland",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "7 listings" }),
    ).toBeVisible();
    await expect(ads(page)).toHaveCount(7);

    // Every ad is ruled, not boxed: a heavy rule over it and none at its sides.
    const rule = await ads(page)
      .first()
      .evaluate((a) => {
        const style = getComputedStyle(a);
        return [style.borderTopWidth, style.borderLeftWidth];
      });
    expect(rule).toEqual(["2px", "0px"]);
    // Two up on a phone, more where there is room.
    const tops = await ads(page).evaluateAll((all) =>
      all.slice(0, 2).map((a) => Math.round(a.getBoundingClientRect().top)),
    );
    expect(tops[0]).toBe(tops[1]);

    // The price is a figure, in the mono face.
    const price = ads(page).first().getByText(/^€\d/);
    await expect(price).toHaveCSS("font-family", /IBM Plex Mono/);

    // The pen marks one ad on the view, the newest, and says it in words.
    const pen = page.locator("main .font-hand");
    await expect(pen).toHaveCount(1);
    await expect(pen).toHaveText("new");
    await expect(
      ads(page).filter({ hasText: baseline.noPhoto.title }).locator(".font-hand"),
    ).toHaveCount(1);

    // The seller's stars are the chart's, named for a screen reader.
    await expect(
      ads(page).first().getByRole("img", { name: /out of 5/ }),
    ).toBeVisible();

    // A category is chosen in the display italic, and narrows the ads.
    const wings = page
      .getByRole("group", { name: "Category" })
      .getByRole("button", { name: "Wings" });
    if (phone) {
      const box = await wings.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await wings.click();
    await expect(wings).toHaveAttribute("aria-pressed", "true");
    await expect(wings).toHaveCSS("font-style", "italic");
    await expect(page.getByRole("heading", { name: "1 listing" })).toBeVisible();
    await fits(page);
    await page.context().close();
  });

  test(`an ad, its seller and the sold stamp on ${width}`, async ({
    browser,
    baseURL,
    baseline,
  }) => {
    const page = await open(browser, baseURL, BUYER, phone);
    await page.goto(`/market/listing/${baseline.reviewed.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      baseline.reviewed.title,
    );
    // The ad is the one double-ruled box, and the price its big figure.
    await expect(page.getByText("€900", { exact: true }).first()).toHaveCSS(
      "font-family",
      /IBM Plex Mono/,
    );
    // Rated five by the buyer: the seller's stars, and the buyer's own.
    await expect(
      page.getByRole("img", { name: "5 out of 5" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Particulars" }),
    ).toBeVisible();
    // The Almanac's word, signed by the one puffin on the view.
    const almanac = page.getByRole("complementary", {
      name: "The Almanac's advice",
    });
    await expect(almanac).toContainText("never send a deposit");
    await expect(almanac.locator("svg")).toHaveCount(1);
    await fits(page);

    // The seller, with their figures and their history in tabs.
    await page.getByRole("link", { name: /Maeve Doyle/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Maeve Doyle",
    );
    const reviews = page.getByRole("tab", { name: "Reviews (1)" });
    await reviews.click();
    await expect(reviews).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Met me at the slip/)).toBeVisible();
    await fits(page);

    // Sold: the price struck through in the pen, and said in words.
    await page.goto(`/market/listing/${baseline.sold.id}`);
    await expect(page.getByText("Sold", { exact: true })).toBeVisible();
    await expect(page.getByText("This item has been sold")).toBeVisible();
    await expect(page.locator("main svg .stroke-pen")).toHaveCount(1);
    await page.context().close();
  });

  test(`the sell form and the account on ${width}`, async ({
    browser,
    baseURL,
  }) => {
    const page = await open(browser, baseURL, SELLER, phone);
    await page.goto("/market/sell");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "What are you selling?",
    );
    for (const name of ["Photos", "Details", "Price and place", "Description"])
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Publish listing" }).click();
    await expect(page.getByText(/title of at least 4 characters/)).toBeVisible();
    await fits(page);

    await page.goto("/market/me");
    await expect(page.getByRole("heading", { name: "Live (7)" })).toBeVisible();
    const saved = page.getByRole("tab", { name: "Saved" });
    await saved.click();
    await expect(saved).toHaveAttribute("aria-selected", "true");
    await fits(page);
    await page.context().close();
  });
}

test("a URL that is not a page meets the puffin", async ({ page }) => {
  await page.goto("/market/no-such-page");
  await expect(
    page.getByRole("heading", { name: "That page does not exist" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse listings" })).toBeVisible();
});
