import { expect, SPOTS_KEY, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * The spot finder, at /spots (src/finder): the rider's places as cards, the
 * best of the six days first, each with its picture and rose, today hour by
 * hour from first light to last, and the next five days. A page of its own:
 * no map, no timeline, not tied to the chart's time. Favourites by default,
 * every place near the rider on asking.
 */

const DUBLIN = { latitude: 53.35, longitude: -6.26 };

/**
 * Half past one in the afternoon, Irish time, on the sample's day: inside
 * HARMONIE's run, with the afternoon's light ahead. The suite's own clock
 * (`SAMPLE_CLOCK`) is that evening, after last light, when today's row is
 * all hours gone.
 */
const AFTERNOON = new Date(SAMPLE_CLOCK.getTime() - 7.5 * 3600000);

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
const scope = (page: Page) => page.getByRole("group", { name: "Which spots" });

/** The finder up in the afternoon, its places rated. */
async function openFinder(page: Page, path = "/spots") {
  await page.clock.setFixedTime(AFTERNOON);
  await page.goto(path);
  await expect(finder(page)).toBeVisible({ timeout: 30000 });
}

/** Wait until every card is rated, and say each one's best. */
async function rated(page: Page) {
  await expect
    .poll(
      async () =>
        (await cards(page).evaluateAll((els) =>
          els.every((el) => Number(el.getAttribute("data-best")) >= 0),
        )) && (await cards(page).count()) > 0,
      { timeout: 30000 },
    )
    .toBe(true);
  return cards(page).evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute("data-spot-card")!,
      best: Number(el.getAttribute("data-best")),
      day: Number(el.getAttribute("data-best-day") ?? 99),
    })),
  );
}

/** The best first, the soonest among equals. */
const inOrder = (list: { best: number; day: number }[]) =>
  list.every(
    (x, i) =>
      i === 0 ||
      list[i - 1].best > x.best ||
      (list[i - 1].best === x.best && list[i - 1].day <= x.day),
  );

/** Today's hour columns on a card. */
const hours = (page: Page, card = 0) =>
  cards(page).nth(card).locator("[data-today-hours] [data-hour]");

