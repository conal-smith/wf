import {
  barName,
  barPill,
  expect,
  rememberSpot,
  scrubBar,
  SPOTS_KEY,
  steadyFrames,
  test,
  timeSlider,
  type Page,
} from "./fixtures";
import { sampleStrip, stripAt } from "./columns";
import { readSample } from "./sample";
import {
  clock,
  dayShort,
  irishDate,
  openingColumn,
  timeSpoken,
} from "../src/strip";

/**
 * The map has no default place, and no spot's week in the scrub bar until a
 * spot is chosen: the bar is a plain timeline that moves the chart's time. Only a
 * link that names a spot opens on it; a remembered or starred spot waits for
 * a tap, and the page opens on the whole of Ireland and every light, the
 * chart alone, at the hour the page opened on (src/openingSpot.ts).
 */

const harmonie = readSample<{
  base: string;
  frames: { validTime: string; hour: number }[];
}>("harmonie");

/**
 * The chart up and every light placed. On all of Ireland every light is rated
 * too; a linked spot flies the chart in, and the lights read only the blend
 * squares in view (src/spotBlend.ts), so the far ones may stay pending there,
 * depending on whether the squares or the flight come first.
 */
async function openMap(page: Page, path = "/?map") {
  await page.goto(path);
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  if (!new URL(path, "http://x").searchParams.has("spot"))
    await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
      timeout: 30000,
    });
}

/** Find a spot by name and take the first result. */
async function findSpot(page: Page, words: string) {
  // On a phone the top bar's search is a round button that opens the field.
  const opener = page.locator("[data-spot-search-open]");
  if (await opener.isVisible()) await opener.click();
  await page.getByRole("combobox", { name: "Search spots" }).fill(words);
  await page.locator("[data-spot-option]").first().click();
}

const stored = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    SPOTS_KEY,
  );

/** The pill's words for a column's time: "Sun 13 22:00". */
const pillTime = (time: number) =>
  `${dayShort(time)} ${Number(irishDate(time).slice(8))} ${clock(time)}`;
const brandon = (page: Page) => page.locator('[data-spot-id="brandon"]');

