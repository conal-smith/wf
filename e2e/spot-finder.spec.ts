import { expect, SPOTS_KEY, test, type Page } from "./fixtures";

/**
 * The spot finder, at /spots (src/finder): the places rated at one hour,
 * best first, beside a plain map, from the chart's own data. Favourites at
 * now by default, every place near the rider on asking; the hour is the
 * chart's selected time, chosen on the week's timeline.
 */

const DUBLIN = { latitude: 53.35, longitude: -6.26 };

/** Star these places before the page's own scripts run. */
const star = (page: Page, ids: string[]) =>
  page.addInitScript(
    ([key, ids]) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify({ starred: ids, visits: {} }));
    },
    [SPOTS_KEY, ids] as const,
  );

const finder = (page: Page) => page.locator("[data-spot-finder]");
const cards = (page: Page) => page.locator("[data-spot-card]");
const timeline = (page: Page) => page.getByRole("slider", { name: "Hour" });
const where = (page: Page) => page.locator("[data-where]");
const when = (page: Page) => page.locator("[data-when]");

/** The finder up, its places rated. */
async function openFinder(page: Page, path = "/spots") {
  await page.goto(path);
  await expect(finder(page)).toBeVisible({ timeout: 30000 });
}

/** Every card's stars, in order: "dark" for an hour with none. */
const starsOnCards = (page: Page) =>
  page
    .locator("[data-spot-card] [data-stars]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-stars")));

