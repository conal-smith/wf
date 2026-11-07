import {
  barName,
  expect,
  scrubBar,
  SPOTS_KEY,
  test,
  type Page,
} from "./fixtures";

/**
 * The home page: the spot finder's list, with the chart beside it on a wide
 * screen, and the full chart opened out of it (src/App.tsx, the approved
 * mock-up, #238). One map, never
 * taken down: the panel beside the list and the full chart are the same map
 * in a bigger box.
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
const panel = (page: Page) =>
  page.getByRole("region", { name: "The chart, at the spots on the list" });
const lights = (page: Page) => page.locator(".spot-marker");
/** The spots on the list, as pills; every other spot is a muted dot. */
const pills = (page: Page) => page.locator(".spot-marker:not(.lt-dot)");
const dots = (page: Page) => page.locator(".spot-marker.lt-dot");
/** The top bar over the list and the chart alike (ui/TopBar.tsx). */
const bar = (page: Page) => page.locator("[data-top-bar]");
/** The bar's button to the list, on the full chart. */
const listButton = (page: Page) =>
  bar(page).getByRole("link", { name: "Spots", exact: true });
/** The bar's button to the full chart, on the list. */
const mapButton = (page: Page) =>
  bar(page).getByRole("link", { name: "Chart", exact: true });
/** On the full chart: the bar's button is the way back to the list. */
const onChart = (page: Page) => page.locator('[data-view-switch="spots"]');

/** Marks the map's canvas, so a map drawn afresh is told from the one kept. */
const mark = (page: Page) =>
  page.evaluate(() => {
    document.querySelector<HTMLElement>(".maplibregl-canvas")!.dataset.kept =
      "1";
  });
const kept = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelectorAll(".maplibregl-canvas").length === 1 &&
      document.querySelector<HTMLElement>(".maplibregl-canvas")?.dataset
        .kept === "1",
  );