/** A point on the open chart: water or land, clear of the lights and the boxes over it. */
async function openChart(page: Page) {
  const open = await page.evaluate(() => {
    for (let y = 200; y < innerHeight - 240; y += 20)
      for (let x = 30; x < innerWidth - 30; x += 20)
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains("maplibregl-canvas")
        )
          return { x, y };
    return null;
  });
  expect(open).not.toBeNull();
  return open!;
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`a first visit opens on the chart alone, and a spot brings its week at the chart's hour, at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await openMap(page);
    expect(await stored(page)).toBeNull();

    // No spot open: the scrub bar is a plain timeline at the foot of the
    // chart, over it, and the chart has the whole height under the top bar.
    // No light chosen, none focused.
    await expect(barName(page)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Forecast time, for the whole chart" }),
    ).toBeVisible();
    await expect(scrubBar(page)).toHaveClass(/\bis-bare\b/);
    await expect(scrubBar(page)).not.toHaveAttribute("data-spot");
    await expect(scrubBar(page).locator(".sb-stars")).toHaveCount(0);
    expect(
      await page.evaluate(() => [
        document.querySelector(".maplibregl-canvas")!.getBoundingClientRect()
          .height +
          document.querySelector("[data-top-bar]")!.getBoundingClientRect()
            .height,
        innerHeight,
      ]),
    ).toEqual([height, height]);
    await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
    await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
    // The lights are rated at the hour the page opened on.
    const opened = (await brandon(page).getAttribute("aria-label"))!;
    const at = sampleStrip.findIndex((c) =>
      opened.startsWith(`Brandon Bay, Kerry: ${clock(c.time)} `),
    );
    expect(at).toBeGreaterThanOrEqual(0);
    const slider = timeSlider(page);
    await expect(slider).toHaveValue(String(at));

    // A spot chosen: its week, on that same hour.
    await findSpot(page, "Keel");
    const week = page.getByRole("region", { name: "Forecast for Keel Beach" });
    await expect(week).toBeVisible();
    await expect(slider).toHaveValue(String(at));
    await expect(barPill(page)).toContainText(pillTime(sampleStrip[at].time));

    // The time: the playhead moves and the slider steps it, and the chart's
    // frame and every light follow. The last HARMONIE hour on the strip is
    // one nothing has asked for yet.
    const target = sampleStrip.findLastIndex((c) =>
      harmonie.frames.some((f) => Date.parse(f.validTime) === c.time),
    );
    const frame = harmonie.frames.find(
      (f) => Date.parse(f.validTime) === sampleStrip[target].time,
    )!;
    const tile = `/${String(frame.hour).padStart(3, "0")}.bin`;
    const asked: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(harmonie.base) && request.url().endsWith(tile))
        asked.push(request.url());
    });
    await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
    await slider.fill(String(target));
    await expect(slider).toHaveValue(String(target));
    await expect(barPill(page)).toContainText(
      pillTime(sampleStrip[target].time),
    );
    await expect
      .poll(() => asked.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    await expect(brandon(page)).toHaveAttribute(
      "aria-label",
      new RegExp(`^Brandon Bay, Kerry: ${clock(sampleStrip[target].time)} `),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("in the morning the hour opened on is the one the playhead stands on", async ({
    page,
  }) => {
    // 11:00 Irish time, between the morning's three-hourly steps. The strip
    // fills out as the models answer, and the opening hour is set again for
    // the longer strip: a strip read a frame late, against the strip as it
    // was, once picked an hour it was no longer showing.
    const now = Date.parse("2026-09-13T10:00:00Z");
    await page.clock.setFixedTime(new Date(now));
    await openMap(page, "/?spot=brandon");
    await expect(barName(page)).toHaveText("Brandon Bay");
    await expectHourUnderPlayhead(page, now);
  });
});

/**
 * The slider on the hour the strip opens on at `now`, the pill reading it
 * out, and the playhead on it in the week in view.
 */
async function expectHourUnderPlayhead(page: Page, now: number) {
  const slider = timeSlider(page);
  const pill = barPill(page);
  const columns = stripAt(now);
  const at = openingColumn(columns, now);
  const settled = async () => {
    await expect(slider).toHaveValue(String(at));
    await expect(slider).toHaveAttribute(
      "aria-valuetext",
      timeSpoken(columns[at].time),
    );
    await expect(pill).toContainText(pillTime(columns[at].time));
    const [x, width] = await scrubBar(page)
      .locator(".sb-strip")
      .evaluate((strip) => [
        Number(
          strip
            .querySelector(".sb-head")!
            .getAttribute("transform")!
            .match(/translate\(([-\d.]+)/)![1],
        ),
        strip.clientWidth,
      ]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(width);
  };
  await settled();
  // And it stays there once the strip has settled.
  await page.waitForTimeout(1000);
  await settled();
}

test("the spot chosen is remembered, a bare point is not, and neither opens the next visit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await expect(barName(page)).toHaveCount(0);
  await findSpot(page, "Keel");
  await expect(barName(page)).toHaveText("Keel Beach");
  expect(Object.keys((await stored(page)).visits)).toEqual(["keel"]);

  // A light chosen on the chart is remembered the same way, over the last.
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect(barName(page)).toHaveText("Dollymount");

  // A point on the open sea is not a riding place: it takes the scrub bar,
  // and is not remembered.
  await page.keyboard.press("Escape");
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  const water = await page.evaluate((box) => {
    for (let y = 300; y < box.height - 360; y += 30)
      for (let x = 400; x > 60; x -= 30) {
        const hit = document.elementFromPoint(box.x + x, box.y + y);
        if (hit?.tagName === "CANVAS") return { x, y };
      }
    return { x: 300, y: 300 };
  }, box);
  await canvas.click({ position: water });
  // Named by the nearest place or its coordinates, with no stars.
  await expect(scrubBar(page).locator(".sb-spot")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  await expect(scrubBar(page)).not.toHaveAttribute("data-spot");
  await expect(scrubBar(page).locator(".sb-stars")).toHaveCount(0);

  expect(Object.keys((await stored(page)).visits).sort()).toEqual([
    "dollymount",
    "keel",
  ]);

  // Remembered on the device, but the next visit opens on the chart alone:
  // the plain timeline at its foot until a spot is chosen again.
  await page.reload();
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(scrubBar(page)).toHaveClass(/\bis-bare\b/, { timeout: 30000 });
  await expect(barName(page)).toHaveCount(0);
  await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
});

test("the spot chosen is in the link, by search or light, and Back steps through them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  await expect(page).toHaveURL(/\/\?map$/);
  await findSpot(page, "Keel");
  await expect(barName(page)).toHaveText("Keel Beach");
  await expect(page).toHaveURL(/\/\?spot=keel$/);
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect(barName(page)).toHaveText("Dollymount");
  await expect(page).toHaveURL(/\/\?spot=dollymount$/);
  // Back to the spot before, then to the chart alone; Forward again.
  await page.goBack();
  await expect(page).toHaveURL(/\/\?spot=keel$/);
  await expect(barName(page)).toHaveText("Keel Beach");
  await page.goBack();
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(barName(page)).toHaveCount(0);
  await page.goForward();
  await expect(barName(page)).toHaveText("Keel Beach");
  // The link opens on the spot it names.
  await page.goto("/?spot=keel");
  await expect(barName(page)).toHaveText("Keel Beach", { timeout: 30000 });
});

test("Back lets go of a tap on the chart still waiting to pick a point: the chart alone at the link with no spot (#90)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await page.locator('[data-spot-id="tramore"]').dispatchEvent("click");
  await expect(barName(page)).toHaveText("Tramore", { timeout: 30000 });
  await scrubBar(page)
    .getByRole("button", { name: "Close the forecast for Tramore" })
    .click();
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(barName(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?spot=tramore$/);
  await expect(barName(page)).toHaveText("Tramore");
  const open = await openChart(page);
  // A tap there waits a moment for a second before it picks the point: Back
  // within that moment, and then the moment passing, picks nothing.
  await page.mouse.click(open.x, open.y);
  await page.goBack();
  await page.waitForTimeout(800);
  await expect(page).toHaveURL(/\/\?map$/);
  await expect(barName(page)).toHaveCount(0);
  expect(await page.evaluate(() => history.state)).toBeNull();
});

test("a spot chosen while a tap on the chart waits to pick its point is the one the scrub bar opens on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMap(page);
  const light = async (id: string) => {
    const box = (await page.locator(`[data-spot-id="${id}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  /** The scrub bar a moment after the tap's wait, and the link. */
  const settles = async (name: string, id: string) => {
    await page.waitForTimeout(800);
    await expect(barName(page)).toHaveText(name);
    await expect(page).toHaveURL(new RegExp(`/\\?spot=${id}$`));
  };
  // A tap on the chart, then at once a light: the light's click stops there,
  // and the map never heard of it.
  let open = await openChart(page);
  let at = await light("tramore");
  await page.mouse.click(open.x, open.y);
  await page.mouse.click(at.x, at.y);
  await settles("Tramore", "tramore");
  // The same with the open spot's own light, once the chart has flown to it.
  await steadyFrames(page);
  open = await openChart(page);
  at = await light("tramore");
  await page.mouse.click(open.x, open.y);
  await page.mouse.click(at.x, at.y);
  await settles("Tramore", "tramore");
  // And a spot found by the search.
  open = await openChart(page);
  await page.mouse.click(open.x, open.y);
  await findSpot(page, "Keel");
  await settles("Keel Beach", "keel");
});

