import {
  expect,
  siteNav,
  siteRow,
  SITE_ROWS,
  SPOTS_KEY,
  test,
  type Page,
} from "./fixtures";
import { SAMPLE_CLOCK } from "./columns";

/**
 * The spot finder, the home page (src/finder): the rider's places as cards,
 * the best of the six days first, each with its picture and rose, today hour
 * by hour from first light to last, and the next five days. No timeline, not
 * tied to the chart's time; on a wide screen the chart stands beside it
 * (e2e/home-chart.spec.ts). Favourites once the rider has starred a place,
 * else every place near the rider; either on asking.
 */

const DUBLIN = { latitude: 53.35, longitude: -6.26 };
/** The middle of Ireland, with no spot within 30 km. */
const ATHLONE = { latitude: 53.42, longitude: -7.94 };
const LOCATION_KEY = "wingfoil.finder.location.v1";

/**
 * A browser that asks where the rider is and has not been answered: the
 * answer comes when the test calls `window.answerWhere()`.
 */
const unanswered = (page: Page, at: { latitude: number; longitude: number }) =>
  page.addInitScript((at) => {
    const waiting: PositionCallback[] = [];
    const w = window as unknown as { answerWhere: () => void };
    w.answerWhere = () =>
      waiting.splice(0).forEach((ok) =>
        ok({
          coords: { ...at, accuracy: 10 },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition),
      );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: PositionCallback) => waiting.push(ok),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  }, at);

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
/** "Use my location": the one way the browser is asked where the rider is. */
const useMyLocation = (page: Page) =>
  page.getByRole("button", { name: "Use my location" }).click();
const cards = (page: Page) => page.locator("[data-spot-card]");
const scope = (page: Page) => page.getByRole("group", { name: "Which spots" });
/** The magnifier in the head, which opens the search and its filters. */
const findButton = (page: Page) =>
  page.getByRole("button", { name: /^Find a spot and filter/ });