/** How many of the list's pills stand inside the box beside the list. */
const pillsInside = async (page: Page) => {
  const box = (await panel(page).boundingBox())!;
  const at = await pills(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  return at.filter(
    (p) =>
      p.x >= box.x &&
      p.x <= box.x + box.width &&
      p.y >= box.y &&
      p.y <= box.y + box.height,
  ).length;
};

/** The home page at 1440, its favourites listed and the chart beside them. */
async function openHome(page: Page, ids = ["brandon", "dollymount", "keel"]) {
  await star(page, ids);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(ids.length, { timeout: 30000 });
  await expect(pills(page)).toHaveCount(ids.length, { timeout: 30000 });
}

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the list is the home page, and the chart beside it shows every spot, the listed ones as pills, fitted to them, with no scrub bar", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openHome(page);
    await expect(page).toHaveURL(/\/$/);
    // Beside the list, under the top bar, the full height of the page.
    const box = (await panel(page).boundingBox())!;
    const card = (await cards(page).first().boundingBox())!;
    const head = (await bar(page).boundingBox())!;
    expect(box.x).toBeGreaterThan(card.x + card.width);
    expect(box.y).toBeGreaterThan(head.y + head.height);
    expect(box.y + box.height).toBeGreaterThan(880);
    // Its own few controls, and none of the full chart's.
    await expect(
      panel(page).getByRole("button", { name: "Full chart" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Zoom in" }),
    ).toBeVisible();
    await expect(onChart(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Layers" })).toHaveCount(0);
    await expect(page.locator("[data-panel-when]")).toHaveText(
      /^Stars at \d\d:\d\d (today|tomorrow|on \w+)$/,
    );
    // And every other spot, a muted dot.
    await expect(lights(page)).toHaveCount(149);
    await expect(dots(page)).toHaveCount(146);
    // Every listed spot's light is inside the panel.
    for (const light of await pills(page).all()) {
      const l = (await light.boundingBox())!;
      expect(l.x).toBeGreaterThan(box.x);
      expect(l.x + l.width).toBeLessThan(box.x + box.width);
      expect(l.y).toBeGreaterThan(box.y);
      expect(l.y + l.height).toBeLessThan(box.y + box.height);
    }
    // A light pressed scrolls the list to its card, and opens no forecast:
    // beside the list the time is the cards', and the chart has no scrub bar.
    await page.locator('.spot-marker[data-spot-id="keel"]').click();
    await expect(
      cards(page).filter({ hasText: "Keel Beach" }),
    ).toBeInViewport();
    await page.waitForTimeout(500);
    await expect(scrubBar(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    // No loupe and no range ring beside the list.
    await expect(page.locator(".map-focus > *")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a card under the pointer lights its spot; a light under the pointer outlines its card", async ({
    page,
  }) => {
    await openHome(page);
    const keel = cards(page).filter({ hasText: "Keel Beach" });
    await keel.hover();
    await expect(page.locator('.spot-marker[data-spot-id="keel"]')).toHaveClass(
      /\blit\b/,
    );
    await expect(page.locator(".spot-marker.lit")).toHaveCount(1);
    // Another card, another light.
    await cards(page).filter({ hasText: "Brandon Bay" }).hover();
    await expect(
      page.locator('.spot-marker[data-spot-id="brandon"]'),
    ).toHaveClass(/\blit\b/);
    await expect(page.locator(".spot-marker.lit")).toHaveCount(1);
    // A hover never zooms the chart.
    const zoom = await page.evaluate(
      () => document.querySelector(".map-canvas")?.className ?? "",
    );
    // The card brings its light into view a moment after the pointer comes
    // to rest on it (src/App.tsx hoverCard): left at once, it never does.
    const inside = async (id: string) => {
      const box = (await panel(page).boundingBox())!;
      const at = await page
        .locator(`.spot-marker[data-spot-id="${id}"]`)
        .boundingBox();
      return (
        !!at &&
        at.x > box.x &&
        at.x + at.width < box.x + box.width &&
        at.y > box.y &&
        at.y + at.height < box.y + box.height
      );
    };
    await expect.poll(() => inside("brandon")).toBe(true);
    await page.mouse.move(5, 5);
    // And a light under the pointer outlines its card, once the chart is at
    // rest (through a move its lights are drawn, not buttons).
    await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
    // Brandon's light, which its card has just brought to the chart's middle.
    // Not Dollymount's: the hovers have panned the chart west (a card whose
    // light sits near the edge pans it to the middle, src/chartPanel.ts
    // inView), and Dublin is off the chart, a light nobody can point at. The
    // test's hover scrolled the clipped chart to reach it, and the light then
    // slid from under the pointer.
    const brandon = page.locator('.spot-marker[data-spot-id="brandon"]');
    const box = (await panel(page).boundingBox())!;
    const at = (await brandon.boundingBox())!;
    expect(at.x).toBeGreaterThan(box.x);
    expect(at.x + at.width).toBeLessThan(box.x + box.width);
    expect(at.y).toBeGreaterThan(box.y);
    expect(at.y + at.height).toBeLessThan(box.y + box.height);
    await brandon.hover();
    await expect(
      cards(page).filter({ hasText: "Brandon Bay" }),
    ).toHaveAttribute("data-lit", "");
    await expect(page.locator("[data-spot-card][data-lit]")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.querySelector(".map-canvas")?.className ?? "",
      ),
    ).toBe(zoom);
  });

  test("Full chart opens the same map full screen, every spot and the chart's tools; Back, List, the collapse and Escape return to the list", async ({
    page,
  }) => {
    await openHome(page);
    await mark(page);
    const open = async () => {
      await panel(page).getByRole("button", { name: "Full chart" }).click();
      await expect(page).toHaveURL(/\/\?map$/);
      await expect(onChart(page)).toBeVisible();
      await expect(lights(page)).toHaveCount(149);
      await expect(
        page
          .getByRole("group", { name: "Map controls" })
          .getByRole("button", { name: "Layers" }),
      ).toBeVisible();
      await expect(listButton(page)).toBeVisible();
      // The whole screen under the top bar, the list under it and out of reach.
      const box = (await page.locator(".workspace").boundingBox())!;
      expect(box).toEqual({ x: 0, y: 64, width: 1440, height: 836 });
      await expect(page.locator(".finder-under")).toHaveAttribute("inert", "");
      expect(await kept(page)).toBe(true);
    };
    const back = async () => {
      await expect(page).toHaveURL(/\/$/);
      await expect(panel(page)).toBeVisible();
      await expect(pills(page)).toHaveCount(3);
      await expect(onChart(page)).toHaveCount(0);
      expect(await kept(page)).toBe(true);
    };
    await open();
    await page.goBack();
    await back();
    await open();
    await listButton(page).click();
    await back();
    await open();
    await page.getByRole("button", { name: "Back to the list" }).click();
    await back();
    await open();
    await page.keyboard.press("Escape");
    await back();
    // Forward is the full chart again.
    await page.goForward();
    await expect(onChart(page)).toBeVisible();
  });

  test("on the full chart a spot opens its week in the scrub bar; the top bar's Spots takes the reader to the list, the scrub bar gone", async ({
    page,
  }) => {
    await openHome(page);
    await mapButton(page).click();
    await expect(lights(page)).toHaveCount(149);
    await page.locator('.spot-marker[data-spot-id="brandon"]').click();
    await expect(barName(page)).toHaveText("Brandon Bay", {
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/\?spot=brandon$/);
    // The scrub bar stands under the top bar, never over it.
    const top = (await bar(page).boundingBox())!;
    expect((await scrubBar(page).boundingBox())!.y).toBeGreaterThanOrEqual(
      top.y + top.height,
    );
    // With a spot open, Spots is the list, and the scrub bar is gone with it.
    await listButton(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toBeVisible();
    await expect(scrubBar(page)).toHaveCount(0);
  });

  test("the bar's search on the full chart flies to the spot picked and opens it", async ({
    page,
  }) => {
    await openHome(page);
    await mapButton(page).click();
    await expect(lights(page)).toHaveCount(149);
    const find = page.getByRole("combobox", { name: "Search spots" });
    await find.fill("keel");
    await expect(
      page.getByRole("listbox", { name: "Spots" }).getByRole("option").first(),
    ).toContainText("Keel Beach");
    await find.press("Enter");
    await expect(barName(page)).toHaveText("Keel Beach", {
      timeout: 30000,
    });
    await expect(page).toHaveURL(/\/\?spot=keel$/);
    await expect(find).toHaveValue("");
  });

  test("a card's picture opens its spot's page, not the chart; Back is the list", async ({
    page,
  }) => {
    await openHome(page);
    await cards(page)
      .filter({ hasText: "Keel Beach" })
      .locator("[data-card-picture]")
      .click();
    await expect(page).toHaveURL(/\/spot\/keel$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel(page)).toBeVisible();
    await expect(scrubBar(page)).toHaveCount(0);
  });

  test("a link to a spot opens the full chart on it with its week, and List goes on to the list", async ({
    page,
  }) => {
    await star(page, ["brandon"]);
    await page.goto("/?spot=brandon");
    await expect(barName(page)).toHaveText("Brandon Bay", {
      timeout: 30000,
    });
    await expect(onChart(page)).toBeVisible();
    await listButton(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(cards(page)).toHaveCount(1);
    await expect(scrubBar(page)).toHaveCount(0);
    // A step on, not back: Back is the chart on the spot again.
    await page.goBack();
    await expect(page).toHaveURL(/\/\?spot=brandon$/);
    await expect(barName(page)).toHaveText("Brandon Bay");
  });

  test("Nearby lists the spots round the rider; the chart beside it shows the rider as a blue dot", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await openHome(page, ["brandon"]);
    await page
      .getByRole("group", { name: "Which spots" })
      .getByRole("button", { name: "Nearby" })
      .click();
    await page.locator("[data-finder-filter]").click();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    const listed = await cards(page).count();
    await expect(pills(page)).toHaveCount(listed);
    await expect(
      page.locator('.spot-marker[data-spot-id="brandon"]'),
    ).toHaveClass(/\blt-dot\b/);
    await expect(page.getByRole("img", { name: "You are here" })).toBeVisible();
  });
});

test.describe("a first visit, with no favourites", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("location allowed: Nearby lists the spots round the rider, and the chart beside it is fitted to them, with the blue dot", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(DUBLIN);
    await page.goto("/");
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await page.locator("[data-finder-filter]").click();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(cards(page).filter({ hasText: "Dollymount" })).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(page.getByRole("img", { name: "You are here" })).toBeVisible();
    // Opened round the rider: their mark in the middle of the box beside it,
    // the list what is in view, and the spots further out a pan away.
    const box = (await panel(page).boundingBox())!;
    await expect
      .poll(async () => {
        const you = await page
          .getByRole("img", { name: "You are here" })
          .boundingBox();
        return you
          ? Math.abs(you.x + you.width / 2 - (box.x + box.width / 2))
          : Infinity;
      })
      .toBeLessThan(box.width / 3);
    await expect.poll(() => cards(page).count()).toBeLessThan(30);
    const listed = await cards(page).count();
    await expect(pills(page)).toHaveCount(listed, { timeout: 30000 });
    await expect.poll(() => pillsInside(page)).toBe(listed);
  });

  test("location not known: the chart opens fitted to the spots nearest the middle of Ireland, once, and Nearby then lists what it shows", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(pills(page).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("img", { name: "You are here" })).toHaveCount(
      0,
    );
    // The list comes to what the fit shows, and it holds: no second fit.
    await expect
      .poll(
        async () => (await cards(page).count()) === (await pillsInside(page)),
      )
      .toBe(true);
    const settled = await headIds(page);
    const camera = await page.evaluate(
      () => document.querySelector(".map-canvas")?.className,
    );
    await page.waitForTimeout(1500);
    expect(await headIds(page)).toEqual(settled);
    expect(
      await page.evaluate(
        () => document.querySelector(".map-canvas")?.className,
      ),
    ).toBe(camera);
  });
});

/** The count at the head of the list. */
const head = async (page: Page) =>
  Number(
    /(\d+) spots?/.exec(
      (await page.locator("[data-finder-heading]").textContent()) ?? "",
    )?.[1] ?? NaN,
  );
const headIds = (page: Page) =>
  cards(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.spotCard),
  );