test("a spot in the link opens on it, focused; a remembered one waits to be chosen", async ({
  page,
}) => {
  await rememberSpot(page, "dollymount");
  await openMap(page, "/?spot=keel");
  await expect(barName(page)).toHaveText("Keel Beach");
  await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
  // Opening a link is not choosing, and the remembered spot opens nothing.
  await page.goto("/?map");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(barName(page)).toHaveCount(0);
  expect(Object.keys((await stored(page)).visits)).toEqual(["dollymount"]);
});

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`a visitor with stars and a spot chosen before still opens on the chart alone, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript((key) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(
          key,
          JSON.stringify({
            starred: ["rusheen", "keel"],
            visits: { brandon: { id: "brandon", count: 3, last: 9e12 } },
          }),
        );
    }, SPOTS_KEY);
    await openMap(page);
    // The plain timeline alone at the chart's foot: no spot's week.
    await expect(
      page.getByRole("region", { name: "Forecast time, for the whole chart" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(barName(page)).toHaveCount(0);
    await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
    // A tap on a star's light brings its week.
    await page.locator('[data-spot-id="rusheen"]').dispatchEvent("click");
    await expect(barName(page)).toHaveText("Rusheen Bay");
    await expect(
      page.getByRole("region", { name: "Forecast for Rusheen Bay" }),
    ).toBeVisible();
    await expect(page.locator(".scrub[data-spot=rusheen]")).toBeVisible();
  });
}