/** Press the timeline at a fraction of one of its days. */
async function pressDay(page: Page, day: number, fraction = 0.5) {
  const bar = page.locator("[data-timeline-day]").nth(day);
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + 10);
}

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens on Favourites at now, best first, a pin for each", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await expect(page).toHaveURL(/\/spots$/);
    await expect(where(page)).toContainText("Favourites");
    await expect(where(page)).toHaveAttribute("aria-haspopup", "menu");
    await expect(when(page)).toContainText("Now");
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator("[data-pin]")).toHaveCount(3);
    // Rated, and in order of the stars at the hour.
    await expect
      .poll(async () => (await starsOnCards(page)).length, { timeout: 30000 })
      .toBe(3);
    const stars = (await starsOnCards(page)).map((s) =>
      s === "dark" ? -1 : Number(s),
    );
    expect([...stars].sort((a, b) => b - a)).toEqual(stars);
    // Two columns of cards beside the map, the pill in the middle of the head.
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.y).toBe(a.y);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    const map = (await page.locator("[data-finder-map]").boundingBox())!;
    expect(map.x).toBeGreaterThan(b.x + b.width);
    const pill = (await page.locator("[data-where-when]").boundingBox())!;
    expect(Math.abs(pill.x + pill.width / 2 - 720)).toBeLessThan(2);
    // The day's wind under each card, the hour marked on it.
    await expect(
      cards(page).first().locator("[data-day-bar] i"),
    ).not.toHaveCount(0);
    // A card's star unstars it, and the list follows.
    await cards(page)
      .filter({ hasText: "Keel" })
      .getByRole("button", { name: "Star Keel Beach" })
      .click();
    await expect(cards(page)).toHaveCount(2);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      SPOTS_KEY,
    );
    expect(stored.starred).toEqual(["brandon", "dollymount"]);
  });

  test("with no favourites, says how to have some", async ({ page }) => {
    await openFinder(page);
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Star a spot and it shows here.",
    );
    await expect(cards(page)).toHaveCount(0);
  });

  test("near you lists the places round the rider, asked once", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await star(page, ["brandon"]);
    await openFinder(page);
    // Where is a menu of two, from the keys.
    await where(page).focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Where" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveText([
      /Favourites\s*The spots you've starred/,
      /Near you\s*Every spot around you/,
    ]);
    await expect(
      menu.getByRole("menuitemradio", { name: /Favourites/ }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(where(page)).toContainText("Near you");
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    // Dublin's beaches, and not Brandon, the far side of the country.
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(cards(page).filter({ hasText: "Brandon" })).toHaveCount(0);
    expect(await cards(page).count()).toBeGreaterThan(3);
    // Every one rated, best first.
    await expect
      .poll(async () => (await starsOnCards(page)).length, { timeout: 30000 })
      .toBe(await cards(page).count());
    const stars = (await starsOnCards(page)).map((s) =>
      s === "dark" ? -1 : Number(s),
    );
    expect([...stars].sort((a, b) => b - a)).toEqual(stars);
    const kept = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wingfoil.finder.location.v1") ?? "{}"),
    );
    expect(kept.at.lat).toBeCloseTo(DUBLIN.latitude, 3);
  });

  test("near you, refused, looks round where the chart was, and never asks again", async ({
    page,
  }) => {
    // No permission: the browser says no.
    await page.addInitScript(() =>
      localStorage.setItem(
        "wingfoil.map.centre.v1",
        JSON.stringify({ lat: 53.35, lon: -6.2 }),
      ),
    );
    await openFinder(page);
    await where(page).click();
    await page.getByRole("menuitemradio", { name: /Near you/ }).click();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("wingfoil.finder.location.v1"),
        ),
      )
      .toBe(JSON.stringify({ refused: true }));
  });

  test("an hour picked on the timeline moves the stars, and the chart keeps it", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel", "inch", "tramore"]);
    await openFinder(page);
    await expect
      .poll(async () => (await starsOnCards(page)).length, { timeout: 30000 })
      .toBeGreaterThan(0);
    const slider = timeline(page);
    const now = await slider.getAttribute("aria-valuetext");
    const before = JSON.stringify(await starsOnCards(page));
    // Day after day until the stars differ: the week's wind is not one wind.
    let changed = false;
    for (let day = 1; day < 7 && !changed; day++) {
      await pressDay(page, day, 0.5);
      await expect(when(page)).not.toContainText("Now");
      changed = JSON.stringify(await starsOnCards(page)) !== before;
    }
    expect(changed).toBe(true);
    await expect(when(page)).toContainText(
      /^When[A-Z][a-z]{2} \d+, \d\d:\d\d$/,
    );
    expect(await slider.getAttribute("aria-valuetext")).not.toBe(now);
    await expect(page.locator("[data-timeline-mark]")).toHaveCount(1);
    // Dragged along it, across a day's edge.
    const first = (await page
      .locator("[data-timeline-day]")
      .nth(1)
      .boundingBox())!;
    const second = (await page
      .locator("[data-timeline-day]")
      .nth(2)
      .boundingBox())!;
    await page.mouse.move(first.x + first.width * 0.8, first.y + 10);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width * 0.3, second.y + 10, {
      steps: 8,
    });
    await page.mouse.up();
    const dragged = await slider.getAttribute("aria-valuetext");
    // The keys step it along the light.
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).not.toHaveAttribute("aria-valuetext", dragged!);
    const chosen = await slider.getAttribute("aria-valuetext");
    // In the chart, on a place, at that hour.
    await page.locator("[data-pin]").first().click();
    const card = page.locator("[data-pin-card]");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "In the chart" }).click();
    await expect(page).toHaveURL(/\/\?spot=[\w-]+$/);
    await expect(page.locator(".dock .dk-name")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByRole("slider", { name: "Forecast time" }),
    ).toHaveAttribute("aria-valuetext", chosen!);
    // Back is the finder, at the same hour.
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    await expect(timeline(page)).toHaveAttribute("aria-valuetext", chosen!);
  });

  test("a card's pin grows under it, a pin's card lifts, and a pin opens its card", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount"]);
    await openFinder(page);
    const brandon = cards(page).filter({ hasText: "Brandon" });
    const pin = page.locator('[data-pin="brandon"]');
    await brandon.hover();
    await expect(pin).toHaveAttribute("data-lit", "true");
    await page.mouse.move(5, 5);
    await expect(pin).not.toHaveAttribute("data-lit", "true");
    await page.locator('[data-pin="dollymount"]').hover();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveAttribute(
      "data-lit",
      "true",
    );
    await pin.click();
    const card = page.locator('[data-pin-card="brandon"]');
    await expect(card).toBeVisible();
    await expect(pin).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByRole("link", { name: "Open spot" })).toHaveAttribute(
      "href",
      "/spot/brandon",
    );
    await expect(card.locator("[data-day-bar]")).toBeVisible();
    // The zoom works the map.
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    // Close, and open again from the list.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
    await brandon.click({ position: { x: 40, y: 60 } });
    await expect(card).toBeVisible();
    // Its page opens over the finder, and the way back is the finder.
    await card.getByRole("link", { name: "Open spot" }).click();
    await expect(page).toHaveURL(/\/spot\/brandon$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/spots$/);
    await expect(finder(page)).toBeVisible();
  });

  test("is in the site menu, in place of your spots, and the chart is in its menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Site menu" }).click();
    const tools = page.getByRole("group", { name: "The chart" });
    await expect(tools.getByRole("button", { name: "Your spots" })).toHaveCount(
      0,
    );
    const row = tools.getByRole("link", { name: "Spot finder" });
    await expect(row).toHaveAttribute("href", "/spots");
    await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
    const layers = (await tools
      .getByRole("button", { name: "Layers" })
      .boundingBox())!;
    const options = (await tools
      .getByRole("button", { name: "Display options" })
      .boundingBox())!;
    const box = (await row.boundingBox())!;
    expect(box.y).toBeGreaterThan(layers.y);
    expect(box.y).toBeLessThan(options.y);
    await row.click();
    await expect(page).toHaveURL(/\/spots$/);
    await expect(finder(page)).toBeVisible();
    // No page load: the chart's own data, and its lights, wait behind it.
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
    // The finder's menu: the chart, and the finder marked as the page.
    await page.getByRole("button", { name: "Site menu" }).click();
    const own = page.getByRole("group", { name: "The chart" });
    await expect(
      own.getByRole("link", { name: "Spot finder" }),
    ).toHaveAttribute("aria-current", "page");
    await own.getByRole("link", { name: "Chart" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".spot-marker")).toHaveCount(149);
    // The site's Wind map from the finder is the chart, not the finder again.
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    await page.getByRole("button", { name: "Site menu" }).click();
    await page.getByRole("link", { name: "Wind map" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".map-head")).toBeVisible();
  });

  test("the spot page's menu has the finder too", async ({ page }) => {
    await page.goto("/spot/brandon");
    await page.getByRole("button", { name: "Site menu" }).click();
    const row = page
      .getByRole("group", { name: "The chart" })
      .getByRole("link", { name: "Spot finder" });
    await expect(row).toHaveAttribute("href", "/spots");
    await row.click();
    await expect(finder(page)).toBeVisible({ timeout: 30000 });
  });

  test("the root opens on the page last open; a link that names one wins", async ({
    page,
  }) => {
    await openFinder(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/spots$/);
    await expect(finder(page)).toBeVisible();
    // A link to a spot on the chart is the chart.
    await page.goto("/?spot=brandon");
    await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay", {
      timeout: 30000,
    });
    // And the chart is now the one last open.
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".map-head")).toBeVisible();
    await expect(finder(page)).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a list of one column, the map a press away, and an hour tapped", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await expect(where(page)).toContainText("Favourites");
    await expect(when(page)).toContainText("Now");
    await expect(cards(page)).toHaveCount(3);
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(a.width).toBeGreaterThan(340);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
    // No map until asked for.
    await expect(page.locator("[data-finder-map]")).toHaveCount(0);
    const toggle = page.locator("[data-map-toggle]");
    await expect(toggle).toHaveText(/Map/);
    // The week is wider than the screen: it scrolls sideways under a finger.
    const strip = page.locator("[data-timeline]");
    expect(
      await strip.evaluate(
        (el) => el.parentElement!.scrollWidth > el.parentElement!.clientWidth,
      ),
    ).toBe(true);
    // A tap on a day picks its hour.
    const day = (await page
      .locator("[data-timeline-day]")
      .nth(1)
      .boundingBox())!;
    await page.touchscreen.tap(day.x + day.width / 2, day.y + 10);
    await expect(when(page)).not.toContainText("Now");
    // The map, full screen, and back to the list.
    await toggle.tap();
    await expect(page.locator("[data-finder-map]")).toBeVisible();
    await expect(toggle).toHaveText(/List/);
    await expect(page.locator("[data-pin]")).toHaveCount(3);
    await page.locator('[data-pin="brandon"]').tap();
    const card = page.locator('[data-pin-card="brandon"]');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await toggle.tap();
    await expect(page.locator("[data-finder-map]")).toBeHidden();
    await expect(cards(page).first()).toBeVisible();
  });

  test("Near you on a phone, and an empty favourites", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openFinder(page);
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Star a spot and it shows here.",
    );
    await where(page).tap();
    await page.getByRole("menuitemradio", { name: /Near you/ }).tap();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
  });
});