const button = (page: Page, name: string) =>
  panel(page).getByRole("button", { name });

/** The chart at rest: no move on, and its list drawn from where it stopped. */
const rest = async (page: Page) => {
  await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
};

/**
 * A place on the chart with no light on it, to take hold of the map: from its
 * right side for a drag to the left, so the pointer stays in the window.
 */
const openWater = (page: Page, fromRight = false) =>
  page.evaluate((fromRight) => {
    const box = document.querySelector(".map-panel")!.getBoundingClientRect();
    for (let y = box.top + 150; y < box.bottom - 80; y += 40)
      for (let k = 80; k < box.width - 80; k += 40) {
        const x = fromRight ? box.right - k : box.left + k;
        if (document.elementFromPoint(x, y)?.closest(".maplibregl-canvas"))
          return { x, y };
      }
    throw new Error("no room on the chart");
  }, fromRight);

/** The chart dragged by this much, the button held until `held` has looked. */
async function drag(
  page: Page,
  dx: number,
  dy: number,
  held?: () => Promise<void>,
) {
  const at = await openWater(page, dx < 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx / 2, at.y + dy / 2, { steps: 5 });
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 5 });
  await held?.();
  await page.mouse.up();
  await rest(page);
}

/** A muted dot clear of every other mark, inside the chart: its id and place. */
const freeDot = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector(".map-panel")!.getBoundingClientRect();
    for (const el of document.querySelectorAll<HTMLElement>(
      ".spot-marker.lt-dot",
    )) {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (
        x > box.left + 130 &&
        x < box.right - 130 &&
        y > box.top + 150 &&
        y < box.bottom - 80 &&
        document.elementFromPoint(x, y)?.closest(".spot-marker") === el
      )
        return { id: el.dataset.spotId!, x, y };
    }
    throw new Error("no muted dot to reach");
  });

