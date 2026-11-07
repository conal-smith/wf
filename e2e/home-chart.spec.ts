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

/** How many of the chart's lights stand inside the box beside the list. */
const lightsInside = async (page: Page) => {
  const box = (await panel(page).boundingBox())!;
  const at = await lights(page).evaluateAll((els) =>
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
  await expect(lights(page)).toHaveCount(ids.length, { timeout: 30000 });
}

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the list is the home page, and the chart beside it shows only the listed spots, fitted to them, with no scrub bar", async ({
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
    // Every listed spot's light is inside the panel.
    for (const light of await lights(page).all()) {
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
      await expect(lights(page)).toHaveCount(3);
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
    await expect(lights(page)).toHaveCount(listed);
    await expect(
      page.locator('.spot-marker[data-spot-id="brandon"]'),
    ).toHaveCount(0);
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
    const listed = await cards(page).count();
    expect(listed).toBeGreaterThan(3);
    await expect(lights(page)).toHaveCount(listed, { timeout: 30000 });
    await expect(page.getByRole("img", { name: "You are here" })).toBeVisible();
    // Opened round the rider, closer in than the list: their mark in the
    // middle of the box beside it, and the spots further out a pan away.
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
    await expect.poll(() => lightsInside(page)).toBeLessThan(listed);
  });

  test("location refused: Nearby lists the spots nearest the middle of Ireland, and the chart beside it is fitted to them", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(finder(page)).toHaveAttribute("data-scope", "near");
    await expect(cards(page)).toHaveCount(12, { timeout: 30000 });
    await expect(lights(page)).toHaveCount(12, { timeout: 30000 });
    await expect(page.getByRole("img", { name: "You are here" })).toHaveCount(
      0,
    );
    await expect.poll(() => lightsInside(page)).toBe(12);
  });
});

test.describe("under the width for the chart beside the list", () => {
  test.use({ viewport: { width: 900, height: 860 } });

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