/** The finder up in the afternoon, its places rated. */
async function openFinder(page: Page, path = "/") {
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

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens on Favourites, the best first, one card a row in a narrow list beside a plain chart", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await star(page, ["brandon", "dollymount", "keel", "tramore"]);
    await openFinder(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(
      scope(page).getByRole("button", { name: "Favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(cards(page)).toHaveCount(4);
    expect(inOrder(await rated(page))).toBe(true);
    // One column, a narrow list (400px), the chart taking the rest.
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(a.width).toBeLessThanOrEqual(420);
    const chart = (await page
      .getByRole("region", { name: "The chart, at the spots on the list" })
      .boundingBox())!;
    expect(chart.x).toBeGreaterThan(a.x + a.width);
    expect(chart.width).toBeGreaterThan(900);
    // A card: its picture, its name and county, and today's wind and stars
    // as two bars with the hour shown ticked on them.
    const brandon = cards(page).filter({ hasText: "Brandon Bay" });
    await expect(brandon).toContainText("Co. Kerry");
    await expect(brandon.locator('[data-bar="wind"]')).toBeVisible();
    await expect(brandon.locator('[data-bar="stars"]')).toBeVisible();
    await expect(brandon.locator("[data-shown-tick]").first()).toBeAttached();
    await expect(brandon.locator("[data-next-days]")).toHaveCount(0);
    // The map's two modes at its foot: Spots, pressed, and Chart.
    const modes = page.locator("[data-panel-modes]");
    await expect(modes.getByRole("button", { name: "Spots" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(modes.getByRole("button", { name: "Chart" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a press on a card's bars picks that hour on every card", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const tick = (card: number) =>
      cards(page)
        .nth(card)
        .locator('[data-bar="stars"] [data-shown-tick]')
        .getAttribute("style");
    const before = [await tick(0), await tick(1)];
    const bar = cards(page).nth(0).locator('[data-bar="wind"]');
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await expect(page.locator("[data-picked-hour]")).toHaveCount(2);
    await expect.poll(() => tick(0)).not.toBe(before[0]);
    expect(await tick(1)).toBe(await tick(0));
  });

  test("while the places and their hours load, the cards hold their shape and say so", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount"]);
    let places!: () => void;
    const placesHeld = new Promise<void>((done) => (places = done));
    await page.route("**/spots.json", async (route) => {
      await placesHeld;
      await route.continue();
    });
    await page.clock.setFixedTime(AFTERNOON);
    await page.goto("/");
    const list = page.locator("[data-finder-list]");
    const ghosts = page.locator("[data-card-skeleton]");
    await expect(ghosts).toHaveCount(2);
    await expect(ghosts.first()).toContainText("Loading the spots…");
    await expect(list).toHaveAttribute("aria-busy", "true");
    const ghost = (await ghosts.first().boundingBox())!;
    places();
    await expect(cards(page)).toHaveCount(2);
    await expect(ghosts).toHaveCount(0);
    const card = (await cards(page).first().boundingBox())!;
    expect(Math.abs(card.y - ghost.y)).toBeLessThan(2);
    expect(Math.abs(card.height - ghost.height)).toBeLessThan(4);
  });

  test("the picture opens the chart there; the card opens the spot's page; Chart opens the full chart", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const keel = cards(page).filter({ hasText: "Keel Beach" });
    await keel.getByRole("button", { name: "Keel Beach on the chart" }).click();
    await expect(page).toHaveURL(/\/\?spot=keel$/);
    await expect(page.locator(".dock .dk-name")).toHaveText("Keel Beach", {
      timeout: 30000,
    });
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    await cards(page)
      .filter({ hasText: "Brandon Bay" })
      .getByText("Co. Kerry")
      .click();
    await expect(page).toHaveURL(/\/spot\/brandon$/);
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    await expect(
      cards(page).getByRole("link", { name: "Brandon Bay" }),
    ).toHaveAttribute("href", "/spot/brandon");
    await page.locator("[data-panel-chart]").click();
    await expect(page.locator('.workspace[data-chart="full"]')).toBeVisible({
      timeout: 30000,
    });
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
    await expect(page).toHaveURL(/\/$/);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      SPOTS_KEY,
    );
    expect(stored.starred).toEqual(["brandon", "dollymount"]);
  });

  test("a first visit, with no favourites, opens on Nearby; Favourites says how to have some", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(
      scope(page).getByRole("button", { name: "Nearby" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Not asked yet: told why the place is wanted, and the spots nearest the
    // middle of Ireland meanwhile, with no distance that is not the rider's.
    await expect(page.locator("[data-finder-ask]")).toContainText(
      "Nearby lists the spots within 30 km of where you are.",
    );
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await expect(cards(page).filter({ hasText: / km · / })).toHaveCount(0);
    // Asked on the rider's word, and the browser said where they are.
    await useMyLocation(page);
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.locator("[data-finder-ask]")).toHaveCount(0);
    await expect(cards(page).first()).toContainText(/\d+ km.*Co\. /);
    await expect(page.locator("[data-finder-note]")).toHaveCount(0);
    await scope(page).getByRole("button", { name: "Favourites" }).click();
    const empty = page.locator("[data-finder-empty]");
    await expect(empty).toContainText("Star a spot and it shows here.");
    await expect(cards(page)).toHaveCount(0);
    // And a way from it to a spot to star: the search in the head, Nearby,
    // or every spot's page.
    await expect(findButton(page)).toBeVisible();
    await expect(
      empty.getByRole("link", { name: "browse every spot" }),
    ).toHaveAttribute("href", "/spot");
    await empty.getByRole("link", { name: "spots nearby" }).click();
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(page).toHaveURL(/\/\?tab=near$/);
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1);
  });

  test("the tab is in the address: chosen, reloaded, linked to, and kept through the full chart", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount"]);
    await openFinder(page);
    // A bare root opens as it always did, and names no tab.
    await expect(finder(page)).toHaveAttribute("data-scope", "favourites");
    await expect(page).toHaveURL(/\/$/);
    await scope(page).getByRole("button", { name: "Nearby" }).click();
    await expect(page).toHaveURL(/\/\?tab=near$/);
    await page.reload();
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(
      scope(page).getByRole("button", { name: "Nearby" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Through the full chart and back, the address still names it.
    await page.getByRole("button", { name: "Full chart" }).click();
    await expect(page).toHaveURL(/\/\?map$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/\?tab=near$/);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    // A link to the other tab opens on it.
    await openFinder(page, "/?tab=favourites");
    await expect(finder(page)).toHaveAttribute("data-scope", "favourites");
    await expect(cards(page)).toHaveCount(2);
    // So does the old address, sent on to the root.
    await openFinder(page, "/spots?tab=near");
    await expect(page).toHaveURL(/\/\?tab=near$/);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
  });

  test("a spot is found by name, from every spot, in the search in the head; Clear goes back to the tab", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount"]);
    await openFinder(page);
    await expect(cards(page)).toHaveCount(2);
    const find = page.getByRole("searchbox", { name: "Find a spot" });
    const search = async (words: string) => {
      await findButton(page).click();
      await expect(find).toBeFocused();
      await find.fill(words);
      await find.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "Find a spot" }),
      ).toHaveCount(0);
    };
    await search("keel");
    await expect(cards(page).first()).toHaveAttribute("data-spot-card", "keel");
    // The places the words name, not the tab's.
    await expect(
      page.locator('[data-spot-card="brandon"], [data-spot-card="dollymount"]'),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Spots found" }),
    ).toBeVisible();
    // Said over the cards, and on the magnifier.
    await expect(page.locator("[data-finder-using]")).toHaveText(
      /Spots named “keel”/,
    );
    await expect(findButton(page)).toHaveAccessibleName(
      "Find a spot and filter (in use)",
    );
    // Accents and case are let go of, and a name's start comes first.
    await search("BRAND");
    await expect(cards(page).first()).toHaveAttribute(
      "data-spot-card",
      "brandon",
    );
    await search("no such place");
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "No spot by that name.",
    );
    await page
      .locator("[data-finder-using]")
      .getByRole("button", { name: "Clear" })
      .click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator("[data-finder-using]")).toHaveCount(0);
    // A tab chosen puts the words down.
    await search("keel");
    await scope(page).getByRole("button", { name: "Nearby" }).click();
    await findButton(page).click();
    await expect(find).toHaveValue("");
  });

  test("Nearby never asks the browser unasked: only Use my location does", async ({
    page,
  }) => {
    await unanswered(page, DUBLIN);
    await page.addInitScript(() => {
      const w = window as unknown as { asked: number };
      w.asked = 0;
      const geo = navigator.geolocation;
      const ask = geo.getCurrentPosition.bind(geo);
      geo.getCurrentPosition = (...args) => {
        w.asked++;
        ask(...args);
      };
    });
    const asked = () =>
      page.evaluate(() => (window as unknown as { asked: number }).asked);
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await scope(page).getByRole("button", { name: "Favourites" }).click();
    await scope(page).getByRole("button", { name: "Nearby" }).click();
    expect(await asked()).toBe(0);
    await useMyLocation(page);
    expect(await asked()).toBe(1);
  });

  test("the list put in order, by its stars, and rated from another model", async ({
    page,
  }) => {
    await star(page, ["tramore", "brandon", "keel", "dollymount"]);
    await openFinder(page);
    await rated(page);
    // The filters are in the search, under its funnel; the list behind it
    // follows them as they are set.
    await findButton(page).click();
    // A to Z.
    await page.getByRole("combobox", { name: "Order" }).selectOption("name");
    const names = await cards(page).evaluateAll((els) =>
      els.map((el) => el.querySelector("h3")?.textContent?.trim() ?? ""),
    );
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Nearest needs the rider's place, which this browser has not given.
    await expect(
      page.getByRole("combobox", { name: "Order" }).locator("option"),
    ).toHaveText(["Best first", "A to Z"]);
    // Only the places with five stars in their six days, or a line saying
    // there are none.
    await page
      .getByRole("combobox", { name: "Stars in the next six days" })
      .selectOption("5");
    const best = await cards(page).evaluateAll((els) =>
      els.map((el) => Number(el.getAttribute("data-best"))),
    );
    if (best.length) expect(best.every((n) => n === 5)).toBe(true);
    else
      await expect(page.locator("[data-finder-empty]")).toHaveText(
        "No spot on this list has 5 stars in the next six days.",
      );
    // The model: the rider's own, kept, as the spot page sets it.
    await page
      .getByRole("combobox", { name: "Model for the stars" })
      .selectOption("ecmwf");
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("force5.prefs.v1") ?? ""),
      )
      .toContain("ecmwf");
  });

  test("a first visit with the location refused lists the spots nearest the middle of Ireland, and never asks again", async ({
    page,
  }) => {
    // No permission: the browser says no, once asked.
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await useMyLocation(page);
    await expect(page.locator("[data-finder-ask]")).toHaveCount(0);
    await expect(page.locator("[data-finder-note]")).toHaveText(
      "We don’t know where you are, so these are the spots nearest the middle of Ireland.",
    );
    await expect(page.locator("[data-finder-empty]")).toHaveCount(0);
    // No distance from a place the rider is not at.
    await expect(cards(page).filter({ hasText: / km · / })).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), LOCATION_KEY),
      )
      .toBe(JSON.stringify({ refused: true }));
    // Back again: the same list, and the browser is not asked.
    await page.addInitScript(() => {
      const w = window as unknown as { asked: number };
      w.asked = 0;
      const geo = navigator.geolocation;
      const ask = geo.getCurrentPosition.bind(geo);
      geo.getCurrentPosition = (...args) => {
        w.asked++;
        ask(...args);
      };
    });
    await page.reload();
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    expect(
      await page.evaluate(() => (window as unknown as { asked: number }).asked),
    ).toBe(0);
  });

  test("while the browser is asked, says so; the rider's answer lists the spots round them", async ({
    page,
  }) => {
    await unanswered(page, DUBLIN);
    await openFinder(page);
    await useMyLocation(page);
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Finding spots nearby…",
    );
    await expect(cards(page)).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { answerWhere: () => void }).answerWhere(),
    );
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.locator("[data-finder-empty]")).toHaveCount(0);
  });

  test("a browser that never answers: after a few seconds, the spots nearest the middle of Ireland", async ({
    page,
  }) => {
    await unanswered(page, DUBLIN);
    await openFinder(page);
    await useMyLocation(page);
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Finding spots nearby…",
    );
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await expect(page.locator("[data-finder-note]")).toBeVisible();
    // A late answer still brings the spots round the rider.
    await page.evaluate(() =>
      (window as unknown as { answerWhere: () => void }).answerWhere(),
    );
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.locator("[data-finder-note]")).toHaveCount(0);
  });

  test("a rider with nothing within 30 km is told so", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(ATHLONE);
    await openFinder(page);
    await useMyLocation(page);
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "No spots within 30 km of you.",
      { timeout: 30000 },
    );
    await expect(cards(page)).toHaveCount(0);
  });

  test("with favourites, opens on them and does not ask where the rider is", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { asked: number };
      w.asked = 0;
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: () => w.asked++,
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      });
    });
    await star(page, ["brandon"]);
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "favourites");
    await expect(cards(page)).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as { asked: number }).asked),
    ).toBe(0);
  });

  test("nearby lists the places round the rider, nearest first among equals", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await star(page, ["brandon"]);
    await openFinder(page);
    await scope(page).getByRole("button", { name: "Nearby" }).click();
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(
      scope(page).getByRole("button", { name: "Nearby" }),
    ).toHaveAttribute("aria-pressed", "true");
    await useMyLocation(page);
    // Dublin's beaches, and not Brandon, the far side of the country.
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(cards(page).filter({ hasText: "Brandon" })).toHaveCount(0);
    expect(await cards(page).count()).toBeGreaterThan(3);
    expect(inOrder(await rated(page))).toBe(true);
    await expect(cards(page).first()).toContainText(/\d+ km.*Co\. /);
    const kept = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wingfoil.finder.location.v1") ?? "{}"),
    );
    expect(kept.at.lat).toBeCloseTo(DUBLIN.latitude, 3);
  });

  test("nearby, refused, looks round where the chart was, and never asks again", async ({
    page,
  }) => {
    await star(page, ["brandon"]);
    // No permission: the browser says no.
    await page.addInitScript(() =>
      localStorage.setItem(
        "wingfoil.map.centre.v1",
        JSON.stringify({ lat: 53.35, lon: -6.2 }),
      ),
    );
    await openFinder(page);
    await scope(page).getByRole("button", { name: "Nearby" }).click();
    await useMyLocation(page);
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(cards(page)).toHaveCount(12);
    await expect(page.locator("[data-finder-note]")).toHaveText(
      "We don’t know where you are, so these are the spots nearest the part of the chart you last looked at.",
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("wingfoil.finder.location.v1"),
        ),
      )
      .toBe(JSON.stringify({ refused: true }));
  });

  test("high and low water are left off the cards, a place with a tide or without (the owner's ruling of 2026-10-28)", async ({
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
    await rated(page);
    await expect(brandon.locator('[data-bar="wind"]')).toBeVisible();
    await expect(brandon.locator("[data-tide-time], [data-tide]")).toHaveCount(
      0,
    );
    await expect(keel.locator("[data-tide-time], [data-tide]")).toHaveCount(0);
  });

  test("is in the site menu, the home page, and the chart is in its menu", async ({
    page,
  }) => {
    await page.goto("/?map");
    await expect(page.locator(".spot-marker")).toHaveCount(149, {
      timeout: 30000,
    });
    await page.getByRole("button", { name: "Site menu" }).click();
    const row = siteRow(page, "Spot finder");
    await expect(row).toHaveAttribute("href", "/");
    await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
    // Second in the navigation, under the chart and over Settings and the
    // display options.
    const chart = (await siteRow(page, "Chart").boundingBox())!;
    const settings = (await siteRow(page, "Settings").boundingBox())!;
    const options = (await siteRow(page, "Display options").boundingBox())!;
    const box = (await row.boundingBox())!;
    expect(chart.y).toBeLessThan(box.y);
    expect(box.y).toBeLessThan(settings.y);
    expect(settings.y).toBeLessThan(options.y);
    await row.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(finder(page)).toBeVisible();
    // No page load: the chart's own data, and its lights, wait behind it.
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
    // The finder's menu: the same navigation, the finder marked as the page.
    await page.getByRole("button", { name: "Site menu" }).click();
    await expect(siteRow(page, "Spot finder")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(siteRow(page, "Display options")).toBeVisible();
    await siteRow(page, "Chart").click();
    await expect(page).toHaveURL(/\/\?map$/);
    await expect(page.locator(".spot-marker")).toHaveCount(149);
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
    // Settings from the finder opens over it, with no page load.
    await page.goBack();
    await expect(finder(page)).toBeVisible();
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Settings").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the spot page's menu is the same navigation, the finder and Settings in it", async ({
    page,
  }) => {
    await page.goto("/spot/brandon");
    await page.getByRole("button", { name: "Site menu" }).click();
    await expect(siteNav(page).getByRole("link")).toHaveText(SITE_ROWS);
    // Neither of the menu's pages is this one, and it has no tools of its own.
    await expect(siteNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Site menu" }).getByRole("group"),
    ).toHaveCount(0);
    await expect(siteRow(page, "Settings")).toHaveAttribute(
      "href",
      "/?settings",
    );
    const row = siteRow(page, "Spot finder");
    await expect(row).toHaveAttribute("href", "/");
    await row.click();
    await expect(finder(page)).toBeVisible({ timeout: 30000 });
  });

  test("Settings from a spot's page is the home page with Settings open", async ({
    page,
  }) => {
    // Loaded alone: a page load to the home page, the word gone from the
    // address.
    await page.goto("/spot/brandon");
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Settings").click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/$/);
    await expect(finder(page)).toBeVisible();
  });

  test("an old link to Customise opens Settings on the home page", async ({
    page,
  }) => {
    await page.goto("/?customise");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible({
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/$/);
  });

  test("Settings from a spot's page over the finder is the finder with Settings open", async ({
    page,
  }) => {
    await star(page, ["brandon"]);
    await openFinder(page);
    await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
    // The spot's page, over the finder (src/PagesOverMap.tsx).
    await cards(page).getByRole("link", { name: "Brandon Bay" }).click();
    await expect(page).toHaveURL(/\/spot\/brandon$/);
    await expect(page.locator(".map-under-page")).toHaveCount(1);
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Settings").click();
    await expect(page.locator(".map-under-page")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
  });

  test("the menu's Chart is always the full chart, and its Spot finder the home page, from a page loaded alone", async ({
    page,
  }) => {
    await page.goto("/spot/brandon");
    await page.getByRole("button", { name: "Site menu" }).click();
    await expect(siteRow(page, "Chart")).toHaveAttribute("href", "/?map");
    await siteRow(page, "Chart").click();
    await expect(page.locator(".map-head")).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/\?map$/);

    await page.goto("/spot/brandon");
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Spot finder").click();
    await expect(finder(page)).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".map-head")).toHaveCount(0);

    // The AI page's menu's Chart is the chart too.
    await page.goto("/ai");
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Chart").click();
    await expect(page.locator(".map-head")).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(/\/\?map$/);
  });

  test("the menu's Chart from a spot's page over the finder is the chart", async ({
    page,
  }) => {
    await star(page, ["brandon"]);
    await openFinder(page);
    await page.evaluate(() => ((window as { stayed?: boolean }).stayed = true));
    await cards(page).getByRole("link", { name: "Brandon Bay" }).click();
    await expect(page.locator(".map-under-page")).toHaveCount(1);
    await page.getByRole("button", { name: "Site menu" }).click();
    await siteRow(page, "Chart").click();
    await expect(page.locator(".map-under-page")).toHaveCount(0);
    await expect(page.locator(".map-head")).toBeVisible();
    await expect(page).toHaveURL(/\/\?map$/);
    // No page load: the map was kept under the page.
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
  });

  test("the root is always the home page; the old addresses are put right", async ({
    page,
  }) => {
    // The full chart last open makes no difference to the root.
    await page.goto("/?map");
    await expect(page.locator(".map-head")).toBeVisible({ timeout: 30000 });
    await page.goto("/");
    await expect(finder(page)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".map-head")).toHaveCount(0);
    // The spot finder's old address is the home page.
    await page.goto("/spots");
    await expect(page).toHaveURL(/\/$/);
    await expect(finder(page)).toBeVisible({ timeout: 30000 });
    // The chart's old word is the full chart's new one.
    await page.goto("/?chart");
    await expect(page).toHaveURL(/\/\?map$/);
    await expect(page.locator(".map-head")).toBeVisible({ timeout: 30000 });
    // A link to a spot on the chart is the full chart on it, with its dock.
    await page.goto("/?spot=brandon");
    await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay", {
      timeout: 30000,
    });
    await expect(page.locator(".map-head")).toBeVisible();
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
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the head keeps the wordmark beside the menu and the switch", async ({
    page,
  }) => {
    await star(page, ["brandon"]);
    await openFinder(page);
    const head = finder(page).locator("header");
    const mark = head.getByText("wingfoil.ie");
    await expect(mark).toBeVisible();
    const [menu, name, tabs] = [
      (await head.getByRole("button").first().boundingBox())!,
      (await mark.boundingBox())!,
      (await scope(page).boundingBox())!,
    ];
    // In one row, side by side, and all on the screen.
    expect(name.x).toBeGreaterThanOrEqual(menu.x + menu.width);
    expect(tabs.x).toBeGreaterThanOrEqual(name.x + name.width);
    expect(tabs.x + tabs.width).toBeLessThanOrEqual(390);
    expect(
      Math.abs(name.y + name.height / 2 - (tabs.y + tabs.height / 2)),
    ).toBeLessThan(4);
  });

  test("one column, no wider than the screen, an hour tapped on the bars", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const a = (await cards(page).first().boundingBox())!;
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(390);
    const bar = cards(page).first().locator('[data-bar="stars"]');
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect(page.locator("[data-picked-hour]")).toHaveCount(2);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("a first visit on a phone opens on Nearby; Favourites is empty", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openFinder(page);
    await page.getByRole("button", { name: "Use my location" }).tap();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await scope(page).getByRole("button", { name: "Favourites" }).tap();
    await expect(page.locator("[data-finder-empty]")).toContainText(
      "Star a spot and it shows here.",
    );
    await scope(page).getByRole("button", { name: "Nearby" }).tap();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1);
  });

  test("a first visit on a phone with the location refused still lists spots", async ({
    page,
  }) => {
    await openFinder(page);
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await expect(page.locator("[data-finder-note]")).toBeVisible();
  });
});