/** Nearby on the whole of the chart, every spot in view, the first visit's. */
async function wholeChart(page: Page) {
  await page.goto("/");
  await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
  await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
  for (let i = 0; i < 4; i++) {
    await button(page, "Zoom out").click();
    await rest(page);
  }
  await expect.poll(() => head(page), { timeout: 30000 }).toBe(149);
}

test.describe("Nearby follows the map beside the list", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a pan to another part of the country lists the spots there, once the camera settles, with no location set", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await rest(page);
    await expect
      .poll(
        async () => (await cards(page).count()) === (await pillsInside(page)),
      )
      .toBe(true);
    const before = await headIds(page);
    expect(before.length).toBeGreaterThan(0);
    const box = (await panel(page).boundingBox())!;
    // Held mid-pan, the list has not moved; let go, it has.
    await drag(page, -box.width * 0.8, 0, async () => {
      await page.waitForTimeout(300);
      expect(await headIds(page)).toEqual(before);
    });
    await expect.poll(() => headIds(page)).not.toEqual(before);
    // Each card a pill in view, the head saying how many.
    await expect
      .poll(
        async () => (await cards(page).count()) === (await pillsInside(page)),
      )
      .toBe(true);
    expect(await pills(page).count()).toBe(await cards(page).count());
    // No distances, and nothing asked of the browser.
    await expect(cards(page).filter({ hasText: / km · / })).toHaveCount(0);
  });

  test("the full chart and back leaves the map where it was, and no list is drawn for the chart's moves", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await rest(page);
    const box = (await panel(page).boundingBox())!;
    await drag(page, -box.width / 2, 0);
    await expect
      .poll(
        async () => (await cards(page).count()) === (await pillsInside(page)),
      )
      .toBe(true);
    const before = await headIds(page);
    await button(page, "Full chart").click();
    await expect(onChart(page)).toBeVisible();
    await rest(page);
    expect(await headIds(page)).toEqual(before);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeVisible();
    await rest(page);
    await expect.poll(() => headIds(page)).toEqual(before);
  });

  test("Favourites keeps the rider's own list on a pan", async ({ page }) => {
    await openHome(page);
    const before = await headIds(page);
    await drag(page, -300, 0);
    expect(await headIds(page)).toEqual(before);
    await expect(pills(page)).toHaveCount(3);
    // And Nearby then lists what the map shows; back, the same favourites.
    await page
      .getByRole("group", { name: "Which spots" })
      .getByRole("button", { name: "Nearby" })
      .click();
    await expect.poll(() => headIds(page)).not.toEqual(before);
    await page
      .getByRole("group", { name: "Which spots" })
      .getByRole("button", { name: "Favourites" })
      .click();
    await expect(cards(page)).toHaveCount(3);
  });

  test("over the cap: the best 30 cards, the true count, a quiet line, and the rest as dots", async ({
    page,
  }) => {
    await wholeChart(page);
    await expect(cards(page)).toHaveCount(30);
    await expect(page.locator("[data-finder-more]")).toHaveText(
      "149 spots in view, the best 30 here. Zoom in for the rest.",
    );
    await expect(pills(page)).toHaveCount(30);
    await expect(dots(page)).toHaveCount(119);
  });

  test("open sea: says so, and zooming back out lists spots again", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await button(page, "Zoom in").click();
    await button(page, "Zoom in").click();
    await rest(page);
    const empty = page.locator("[data-finder-empty]");
    for (let i = 0; i < 12 && !(await empty.count()); i++)
      await drag(page, 500, 0);
    await expect(empty).toHaveText(
      "No spots in this part of the map. Zoom out or move the map.",
    );
    await expect(cards(page)).toHaveCount(0);
    await expect(pills(page)).toHaveCount(0);
    expect(await head(page)).toBe(0);
    for (let i = 0; i < 4; i++) {
      await button(page, "Zoom out").click();
      await rest(page);
    }
    await expect(empty).toHaveCount(0);
    await expect.poll(() => head(page)).toBeGreaterThan(0);
  });

  test("a card under the pointer changes neither the list nor the map", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await rest(page);
    await expect
      .poll(
        async () => (await cards(page).count()) === (await pillsInside(page)),
      )
      .toBe(true);
    const before = await headIds(page);
    expect(before.length).toBeGreaterThan(3);
    for (const id of before.slice(0, 4)) {
      await page.locator(`[data-spot-card="${id}"]`).hover();
      await expect(
        page.locator(`.spot-marker[data-spot-id="${id}"]`),
      ).toHaveClass(/\blit\b/);
      // Longer than the wait before a Favourites card's pan.
      await page.waitForTimeout(300);
      await expect(page.locator(".map-lights.is-moving")).toHaveCount(0);
    }
    await rest(page);
    expect(await headIds(page)).toEqual(before);
  });

  test("a dot under the pointer opens a card with the wind, and lights nothing; the keys open it too", async ({
    page,
  }) => {
    await wholeChart(page);
    await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
      timeout: 30000,
    });
    const card = page.locator(".lt-card");
    await expect(card).toBeHidden();
    const dot = await freeDot(page);
    await page.mouse.move(dot.x, dot.y);
    await expect(card).toBeVisible();
    await expect(card.locator(".map-card-name")).not.toBeEmpty();
    await expect(card.locator(".map-card-net")).toHaveText(/^Co\. /);
    await expect(card.locator(".map-card-speed")).toHaveText(/^(\d+|Calm)$/);
    await expect(card.locator(".map-card-when")).toHaveText(
      /^(\d stars?|Dark|Offshore).* at \d\d:\d\d (today|tomorrow|on \w+)$/,
    );
    // No pill popped, nothing faded, no card outlined.
    await expect(page.locator(".spot-marker.lit")).toHaveCount(0);
    await expect(page.locator(".map-lights.has-lit")).toHaveCount(0);
    await expect(page.locator("[data-spot-card][data-lit]")).toHaveCount(0);
    // No link under a mouse: the dot is pressed.
    await expect(card.locator("a")).toHaveCount(0);
    await page.mouse.move(5, 5);
    await expect(card).toBeHidden();
    // The keys: the card, and Escape shuts it.
    const light = page.locator(`.spot-marker[data-spot-id="${dot.id}"]`);
    await light.focus();
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
  });

  test("a dot pressed opens its spot's page, and so does Enter", async ({
    page,
  }) => {
    await wholeChart(page);
    const dot = await freeDot(page);
    await page.mouse.click(dot.x, dot.y);
    await expect(page).toHaveURL(new RegExp(`/spot/${dot.id}`));
    await page.goBack();
    await expect(cards(page).first()).toBeVisible({ timeout: 30000 });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    const again = page.locator(".spot-marker.lt-dot").first();
    const id = await again.getAttribute("data-spot-id");
    await again.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/spot/${id}`));
  });

  test("a pill pressed on Nearby brings its card into view", async ({
    page,
  }) => {
    await wholeChart(page);
    const last = await page
      .locator("[data-spot-card]")
      .last()
      .getAttribute("data-spot-card");
    await expect(page).toHaveURL(/\/$/);
    await page
      .locator(`.spot-marker[data-spot-id="${last}"]`)
      .dispatchEvent("click", { detail: 1 });
    await expect(page.locator(`[data-spot-card="${last}"]`)).toBeInViewport();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("a dot under a finger, beside the list", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test("a tap pins its card, which holds the link; a tap elsewhere lets it go", async ({
    page,
  }) => {
    await wholeChart(page);
    const card = page.locator(".lt-card");
    const dot = await freeDot(page);
    await page.touchscreen.tap(dot.x, dot.y);
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    const link = card.getByRole("link", { name: "Open spot" });
    await expect(link).toHaveAttribute("href", new RegExp(`/spot/${dot.id}`));
    // Over the land's open water, away from the dot: the card goes.
    const away = await openWater(page);
    await page.touchscreen.tap(away.x, away.y);
    await expect(card).toBeHidden();
    await page.touchscreen.tap(dot.x, dot.y);
    await expect(card).toBeVisible();
    const at = (await link.boundingBox())!;
    await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    await expect(page).toHaveURL(new RegExp(`/spot/${dot.id}`));
  });
});

test.describe("under the width for the chart beside the list", () => {
  test.use({ viewport: { width: 900, height: 860 } });

  test("Nearby is the spots nearest the middle of Ireland, with no map to follow", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await expect(cards(page)).toHaveCount(12);
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
    await expect(page.locator("[data-finder-more]")).toHaveCount(0);
  });

  test("the list alone, and the bar's Chart to the full chart, which is Spots there", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await page.goto("/");
    await expect(cards(page)).toHaveCount(2, { timeout: 30000 });
    await expect(panel(page)).toHaveCount(0);
    await mapButton(page).click();
    await expect(page).toHaveURL(/\/\?map$/);
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await expect(onChart(page)).toBeVisible();
    // No collapse here: there is no panel to collapse to.
    await expect(
      page.getByRole("button", { name: "Back to the list" }),
    ).toHaveCount(0);
    await listButton(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(mapButton(page)).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the map is made the first time Chart is pressed, and kept; the chart keeps its zoom and Layers", async ({
    page,
  }) => {
    await star(page, ["brandon", "keel"]);
    await page.goto("/");
    await expect(cards(page)).toHaveCount(2, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
    await mapButton(page).tap();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(1, {
      timeout: 30000,
    });
    await expect(lights(page)).toHaveCount(149, { timeout: 30000 });
    await mark(page);
    const controls = page.getByRole("group", { name: "Map controls" });
    for (const name of ["Zoom in", "Zoom out", "Layers"])
      await expect(controls.getByRole("button", { name })).toBeVisible();
    // The controls start under the bar, not under its 56px.
    const top = (await bar(page).boundingBox())!;
    const zoom = (await controls.boundingBox())!;
    expect(zoom.y).toBeGreaterThanOrEqual(top.y + top.height);
    // A spot: its week in the scrub bar; the top bar's Spots back to the list.
    await page
      .locator('.spot-marker[data-spot-id="brandon"]')
      .dispatchEvent("click");
    await expect(barName(page)).toHaveText("Brandon Bay", {
      timeout: 30000,
    });
    await listButton(page).tap();
    await expect(page).toHaveURL(/\/$/);
    await expect(cards(page)).toHaveCount(2);
    await expect(scrubBar(page)).toHaveCount(0);
    // Kept, out of sight, for the next time.
    expect(await kept(page)).toBe(true);
    await mapButton(page).tap();
    await expect(onChart(page)).toBeVisible();
    expect(await kept(page)).toBe(true);
  });
});
