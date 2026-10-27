import {
  chartTools,
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
const cards = (page: Page) => page.locator("[data-spot-card]");
const scope = (page: Page) => page.getByRole("group", { name: "Which spots" });

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

/** Today's hour columns on a card. */
const hours = (page: Page, card = 0) =>
  cards(page).nth(card).locator("[data-day-hours] [data-hour]");

/** Each card's rose: the bearing its wind comes from, or "" with none. */
const roses = (page: Page) =>
  page
    .locator("[data-spot-card] [data-spot-picture]")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-rose-from") ?? ""),
    );

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens on Favourites, the best of the week first, one card a row beside the chart", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await star(page, ["brandon", "dollymount", "keel", "tramore"]);
    await openFinder(page);
    await expect(page).toHaveURL(/\/$/);
    // The head: the menu, the wordmark and the switch, and nothing else.
    await expect(
      scope(page).getByRole("button", { name: "Favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Spots" })).toHaveCount(0);
    await expect(page.getByRole("slider")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(4);
    expect(inOrder(await rated(page))).toBe(true);
    // One column beside the chart, each card wide enough for its hours.
    const [a, b] = [
      (await cards(page).nth(0).boundingBox())!,
      (await cards(page).nth(1).boundingBox())!,
    ];
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(a.width).toBeGreaterThan(560);
    const chart = (await page
      .getByRole("region", { name: "The chart, at the spots on the list" })
      .boundingBox())!;
    expect(chart.x).toBeGreaterThan(a.x + a.width);
    // Each card: its name and county, today and the next five days.
    const brandon = cards(page).filter({ hasText: "Brandon Bay" });
    await expect(brandon).toContainText("Co. Kerry");
    await expect(brandon.getByText("Today", { exact: true })).toBeVisible();
    // The five under it are "Other days", as they are with a day chosen.
    await expect(brandon.locator("[data-other-days]")).toHaveText("Other days");
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
    // Mid-September in Dublin: about 06:20 to 20:20, so 06:00 to 21:00, and
    // now at 22:00. HARMONIE's sample run begins at 14:00: the morning before
    // it is ECMWF's three-hourly steps (the ruling of 25 October 2026, today
    // kept whole), a column each, with their wind.
    expect(count).toBeGreaterThanOrEqual(12);
    const winds = await row.evaluateAll((els) =>
      els.map((el) => /\d/.test(el.textContent ?? "")),
    );
    expect(winds.every(Boolean)).toBe(true);
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
    await expect(card.locator("[data-day-facts] [data-light]")).toContainText(
      /^light \d\d:\d\d–\d\d:\d\d$/,
    );
    await expect(card.locator("[data-day-hours] [data-wind-band]")).toHaveCount(
      1,
    );
  });

  test("the row scrolls with no bar, opening on now, and steps either way", async ({
    page,
  }) => {
    // A card too narrow for the whole day: the sample's morning, before its
    // HARMONIE run, is ECMWF's three-hourly steps, which leaves a row that
    // a card beside the chart now draws whole, a little tighter (a day that
    // nearly fits is not scrolled), so the list stands alone and narrow.
    await page.setViewportSize({ width: 480, height: 900 });
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const card = cards(page).first();
    const scroller = card.locator("[data-hours-scroll]");
    expect(
      await scroller.evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe("none");
    // Now stands in the middle of the view, or as near as the ends allow.
    const centred = await scroller.evaluate((el) => {
      const now = el
        .querySelector("[data-hour][data-now]")!
        .getBoundingClientRect();
      const view = el.getBoundingClientRect();
      const left = now.left - view.left + el.scrollLeft;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const want = Math.max(
        0,
        Math.min(max, left + now.width / 2 - el.clientWidth / 2),
      );
      return { at: el.scrollLeft, want, max };
    });
    expect(Math.abs(centred.at - centred.want)).toBeLessThan(2);
    expect(centred.max).toBeGreaterThan(0);
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
    await expect(page).toHaveURL(/\/$/);
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
    await expect(page).toHaveURL(/\/$/);
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

  test("a day pressed is drawn hour by hour on every card, today among the others to come back to", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await rated(page);
    const today = AFTERNOON.toISOString().slice(0, 10);
    const days = (card: number) =>
      cards(page).nth(card).locator("[data-next-days] [data-day]");
    // An hour picked today, to see it put down with the day.
    await hours(page)
      .and(page.locator(":not([data-dark]):not([data-gone])"))
      .nth(2)
      .click();
    await expect(page.locator("[data-picked-hour]")).toHaveCount(3);
    // The second of the next days, pressed on the second card.
    const date = (await days(1).nth(1).getAttribute("data-day"))!;
    await days(1).nth(1).click();
    await expect(page).toHaveURL(/\/$/);
    for (let i = 0; i < 3; i++) {
      const card = cards(page).nth(i);
      await expect(card.locator("[data-day-shown]")).toHaveAttribute(
        "data-day-shown",
        date,
      );
      await expect(card.locator("[data-day-name]")).toHaveText(
        /^[A-Z][a-z]{2} \d{1,2}$/,
      );
      // Today is among the five now, first, and the day chosen is not.
      await expect(days(i)).toHaveCount(5);
      await expect(days(i).first()).toHaveAttribute("data-day", today);
      await expect(days(i).first()).toContainText("Today");
      await expect(
        card.locator(`[data-next-days] [data-day="${date}"]`),
      ).toHaveCount(0);
      await expect(card.getByText("Other days", { exact: true })).toBeVisible();
    }
    // The day's own hours: no now, none gone, light at either end; the
    // hour picked today is put down, and the roses stand at the day's
    // early afternoon, said on each picture.
    const row = hours(page);
    await expect(row.and(page.locator("[data-now]"))).toHaveCount(0);
    await expect(row.and(page.locator("[data-gone]"))).toHaveCount(0);
    await expect(row.first()).toHaveAttribute("data-dark", "true");
    await expect(row.last()).toHaveAttribute("data-dark", "true");
    await expect(page.locator("[data-picked-hour]")).toHaveCount(0);
    await expect(page.locator("[data-rose-hour]").first()).toHaveText(
      /^1[2-4]:00$/,
    );
    await expect(
      cards(page).first().locator("[data-first-light]"),
    ).toContainText(/^first light \d\d:\d\d$/);
    // An hour picked on it is picked on every card.
    const pick = row.and(page.locator(":not([data-dark])")).first();
    const time = (await pick.getAttribute("data-hour"))!;
    await pick.click();
    await expect(
      page.locator(`[data-hour="${time}"][aria-pressed="true"]`),
    ).toHaveCount(3);
    await expect(page.locator("[data-picked-hour]").first()).toHaveText(
      /^\d\d:00$/,
    );
    // Today again, from the keys: back to now, the hour put down.
    await days(2).first().focus();
    await page.keyboard.press("Enter");
    // The focus stays in the five, on the day that came back into them.
    await expect(
      cards(page).nth(2).locator(`[data-next-days] [data-day="${date}"]`),
    ).toBeFocused();
    for (let i = 0; i < 3; i++) {
      await expect(
        cards(page).nth(i).locator("[data-day-shown]"),
      ).toHaveAttribute("data-day-shown", today);
      await expect(cards(page).nth(i).locator("[data-day-name]")).toHaveText(
        "Today",
      );
      await expect(days(i).first()).not.toHaveAttribute("data-day", today);
    }
    await expect(
      page.locator("[data-picked-hour], [data-rose-hour]"),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-hour][data-now][aria-pressed="true"]'),
    ).toHaveCount(3);
  });

  test("a day that nearly fits is drawn whole, its first and last hours clear of the edges", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const card = cards(page).first();
    await card.locator("[data-next-days] [data-day]").nth(1).click();
    const scroller = card.locator("[data-hours-scroll]");
    const row = card.locator("[data-day-hours] [data-hour]");
    await expect(row.first()).toHaveAttribute("data-dark", "true");
    // No more to either side, so no fade and no step over the ends.
    const [scroll, view] = await scroller.evaluate((el) => [
      el.scrollWidth,
      el.clientWidth,
    ]);
    expect(scroll - view).toBeLessThanOrEqual(4);
    await expect(
      card.getByRole("button", { name: "Earlier hours" }),
    ).toBeHidden();
    await expect(
      card.getByRole("button", { name: "Later hours" }),
    ).toBeHidden();
    const box = (await scroller.boundingBox())!;
    for (const hour of [row.first(), row.last()]) {
      const at = (await hour.boundingBox())!;
      expect(at.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  });

  test("a gone or dark hour's figures are not faded with it", async ({
    page,
  }) => {
    await star(page, ["dollymount"]);
    await openFinder(page);
    await rated(page);
    // Every hour's words, and how faded each is, all the way up.
    const words = await hours(page).evaluateAll((els) =>
      els.flatMap((el) =>
        [...el.querySelectorAll("b, small")].map((word) => {
          let opacity = 1;
          for (let e: Element | null = word; e && e !== el.parentElement;)
            ((opacity *= Number(getComputedStyle(e).opacity)),
              (e = e.parentElement));
          return {
            dim: el.hasAttribute("data-gone") || el.hasAttribute("data-dark"),
            opacity,
            colour: getComputedStyle(word).color,
          };
        }),
      ),
    );
    expect(words.some((w) => w.dim)).toBe(true);
    for (const word of words) expect(word.opacity).toBe(1);
    // ink-2 on a gone or dark hour, ink on the others (ui/theme.css).
    const ink2 = "rgb(59, 60, 62)";
    const ink = "rgb(26, 29, 33)";
    for (const word of words) expect(word.colour).toBe(word.dim ? ink2 : ink);
  });

  test("while the places and their hours load, the cards hold their shape and say so", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount"]);
    // The places held back, then the forecast's squares, as on a slow line.
    let places!: () => void;
    const placesHeld = new Promise<void>((done) => (places = done));
    await page.route("**/spots.json", async (route) => {
      await placesHeld;
      await route.continue();
    });
    let squares!: () => void;
    const squaresHeld = new Promise<void>((done) => (squares = done));
    await page.route(/\/weather\/(blend|[^/]+\/spots\/)/, async (route) => {
      await squaresHeld;
      await route.continue();
    });
    await page.clock.setFixedTime(AFTERNOON);
    await page.goto("/");
    const list = page.locator("[data-finder-list]");
    const ghosts = page.locator("[data-card-skeleton]");
    await expect(ghosts).toHaveCount(2);
    await expect(ghosts.first()).toContainText("Loading the spots…");
    await expect(list).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("[data-finder-empty]")).toHaveCount(0);
    const ghost = (await ghosts.first().boundingBox())!;
    places();
    await expect(cards(page)).toHaveCount(2);
    await expect(ghosts).toHaveCount(0);
    // The card stands where its shape stood, as tall.
    const card = (await cards(page).first().boundingBox())!;
    expect(Math.abs(card.y - ghost.y)).toBeLessThan(2);
    expect(Math.abs(card.height - ghost.height)).toBeLessThan(2);
    // Its hours not worked out yet: the shapes of their figures, said.
    const hoursDue = cards(page).first().locator("[data-day-hours]");
    await expect(hoursDue).toHaveAttribute("data-pending", "true");
    await expect(hoursDue.locator("[data-pending-words]")).toHaveText(
      "Loading the forecast…",
    );
    await expect(
      cards(page).first().locator("[data-next-days] [data-stars]"),
    ).toHaveCount(0);
    squares();
    await rated(page);
    await expect(page.locator("[data-day-hours][data-pending]")).toHaveCount(0);
    const rated_ = (await cards(page).first().boundingBox())!;
    expect(Math.abs(rated_.height - card.height)).toBeLessThan(2);
  });

  test("a day's drawing pressed is that day too", async ({ page }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const band = cards(page).first().locator("[data-days-band]");
    const box = (await band.boundingBox())!;
    const date = await cards(page)
      .first()
      .locator("[data-next-days] [data-day]")
      .nth(4)
      .getAttribute("data-day");
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("[data-day-shown]")).toHaveCount(2);
    for (const shown of await page.locator("[data-day-shown]").all())
      await expect(shown).toHaveAttribute("data-day-shown", date!);
  });

  test("a mouse over a card's hours draws a dotted line at that time on every card", async ({
    page,
  }) => {
    await star(page, ["brandon", "dollymount", "keel"]);
    await openFinder(page);
    await rated(page);
    const lines = page.locator("[data-day-hours] [data-hover-line]");
    await expect(lines.first()).toBeHidden();
    // The middle of a lit hour on the first card: that hour, exactly.
    const column = hours(page)
      .and(page.locator(":not([data-dark]):not([data-gone])"))
      .nth(1);
    const time = (await column.getAttribute("data-hour"))!;
    const clock = (await column.getAttribute("title"))!;
    const box = (await column.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // A line on every card's row, at the middle of that hour's column.
    for (let i = 0; i < 3; i++) {
      const card = cards(page).nth(i);
      const line = card.locator("[data-day-hours] [data-hover-line]");
      await expect(line).toBeVisible();
      const at = (await card.locator(`[data-hour="${time}"]`).boundingBox())!;
      const l = (await line.boundingBox())!;
      expect(Math.abs(l.x - (at.x + at.width / 2))).toBeLessThan(2);
    }
    // The time, beside the pointer, on the card it is over and no other.
    const tags = page.locator("[data-day-hours] [data-hover-time]");
    await expect(tags.and(page.locator(":visible"))).toHaveCount(1);
    await expect(
      cards(page).first().locator("[data-day-hours] [data-hover-time]"),
    ).toHaveText(clock);
    // Off the row, the lines go.
    await page.mouse.move(box.x + box.width / 2, 2);
    await expect(lines.and(page.locator(":visible"))).toHaveCount(0);
    // A mouse over a day of the next ones: a line on that day on every card,
    // and on no card's row of hours.
    const band = cards(page).nth(1).locator("[data-days-band]");
    const b = (await band.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.3, b.y + 30);
    const dayLines = page.locator("[data-days-band] [data-hover-line]");
    for (let i = 0; i < 3; i++) await expect(dayLines.nth(i)).toBeVisible();
    await expect(lines.and(page.locator(":visible"))).toHaveCount(0);
    // The same time: as near the same place as each place's own light lets
    // it be (Kerry's day is a quarter of an hour behind Dublin's).
    const xs = await dayLines.evaluateAll((els) =>
      els.map(
        (el) =>
          el.querySelector("line")!.getBoundingClientRect().x -
          el.closest("svg")!.getBoundingClientRect().x,
      ),
    );
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(6);
    await expect(
      cards(page).nth(1).locator("[data-days-band] [data-hover-time]"),
    ).toBeVisible();
    await expect(
      cards(page).nth(0).locator("[data-days-band] [data-hover-time]"),
    ).toBeHidden();
    await page.mouse.move(b.x + b.width * 0.3, b.y - 200);
    await expect(dayLines.first()).toBeHidden();
  });

  test("first light stays in the row's view as it scrolls, not cut off by its edge", async ({
    page,
  }) => {
    // A card too narrow for the whole day: the sample's morning, before its
    // HARMONIE run, is ECMWF's three-hourly steps, which leaves a row that
    // a card beside the chart now draws whole, a little tighter (a day that
    // nearly fits is not scrolled), so the list stands alone and narrow.
    await page.setViewportSize({ width: 480, height: 900 });
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const card = cards(page).first();
    const scroller = card.locator("[data-hours-scroll]");
    for (const left of [0, 40, 90, 10000]) {
      await scroller.evaluate((el, left) => (el.scrollLeft = left), left);
      const view = (await scroller.boundingBox())!;
      const first = (await card.locator("[data-first-light]").boundingBox())!;
      const last = (await card.locator("[data-last-light]").boundingBox())!;
      expect(first.x).toBeGreaterThanOrEqual(view.x);
      expect(last.x + last.width).toBeLessThanOrEqual(view.x + view.width);
      expect(first.x + first.width).toBeLessThan(last.x);
    }
  });

  test("the picture opens the chart there, at the hour picked; the card opens the spot's page", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await openFinder(page);
    await rated(page);
    const keel = cards(page).filter({ hasText: "Keel Beach" });
    const pick = keel
      .locator("[data-day-hours] [data-hour]:not([data-dark]):not([data-gone])")
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
    await expect(page).toHaveURL(/\/$/);
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
    await expect(page).toHaveURL(/\/$/);
    const stored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      SPOTS_KEY,
    );
    expect(stored.starred).toEqual(["brandon", "dollymount"]);
  });

  test("a first visit, with no favourites, opens on Near you; Favourites says how to have some", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(
      scope(page).getByRole("button", { name: "Near you" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The browser was asked, and said where the rider is.
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(cards(page).first()).toContainText(/\d+ km · Co\. /);
    await expect(page.locator("[data-finder-note]")).toHaveCount(0);
    await scope(page).getByRole("button", { name: "Favourites" }).click();
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Star a spot and it shows here.",
    );
    await expect(cards(page)).toHaveCount(0);
  });

  test("a first visit with the location refused lists the spots nearest the middle of Ireland, and never asks again", async ({
    page,
  }) => {
    // No permission: the browser says no.
    await openFinder(page);
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
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
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Finding spots near you…",
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
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Finding spots near you…",
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
    await star(page, ["brandon"]);
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
    const facts = brandon.locator("[data-day-facts] [data-tide-time]");
    // The two in the row's hours; the low water at 22:40 is after it.
    await expect(facts).toHaveCount(2, { timeout: 30000 });
    await expect(facts.nth(0)).toHaveText(/^10:10 low water$/);
    await expect(facts.nth(1)).toHaveText(/^16:25 high water$/);
    // Under the hour each falls in.
    const high = brandon.locator('[data-day-hours] [data-tide="high"]');
    await expect(high).toContainText("16:25");
    const column = brandon.locator(
      `[data-hour="${Date.parse(`${day}T15:00:00Z`)}"]`,
    );
    const [h, c] = [(await high.boundingBox())!, (await column.boundingBox())!];
    expect(Math.abs(h.x + h.width / 2 - (c.x + c.width / 2))).toBeLessThan(2);
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
    // First in the navigation, over the chart and Settings, over the chart's
    // own tools.
    const chart = (await siteRow(page, "Chart").boundingBox())!;
    const settings = (await siteRow(page, "Settings").boundingBox())!;
    const layers = (await chartTools(page)
      .getByRole("button", { name: "Layers" })
      .boundingBox())!;
    const box = (await row.boundingBox())!;
    expect(box.y).toBeLessThan(chart.y);
    expect(chart.y).toBeLessThan(settings.y);
    expect(settings.y).toBeLessThan(layers.y);
    await row.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(finder(page)).toBeVisible();
    // No page load: the chart's own data, and its lights, wait behind it.
    expect(
      await page.evaluate(() => (window as { stayed?: boolean }).stayed),
    ).toBe(true);
    // The finder's menu: the same navigation, the finder marked as the page,
    // and nothing of the chart's own.
    await page.getByRole("button", { name: "Site menu" }).click();
    await expect(siteRow(page, "Spot finder")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(chartTools(page)).toHaveCount(0);
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
    // A finger has no hover: no line follows it.
    await expect(
      page.locator("[data-hover-line]").and(page.locator(":visible")),
    ).toHaveCount(0);
    // A day tapped is drawn hour by hour on every card.
    const day = cards(page)
      .first()
      .locator("[data-next-days] [data-day]")
      .nth(0);
    const date = await day.getAttribute("data-day");
    await day.tap();
    await expect(page.locator(`[data-day-shown="${date}"]`)).toHaveCount(3);
    await expect(page).toHaveURL(/\/$/);
    // The next five days fit the card.
    const days = cards(page).first().locator("[data-days-band]");
    const box = (await days.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(a.x + a.width);
  });

  test("a first visit on a phone opens on Near you; Favourites is empty", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openFinder(page);
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await scope(page).getByRole("button", { name: "Favourites" }).tap();
    await expect(page.locator("[data-finder-empty]")).toHaveText(
      "Star a spot and it shows here.",
    );
    await scope(page).getByRole("button", { name: "Near you" }).tap();
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