/** Each card's rose: the bearing its wind comes from, or "" with none. */
const roses = (page: Page) =>
  page
    .locator("[data-spot-card] [data-spot-picture]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-rose-from") ?? ""),
    );

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens on Favourites, the best of the week first, two cards a row", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await star(page, ["brandon", "dollymount", "keel", "tramore"]);
    await openFinder(page);
    await expect(page).toHaveURL(/\/spots$/);
    // The head: the menu, the wordmark and the switch, and nothing else.
    await expect(
      scope(page).getByRole("button", { name: "Favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Spots" })).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(page.locator(".maplibregl-map")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(4);
    expect(inOrder(await rated(page))).toBe(true);
    // Two columns: side by side, each wide enough for its hours.
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.y).toBe(a.y);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(a.width).toBeGreaterThan(560);
    // Each card: its name and county, today and the next five days.
    const brandon = cards(page).filter({ hasText: "Brandon Bay" });
    await expect(brandon).toContainText("Co. Kerry");
    await expect(brandon.getByText("Today", { exact: true })).toBeVisible();
    await expect(brandon.locator("[data-next-days] [data-day]")).toHaveCount(5);
    await expect(
      brandon.locator("[data-days-band] [data-day-band]"),
    ).not.toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("today runs from the hour before first light to the hour after last, now marked", async ({
    page,
  }) => {
    await star(page, ["dollymount"]);
    await openFinder(page);
    await rated(page);
    const row = hours(page);
    const count = await row.count();
    // Mid-September in Dublin: about 06:20 to 20:20, so 06:00 to 21:00.
    expect(count).toBeGreaterThanOrEqual(15);
    await expect(row.first()).toHaveAttribute("data-dark", "true");
    await expect(row.last()).toHaveAttribute("data-dark", "true");
    await expect(row.nth(1)).not.toHaveAttribute("data-dark", "true");
    // Now, in the pen's red, ringed while no hour is picked; the hours
    // before it gone.
    const now = row.and(page.locator("[data-now]"));
    await expect(now).toHaveCount(1);
    await expect(now).toContainText("now");
    await expect(now).toHaveAttribute("aria-pressed", "true");
    await expect(row.first()).toHaveAttribute("data-gone", "true");
    // A rated hour has its five stars; the dark has none.
    const lit = row.and(page.locator("[data-stars]")).first();
    await expect(lit.locator("svg[aria-hidden] path")).not.toHaveCount(0);
    await expect(row.first().locator("[class*=fill-stars]")).toHaveCount(0);
    // First and last light are named under the row; the wind lies behind it.
    const card = cards(page).first();
    await expect(card.locator("[data-first-light]")).toContainText(
      /^first light \d\d:\d\d$/,
    );
    await expect(card.locator("[data-last-light]")).toContainText(
      /^last light \d\d:\d\d$/,
    );
    await expect(card.locator("[data-today-facts] [data-light]")).toContainText(
      /^light \d\d:\d\d–\d\d:\d\d$/,
    );
    await expect(
      card.locator("[data-today-hours] [data-wind-band]"),
    ).toHaveCount(1);
  });

  test("the row scrolls with no bar, opening on now, and steps either way", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const card = cards(page).first();
    const scroller = card.locator("[data-hours-scroll]");
    expect(
      await scroller.evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe("none");
    // Now stands in the middle of the view, or as near as the ends allow.
    const middle = async () => {
      const view = (await scroller.boundingBox())!;
      const now = (await card.locator("[data-hour][data-now]").boundingBox())!;
      return Math.abs(now.x + now.width / 2 - (view.x + view.width / 2));
    };
    expect(await middle()).toBeLessThan(60);
    const left = () => scroller.evaluate((el) => el.scrollLeft);
    const later = card.getByRole("button", { name: "Later hours" });
    const earlier = card.getByRole("button", { name: "Earlier hours" });
    /** Press a step, and wait for the row to come to rest after it. */
    const press = async (step: typeof later) => {
      const was = await left();
      await step.click();
      await expect.poll(left).not.toBe(was);
      let last = -1;
      await expect
        .poll(async () => {
          const now = await left();
          const still = now === last;
          last = now;
          return still;
        })
        .toBe(true);
      return [was, await left()];
    };
    // Step to the end: the › goes there, and the ‹ is back.
    const [from, to] = await press(later);
    expect(to).toBeGreaterThan(from);
    for (let i = 0; i < 8 && (await later.isVisible()); i++) await press(later);
    await expect(later).toBeHidden();
    await expect(earlier).toBeVisible();
    for (let i = 0; i < 8 && (await earlier.isVisible()); i++)
      await press(earlier);
    await expect(earlier).toBeHidden();
    expect(await left()).toBe(0);
    // A step is not a press on the card.
    await expect(page).toHaveURL(/\/spots$/);
  });

  test("an hour picked is picked on every card, the roses turned to it; now goes back", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await rated(page);
    await expect
      .poll(async () => (await roses(page)).every(Boolean))
      .toBe(true);
    const before = await roses(page);
    // The last lit hour of the first card's day.
    const pick = hours(page).and(page.locator(":not([data-dark])")).last();
    const time = await pick.getAttribute("data-hour");
    const clock = (await pick.getAttribute("title"))!;
    await pick.click();
    await expect(page).toHaveURL(/\/spots$/);
    // Ringed on every card, and said on every picture.
    for (let i = 0; i < 3; i++) {
      await expect(
        cards(page).nth(i).locator(`[data-hour="${time}"]`),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(cards(page).nth(i).locator("[data-picked-hour]")).toHaveText(
        clock,
      );
    }
    await expect(
      page.locator('[data-hour][data-now][aria-pressed="true"]'),
    ).toHaveCount(0);
    // The roses are that hour's wind.
    await expect
      .poll(async () => JSON.stringify(await roses(page)))
      .not.toBe(JSON.stringify(before));
    // Now goes back, on every card.
    await cards(page).nth(1).locator("[data-hour][data-now]").click();
    await expect(page.locator("[data-picked-hour]")).toHaveCount(0);
    await expect(
      page.locator('[data-hour][data-now][aria-pressed="true"]'),
    ).toHaveCount(3);
    await expect
      .poll(async () => JSON.stringify(await roses(page)))
      .toBe(JSON.stringify(before));
  });

  test("the picture opens the chart there, at the hour picked; the card opens the spot's page", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const keel = cards(page).filter({ hasText: "Keel Beach" });
    const pick = keel
      .locator(
        "[data-today-hours] [data-hour]:not([data-dark]):not([data-gone])",
      )
      .nth(2);
    const clock = (await pick.getAttribute("title"))!;
    await pick.click();
    await keel.getByRole("button", { name: "Keel Beach on the chart" }).click();
    await expect(page).toHaveURL(/\/\?spot=keel$/);
    await expect(page.locator(".dock .dk-name")).toHaveText("Keel Beach", {
      timeout: 30000,
    });
    await expect(
      page.getByRole("slider", { name: "Forecast time" }),
    ).toHaveAttribute("aria-valuetext", new RegExp(`${clock}$`));
    // Back is the finder.
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    // Anywhere else on a card is the spot's own page: its county, here.
    await cards(page)
      .filter({ hasText: "Brandon Bay" })
      .getByText("Co. Kerry")
      .click();
    await expect(page).toHaveURL(/\/spot\/brandon$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/spots$/);
    await expect(finder(page)).toBeVisible();
    // Its name is a link to the same page, for the keys.
    await expect(
      cards(page).getByRole("link", { name: "Brandon Bay" }),
    ).toHaveAttribute("href", "/spot/brandon");
  });

  test("a card's star unstars it, and the list follows", async ({ page }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await expect(cards(page)).toHaveCount(3);
    await cards(page)
      .filter({ hasText: "Keel" })
      .getByRole("button", { name: "Star Keel Beach" })
      .click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page).toHaveURL(/\/spots$/);
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

  test("near you lists the places round the rider, nearest first among equals", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await star(page, ["brandon"]);
    await openFinder(page);
    await scope(page).getByRole("button", { name: "Near you" }).click();
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(
      scope(page).getByRole("button", { name: "Near you" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Dublin's beaches, and not Brandon, the far side of the country.
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(cards(page).filter({ hasText: "Brandon" })).toHaveCount(0);
    expect(await cards(page).count()).toBeGreaterThan(3);
    expect(inOrder(await rated(page))).toBe(true);
    await expect(cards(page).first()).toContainText(/\d+ km · Co\. /);
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
    await scope(page).getByRole("button", { name: "Near you" }).click();
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

  test("high and low water are on a card whose place has a tide, and left off one that has none", async ({
    page,
  }) => {
    // Brandon's station has published turns today; Keel has none.
    const day = AFTERNOON.toISOString().slice(0, 10);
    const events = [
      { time: `${day}T09:10:00Z`, kind: "low", height: 0.8 },
      { time: `${day}T15:25:00Z`, kind: "high", height: 3.6 },
      { time: `${day}T21:40:00Z`, kind: "low", height: 0.9 },
    ];
    await page.route("**/marine/tides.json", (route) =>
      route.fulfill({
        json: {
          schemaVersion: 1,
          kind: "tide",
          stations: [{ id: "Fenit", name: "Fenit", lat: 52.27, lon: -9.86 }],
          spots: {
            brandon: { station: "Fenit", distanceKm: 10.9 },
            keel: { station: null, distanceKm: 60, reason: "Too far." },
          },
        },
      }),
    );
    await page.route("**/marine/tides/Fenit.json", (route) =>
      route.fulfill({
        json: {
          stepMinutes: 30,
          from: `${day}T00:00:00Z`,
          to: `${day}T23:30:00Z`,
          datum: "LAT",
          curve: Array.from({ length: 48 }, () => 2),
          events,
        },
      }),
    );
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    const brandon = cards(page).filter({ hasText: "Brandon Bay" });
    const keel = cards(page).filter({ hasText: "Keel Beach" });
    const facts = brandon.locator("[data-today-facts] [data-tide-time]");
    // The two in the row's hours; the low water at 22:40 is after it.
    await expect(facts).toHaveCount(2, { timeout: 30000 });
    await expect(facts.nth(0)).toHaveText(/^10:10 low water$/);
    await expect(facts.nth(1)).toHaveText(/^16:25 high water$/);
    // Under the hour each falls in.
    const high = brandon.locator('[data-today-hours] [data-tide="high"]');
    await expect(high).toContainText("16:25");
    const column = brandon.locator(
      `[data-hour="${Date.parse(`${day}T15:00:00Z`)}"]`,
    );
    const [h, c] = [(await high.boundingBox())!, (await column.boundingBox())!];
    expect(Math.abs(h.x + h.width / 2 - (c.x + c.width / 2))).toBeLessThan(2);
    await expect(keel.locator("[data-tide-time], [data-tide]")).toHaveCount(0);
  });

  test("is in the site menu, and the chart is in its menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Site menu" }).click();
    const tools = page.getByRole("group", { name: "The chart" });
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

test.describe("on a narrower desktop", () => {
  test.use({ viewport: { width: 1000, height: 900 } });

  test("one card a row, under the room two need", async ({ page }) => {
    await star(page, ["brandon", "dollymount"]);
    await openFinder(page);
    await expect(cards(page)).toHaveCount(2);
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    // A short day's hours spread across the card rather than stop short.
    await rated(page);
    const scroller = cards(page).first().locator("[data-hours-scroll]");
    const [scroll, view] = await scroller.evaluate((el) => [
      el.scrollWidth,
      el.clientWidth,
    ]);
    expect(scroll).toBeGreaterThanOrEqual(view);
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("one column, no wider than the screen, today swiped and an hour tapped", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await expect(
      scope(page).getByRole("button", { name: "Favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
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
    await rated(page);
    // The day is wider than the card: it scrolls sideways under a finger.
    const scroller = cards(page).first().locator("[data-hours-scroll]");
    expect(
      await scroller.evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(true);
    await scroller.evaluate((el) => el.scrollBy({ left: 120 }));
    await expect(
      cards(page).first().getByRole("button", { name: "Earlier hours" }),
    ).toBeVisible();
    // A tap on an hour picks it, on every card.
    const pick = hours(page).and(page.locator(":not([data-gone])")).nth(2);
    const time = await pick.getAttribute("data-hour");
    await pick.tap();
    await expect(
      page.locator(`[data-hour="${time}"][aria-pressed="true"]`),
    ).toHaveCount(3);
    await expect(page).toHaveURL(/\/spots$/);
    // The next five days fit the card.
    const days = cards(page).first().locator("[data-days-band]");
    const box = (await days.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(a.x + a.width);
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
    await scope(page).getByRole("button", { name: "Near you" }).tap();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
  });
});
