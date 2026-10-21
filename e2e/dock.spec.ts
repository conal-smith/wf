import {
  backToIreland,
  chooseSpot,
  closePanel,
  expect,
  steadyFrames,
  test,
  unfoldTools,
  type Page,
} from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { buildPyramid } from "../scripts/f5tile.mjs";
import { readFileSync } from "node:fs";
import { spotSquare } from "../force5/src/squares";

const harmonie = readSample("harmonie");

// A spot's dock: Brandon Bay's, chosen with a tap on its light or named in
// the link. The map opens on no spot (e2e/no-spot.spec.ts).

/**
 * A tide fixture, so the tide row is tested the same way whether or not
 * `public/marine` has been generated locally (it is git-ignored): a plain
 * semidiurnal curve, with its highs and lows where the curve turns.
 */
const STEP_MINUTES = 30;
const FROM = "2026-09-13T00:00:00Z";
const SAMPLES = 8 * 48 + 1; // eight days at half-hourly steps.
const height = (i: number) => 2.2 + 1.8 * Math.sin((i * Math.PI) / 12.42);
const turns = Array.from({ length: SAMPLES }, (_, i) => i).filter(
  (i) =>
    i > 0 &&
    i < SAMPLES - 1 &&
    Math.sign(height(i) - height(i - 1)) !==
      Math.sign(height(i + 1) - height(i)),
);
const tideCurve = {
  stepMinutes: STEP_MINUTES,
  from: FROM,
  to: new Date(
    Date.parse(FROM) + (SAMPLES - 1) * STEP_MINUTES * 60000,
  ).toISOString(),
  datum: "LAT",
  curve: Array.from({ length: SAMPLES }, (_, i) => height(i)),
  events: turns.map((i) => ({
    time: new Date(Date.parse(FROM) + i * STEP_MINUTES * 60000).toISOString(),
    kind: height(i) > 2.2 ? "high" : "low",
    height: Number(height(i).toFixed(2)),
  })),
};
const tideManifest = {
  schemaVersion: 1,
  kind: "tide",
  stations: {
    Fenit: {
      name: "Fenit",
      lat: 52.27,
      lon: -9.87,
      url: "marine/tides-Fenit-test.json",
    },
  },
  spots: {
    brandon: { station: "Fenit", distanceKm: 10.9 },
    dollymount: {
      station: null,
      distanceKm: 103.9,
      reason: "Nearest station is 104 km away, beyond the 40 km limit.",
    },
  },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};
async function withTides(page: Page) {
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-Fenit-test.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
}

/** The chart, up, and Brandon Bay's dock, chosen from it, with the tide fixture. */
async function openDock(page: Page, width = 1440, height = 900) {
  await withTides(page);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await chooseSpot(page, "brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  // The tap flies the chart to the spot: let it land before the hours are
  // timed against the frames.
  await steadyFrames(page);
}

const slider = (page: Page) =>
  page.getByRole("slider", { name: "Forecast time" });

/**
 * How far, in pixels, the selected hour is from where the strip stands: the
 * scroll against the one that brings that hour to the strip's middle (its
 * snap mark), and the pen's frame against the hour's own column.
 */
async function offCursor(page: Page) {
  return page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".dock .tt-wrap");
    const cell = document.querySelector<HTMLElement>(
      ".dock tr.tt-hour td.c-sel",
    );
    const frame = document.querySelector(".dock .pen-frame");
    if (!wrap || !cell || !frame) return Infinity;
    const snap =
      wrap.querySelectorAll<HTMLElement>(".tt-snaps i")[Number(cell.dataset.i)];
    const max = wrap.scrollWidth - wrap.clientWidth;
    const scroll = Math.abs(
      wrap.scrollLeft - Math.min(max, parseFloat(snap.style.left)),
    );
    const c = cell.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const framed = Math.abs(c.left + c.width / 2 - (f.left + f.width / 2));
    return Math.max(scroll, framed);
  });
}

test("the week is one strip of hours round the clock, with no day slider over it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDock(page);
  const hours = page.locator(".dock tr.tt-hour td[data-i]");
  await expect(hours).toHaveCount(sampleStrip.length);
  // Every hour, the night's as well: the labels are the strip's own hours,
  // and no two neighbours on one day are further apart than the run's step.
  expect((await hours.allTextContents()).map(Number)).toEqual(
    sampleStrip.map((c) => c.hour),
  );
  expect(sampleStrip.some((c) => c.hour < 6)).toBe(true);
  expect(sampleStrip.some((c) => c.hour > 21)).toBe(true);
  for (let i = 1; i < sampleStrip.length; i++)
    expect(sampleStrip[i].time - sampleStrip[i - 1].time).toBeLessThanOrEqual(
      6 * 3600000,
    );
  // Each day once, as a heading on the strip: no row of day blocks above
  // it, and no spacer cells either side, so the table starts at the labels.
  const days = new Set(sampleStrip.map((c) => c.date)).size;
  await expect(page.locator(".dock tr.tt-day td")).toHaveCount(days);
  await expect(page.locator(".dock .sc-day, .dock .scrub")).toHaveCount(0);
  // The rows are glyphs, named in their titles; no words, and no "?".
  const titles = await page
    .locator(".dk-labs .dk-glyph")
    .evaluateAll((els) => els.map((el) => el.getAttribute("title")));
  expect(titles[0]).toMatch(/^Wind and gust, /);
  expect(titles.slice(1)).toEqual(["Where the wind goes", "Wing, m²"]);
  await expect(page.locator(".dk-labs")).not.toContainText(
    /Stars|Wind|From|Wing|Tide|More|Less/,
  );
  await expect(page.locator(".dock .help-q")).toHaveCount(0);
  // Stars only where it is light; a dark hour is left empty, not rated zero,
  // but it still reads its wind, its gust and where the wind goes.
  expect(
    await page.locator(".dock tr.tt-stars td[data-i] .hour-stars").count(),
  ).toBeGreaterThan(0);
  expect(
    await page
      .locator(".dock tr.tt-stars td.night:not(:has(.hour-stars))")
      .count(),
  ).toBeGreaterThan(0);
  await expect(
    page.locator(".dock tr.tt-stars td.night .hour-stars"),
  ).toHaveCount(0);
  await expect(
    page.locator(".dock tr.tt-wind td.night .kn").first(),
  ).toHaveText(/^\d+$/);
  await expect(
    page.locator(".dock tr.tt-wind td.night .gu").first(),
  ).toHaveText(/g\d+$/);
  await expect(
    page.locator(".dock tr.tt-from td.night .from-cell").first(),
  ).toBeAttached();
  // Every hour reads its wind and gust, and one arrow for where it goes.
  await expect(page.locator(".dock tr.tt-wind td .kn").first()).toHaveText(
    /^\d+$/,
  );
  await expect(
    page.locator(".dock tr.tt-from td .from-cell").first(),
  ).toHaveAttribute(
    "aria-label",
    /^From [NSEW]{1,3}, .*(shore|offshore|onshore)$/,
  );
  await expect(
    page.locator(".dock tr.tt-from td .g-arrow").first(),
  ).toBeVisible();
  await expect(page.locator(".dock tr.tt-from")).not.toContainText(/[NSEW]/);
  // The tide's turns are their times and heights on the curve; the turn and
  // the height in full are in its title.
  const tide = page.locator(".dock .tide-row");
  await expect(tide.locator(".tide-label").first()).toHaveText(
    /^\d\d:\d\d \d+\.\dm$/,
  );
  await expect(tide.locator("g > title").first()).toHaveText(
    /^(High|Low) tide \d\d:\d\d · \d+\.\d m$/,
  );
  await expect(tide).not.toContainText(/\b(HW|LW)\b/);
  // The time is a slider still, for the keys and a screen reader, named
  // by its day and hour; on the screen it is the pen's frame round an hour.
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2,3}, \d\d:\d\d$/,
  );
  // Nothing on the page scrolls sideways; the strip carries the hours.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the strip and the slider move together, by swipe, wheel and key", async ({
  page,
}) => {
  await openDock(page);
  const wrap = page.locator(".dock .tt-wrap");
  // The time moving scrolls the strip: the hour comes to its middle, framed.
  await slider(page).fill("12");
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The strip scrolling moves the time, and the slider with it: whatever
  // comes to rest in the middle is the hour.
  const cw = await page
    .locator(".dock tr.tt-hour td[data-i]")
    .first()
    .evaluate((td) => td.getBoundingClientRect().width);
  await wrap.evaluate((el) => el.scrollTo({ left: el.scrollWidth / 3 }));
  await expect
    .poll(async () => Number(await slider(page).inputValue()))
    .toBeGreaterThan(12);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  const scrolled = Number(await slider(page).inputValue());
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${scrolled}"]`),
  ).toHaveClass(/c-sel/);
  // A plain wheel, turned up or down, moves the hours sideways, eased over
  // a few frames rather than in one jump, and comes to rest on an hour.
  await wrap.hover();
  const before = await wrap.evaluate((el) => el.scrollLeft);
  const frames = wrap.evaluate(
    (el) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const start = performance.now();
        const look = () => {
          seen.push(el.scrollLeft);
          if (performance.now() - start < 600) requestAnimationFrame(look);
          else resolve(seen);
        };
        requestAnimationFrame(look);
      }),
  );
  await page.mouse.wheel(0, 100);
  const path = await frames;
  const between = new Set(
    path.filter((left) => left > before + 1 && left < Math.max(...path) - 1),
  );
  expect(between.size).toBeGreaterThan(2);
  await expect
    .poll(async () => Number(await slider(page).inputValue()))
    .toBeGreaterThan(scrolled);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // A trackpad's small steps move it as they come, and are not pulled back
  // to the hour they left.
  const stepped = await wrap.evaluate((el) => {
    const from = el.scrollLeft;
    for (let i = 0; i < 10; i++)
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 3.5,
          bubbles: true,
          cancelable: true,
        }),
      );
    return el.scrollLeft - from;
  });
  expect(stepped).toBeGreaterThan(30);
  expect(stepped).toBeLessThan(40);
  await page.waitForTimeout(800);
  expect(await wrap.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // At the start of the strip, a wheel turned back is the page's.
  await slider(page).press("Home");
  await expect.poll(() => wrap.evaluate((el) => el.scrollLeft)).toBe(0);
  const back = await wrap.evaluate((el) => {
    const event = new WheelEvent("wheel", {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(back).toBe(false);
  // A sideways swipe (a trackpad's, or a tilted wheel) is the browser's own.
  const prevented = await wrap.evaluate((el) => {
    const event = new WheelEvent("wheel", {
      deltaX: 120,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  // And the keys, on the slider out of sight: its ring is on the hours.
  await slider(page).focus();
  await page.keyboard.press("End");
  await expect(slider(page)).toHaveValue(String(sampleStrip.length - 1));
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  expect(await wrap.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
    "solid",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(slider(page)).toHaveValue(String(sampleStrip.length - 2));
  // A day at a time with Page Up and Down.
  await slider(page).press("Home");
  await expect(slider(page)).toHaveValue("0");
  // At the start the table sits against the labels, with no blank paper
  // before it, and the frame comes out to the first hour instead.
  await expect.poll(() => wrap.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The same hour the next day, not as many columns into it: the first day
  // starts in the afternoon and the next at midnight.
  await slider(page).press("PageUp");
  const day = sampleStrip.findIndex(
    (c) => c.date !== sampleStrip[0].date && c.hour === sampleStrip[0].hour,
  );
  await expect(slider(page)).toHaveValue(String(day));
  await slider(page).press("PageDown");
  await expect(slider(page)).toHaveValue("0");
});

test("a night hour is a column of its own: tapped, keyed and under the line", async ({
  page,
}) => {
  await openDock(page);
  // The sample clock stands at 22:00 on the Sunday, in the dark: the strip
  // opens on that hour, not on Monday's first light.
  const now = sampleStrip.findIndex((c) => c.time === SAMPLE_CLOCK.getTime());
  expect(sampleStrip[now].hour).toBe(22);
  await expect(slider(page)).toHaveValue(String(now));
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The small hours of Monday: a tap on one selects it, the slider says so,
  // and the pen's frame goes round that column, not the morning's.
  const small = sampleStrip.findIndex(
    (c) => c.date !== sampleStrip[0].date && c.hour === 3,
  );
  const cell = page.locator(`.dock tr.tt-wind td[data-i="${small}"]`);
  await expect(cell).toHaveClass(/\bnight\b/);
  await cell.click();
  await expect(slider(page)).toHaveValue(String(small));
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 03:00$/,
  );
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${small}"]`),
  ).toHaveClass(/\bc-sel\b/);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The keys step through the night an hour at a time.
  await slider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 04:00$/,
  );
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The tide under it is hatched across the same dark columns.
  const hatched = await page.evaluate((i) => {
    const td = document.querySelector(`.dock tr.tt-hour td[data-i="${i}"]`)!;
    const box = td.getBoundingClientRect();
    return [...document.querySelectorAll(".dock .tide-night rect")].some(
      (rect) => {
        const r = rect.getBoundingClientRect();
        return r.left <= box.left + 1 && r.right >= box.right - 1;
      },
    );
  }, small);
  expect(hatched).toBe(true);
});

test("the arrow keys step the hour as the page opens, with nothing clicked, and only as pressed", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  const start = Number(await slider(page).inputValue());
  // Nothing has the focus: no hour has been clicked, nor the strip.
  expect(
    await page.evaluate(() => document.activeElement === document.body),
  ).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(slider(page)).toHaveValue(String(start + 1));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(slider(page)).toHaveValue(String(start + 2));
  // Nothing comes later: no scroll left running is read back as hours.
  await page.waitForTimeout(1500);
  await expect(slider(page)).toHaveValue(String(start + 2));
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // In the search field the keys move the caret, not the hour.
  const search = page.getByRole("combobox", { name: "Find a spot" });
  await search.fill("keel");
  await search.press("ArrowLeft");
  await expect(slider(page)).toHaveValue(String(start + 2));
});

test("a tap on an hour selects it", async ({ page }) => {
  await openDock(page);
  const cell = page.locator('.dock tr.tt-wing td[data-i="6"]');
  await cell.click();
  await expect(slider(page)).toHaveValue("6");
});

test("the stars open nothing on hover, and their explanation is the map's i", async ({
  page,
}) => {
  await openDock(page);
  const star = page.locator(".dock tr.tt-stars .hour-stars").first();
  await star.scrollIntoViewIfNeeded();
  await expect(star).toHaveAttribute("aria-label", /^\d\d:\d\d: /);
  await star.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // No "?" in the dock: the map's own "i" explains the stars.
  await expect(
    page.locator(".dock").getByRole("button", { name: "How the stars work" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Map information" }).click();
  const info = page.getByRole("dialog", { name: "About the map" });
  await expect(info.locator("#map-info-stars")).toBeInViewport();
  await expect(
    info.getByRole("link", { name: "How the stars work, in full →" }),
  ).toHaveAttribute("href", "/stars?spot=brandon");
});

test("the spot's tools stand on the chart over the dock, and no day is rated", async ({
  page,
}) => {
  await openDock(page);
  // No county, no compass, no line of the day's best, no small print, no
  // play: the star, the name, whose forecast the stars are, the blend, the
  // page and the fold, in a box on the chart at the dock's top edge. The
  // dock under it is its rows.
  const tools = page.getByRole("group", { name: "This spot" });
  await expect(tools).toHaveText(/^Brandon Bay(HARMONIE|ECMWF)$/);
  const box = (await tools.boundingBox())!;
  const dock = (await page.locator(".dock").boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  const hours = (await page.locator(".dock tr.tt-day").boundingBox())!;
  expect(hours.y - dock.y).toBeLessThan(10);
  await expect(
    tools.getByRole("button", { name: "About these figures" }),
  ).toHaveCount(0);
  for (const name of ["Star Brandon Bay", "Blend", "Show waves, sky and sea"])
    await expect(tools.getByRole("button", { name })).toBeVisible();
  await expect(tools.getByRole("button", { name: "Blend" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    tools.getByRole("button", { name: /Play forecast|Pause forecast/ }),
  ).toHaveCount(0);
  // No day is rated: a day's heading is its name and date, with no stars
  // and no best stretch, and the pen loops no day's best. The hours carry
  // the stars.
  await expect(page.locator(".dock tr.tt-day svg")).toHaveCount(0);
  await expect(page.locator(".dock tr.tt-day")).not.toContainText("best");
  await expect(page.locator(".dock tr.tt-day td").first()).not.toHaveAttribute(
    "title",
    /star/,
  );
  await expect(page.locator(".dock .tt-pen .pen-loop")).toHaveCount(0);
  await expect(tools.getByRole("link", { name: "Spot page" })).toHaveAttribute(
    "href",
    "/spot/brandon",
  );
});

test("a starred spot is kept on this device: the dock and your spots agree", async ({
  page,
}) => {
  await openDock(page);
  const panel = page.getByRole("complementary", { name: "Your spots" });
  const yours = page.getByRole("button", { name: "Your spots", exact: true });
  // Behind the star under Layers, not on the chart.
  await expect(panel).toHaveCount(0);
  await yours.click();
  await expect(panel).toContainText("Tap the red star");
  await closePanel(page);
  await page
    .locator(".dock")
    .getByRole("button", { name: "Star Brandon Bay" })
    .click();
  await expect(
    page.locator(".dock").getByRole("button", { name: "Unstar Brandon Bay" }),
  ).toHaveAttribute("aria-pressed", "true");
  await yours.click();
  await expect(panel.locator(".fvl li").first()).toContainText("Brandon Bay");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wingfoil.spots.v1") ?? "{}"),
  );
  expect(stored.starred).toEqual(["brandon"]);
  await closePanel(page);
  // Chosen again from the search, the spot comes back starred.
  await page.getByRole("combobox", { name: "Find a spot" }).fill("Brandon");
  await page.locator(".spot-row").first().click();
  await expect(
    page.locator(".dock").getByRole("button", { name: "Unstar Brandon Bay" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Opening a spot counts it among the often opened; the count is in the
  // entry's title, not printed as a bare "1×".
  await page.getByRole("combobox", { name: "Find a spot" }).fill("Dollymount");
  await page.locator(".spot-row").first().click();
  await yours.click();
  await expect(panel).toContainText("Often opened");
  await expect(panel).toContainText("Dollymount");
  // Each spot at the hour the map shows, never a day's best.
  await expect(panel).not.toContainText(/best|done for the day|no stars/);
  await expect(panel.locator(".side-head .when")).toHaveText(
    /^[A-Z]{3} \d+ \d\d:\d\d$/,
  );
  await expect(panel).not.toContainText("1×");
  await expect(
    panel.locator(".fvl li", { hasText: "Dollymount" }).locator(".fv-go span"),
  ).toHaveAttribute("title", /^Opened (once|\d+ times) on this device$/);
  await page.reload();
  await expect(panel).toHaveCount(0);
  await yours.click({ timeout: 30000 });
  await expect(panel.locator(".fvl li").first()).toContainText("Brandon Bay", {
    timeout: 30000,
  });
  // And unstarring from the panel takes it off.
  await panel.getByRole("button", { name: "Unstar Brandon Bay" }).click();
  await expect(panel).toContainText("Tap the red star");
  // A spot chosen from the panel is the dock's.
  await panel.getByRole("button", { name: /^Dollymount/ }).click();
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
  // The key is not in the panel: it is the map's information, a button away.
  await yours.click();
  await expect(panel).not.toContainText("Depths in metres below chart datum");
  await closePanel(page);
  await page.getByRole("button", { name: "Map information" }).click();
  await expect(
    page.getByRole("dialog", { name: "About the map" }),
  ).toContainText("Depths in metres below chart datum");
});

test("units, the rider and the blend's models are display options, kept on reload", async ({
  page,
}) => {
  await openDock(page);
  const wing = () =>
    page.locator(".dock tr.tt-wing td[data-i]").allTextContents();
  const before = await wing();
  // From the map's controls now, not the dock's head.
  await page
    .getByRole("button", { name: "Display options", exact: true })
    .click();
  await page.locator('[data-units="m/s"]').click();
  await page.locator('input[data-rider="weight"]').fill("100");
  await page.locator('[data-skill="beginner"]').click();
  await page.locator('input[data-model-toggle="gfs"]').uncheck();
  await closePanel(page);
  await expect(page.locator(".dk-labs")).toContainText("m/s");
  // A heavier learner takes a bigger wing for the same wind, hour by hour.
  await expect
    .poll(async () => {
      const after = await wing();
      const both = before
        .map((cell, at) => [Number(cell), Number(after[at])])
        .filter(([was, now]) => was > 0 && now > 0);
      return (
        both.length > 0 &&
        both.every(([was, now]) => now >= was) &&
        both.some(([was, now]) => now > was)
      );
    })
    .toBe(true);
  // Kept on reload; the spot, as on any visit, is chosen again.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(page.locator(".dk-labs")).toContainText("m/s", {
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Display options", exact: true })
    .click();
  await expect(page.locator('[data-units="m/s"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-skill="beginner"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator('input[data-model-toggle="gfs"]'),
  ).not.toBeChecked();
});

/** Each hour's stars in the dock, as a screen reader hears them. */
const starLabels = (page: Page) =>
  page
    .locator(".dock tr.tt-stars .hour-stars")
    .evaluateAll((all) => all.map((el) => el.getAttribute("aria-label") ?? ""));

/** Every light's rating for the hour in hand. */
const lightRatings = (page: Page) =>
  page
    .locator(".spot-marker")
    .evaluateAll((all) =>
      all.map(
        (light) =>
          `${light.getAttribute("data-spot-id")}:${[...light.classList].find((c) => /^s\d$/.test(c)) ?? "-"}:${light.querySelector(".lt-sub")?.textContent ?? ""}`,
      ),
    );

/** Whether the dock's stars for the hour in hand are Brandon's light's. */
const dockAndLightAgree = (page: Page) =>
  page.evaluate(() => {
    const at = document
      .querySelector(".dock tr.tt-hour td.c-sel")
      ?.getAttribute("data-i");
    const label =
      document
        .querySelector(`.dock tr.tt-stars td[data-i="${at}"] .hour-stars`)
        ?.getAttribute("aria-label") ?? "";
    const light =
      document
        .querySelector('.spot-marker[data-spot-id="brandon"] .lt-n')
        ?.textContent?.trim() ?? "";
    return (/: (\d) of 5/.exec(label)?.[1] ?? "") === light;
  });

/** Select an hour, as a tap on it does. */
const selectHour = (page: Page, at: string) =>
  page
    .locator(`.dock tr.tt-hour td[data-i="${at}"]`)
    .evaluate((cell: HTMLElement) => cell.click());

/** Select the first hour whose stars are `model`'s; gives back which. */
async function selectFrom(page: Page, model: string): Promise<string> {
  const at = await page
    .locator(".dock tr.tt-stars td[data-i]")
    .evaluateAll(
      (cells, name) =>
        cells
          .find((cell) =>
            cell
              .querySelector(".hour-stars")
              ?.getAttribute("aria-label")
              ?.endsWith(`from ${name}`),
          )
          ?.getAttribute("data-i") ?? null,
      model,
    );
  expect(at).not.toBeNull();
  await selectHour(page, at!);
  return at!;
}

/** Choose in Display options' Stars from: `group` names which row. */
async function starsFrom(page: Page, group: string, model: string) {
  await page
    .getByRole("button", { name: "Display options", exact: true })
    .click();
  await page
    .getByRole("group", { name: group, exact: true })
    .getByRole("button", { name: model, exact: true })
    .click();
  await closePanel(page);
}

test("the stars come from one model, the rider's choice: the dock names it and the map follows", async ({
  page,
}) => {
  await openDock(page);
  // The whole of Ireland, with Brandon's dock open: every light rated.
  await backToIreland(page);
  const chip = page.locator(".dock [data-stars-from-chip]");

  // By default HARMONIE rates the hours it reaches, and ECMWF alone takes
  // over where its run ends, marked on the hours in the site's own hand.
  await expect(chip).toHaveAttribute("data-stars-from-chip", "harmonie");
  await expect(chip).toContainText("HARMONIE");
  const before = await starLabels(page);
  expect(before.some((label) => label.endsWith("from HARMONIE"))).toBe(true);
  expect(before.some((label) => label.endsWith("from ECMWF"))).toBe(true);
  expect(before.every((label) => /from (HARMONIE|ECMWF)$/.test(label))).toBe(
    true,
  );
  await expect(page.locator('.dock [data-handover="ecmwf"]')).toHaveText(
    /^ECMWF from \w{3} \d\d:\d\d$/,
  );
  // A daylight hour of HARMONIE's, where the lights have stars to show.
  const hour = await selectFrom(page, "HARMONIE");
  await expect.poll(() => dockAndLightAgree(page)).toBe(true);
  const lightsBefore = await lightRatings(page);

  // Stars from GFS, everywhere. The sample's GFS run starts days later, so
  // that hour is ECMWF's now, the model that takes over: never HARMONIE's.
  await starsFrom(page, "Stars from", "GFS");
  await expect
    .poll(async () => {
      const labels = await starLabels(page);
      return (
        labels.some((label) => label.endsWith("from GFS")) &&
        labels.every((label) => /from (GFS|ECMWF)$/.test(label))
      );
    })
    .toBe(true);
  await expect(chip).toHaveAttribute("data-stars-from-chip", "ecmwf");
  await expect(page.locator('.dock [data-handover="gfs"]')).toHaveText(
    /^GFS from \w{3} \d\d:\d\d$/,
  );
  await expect(page.locator('.dock [data-handover="ecmwf"]')).toHaveCount(1);

  // The map follows at the same hour: every light rated again, from the
  // models' own spot squares, and Brandon's light is the dock's hour.
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect
    .poll(() => lightRatings(page), { timeout: 30000 })
    .not.toEqual(lightsBefore);
  await expect
    .poll(() => dockAndLightAgree(page), { timeout: 30000 })
    .toBe(true);
  // An hour GFS reaches is named GFS in the dock's head.
  await selectFrom(page, "GFS");
  await expect(chip).toHaveAttribute("data-stars-from-chip", "gfs");
  await expect(chip).toContainText("GFS");
  await expect
    .poll(() => dockAndLightAgree(page), { timeout: 30000 })
    .toBe(true);

  // Kept on reload, and back to the default puts the published blend's
  // lights back as they were.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(page.locator('.dock [data-handover="gfs"]')).toHaveCount(1, {
    timeout: 30000,
  });
  await starsFrom(page, "Stars from", "HARMONIE");
  await expect(page.locator('.dock [data-handover="gfs"]')).toHaveCount(0);
  await backToIreland(page);
  await selectHour(page, hour);
  await expect(chip).toHaveAttribute("data-stars-from-chip", "harmonie");
  await expect
    .poll(() => lightRatings(page), { timeout: 30000 })
    .toEqual(lightsBefore);
});

test("a spot can take its stars from a model of its own, and says so", async ({
  page,
}) => {
  await openDock(page);
  const chip = page.locator(".dock [data-stars-from-chip]");
  await starsFrom(page, "Stars at Brandon Bay", "GFS");
  await selectFrom(page, "GFS");
  await expect(chip).toHaveAttribute("data-stars-from-chip", "gfs");
  await expect(chip).toHaveClass(/is-own/);
  await expect(chip).toContainText("from GFS");
  // Every other place is still the published blend's, and still rated.
  await backToIreland(page);
  await expect
    .poll(() => dockAndLightAgree(page), { timeout: 30000 })
    .toBe(true);
  await starsFrom(page, "Stars at Brandon Bay", "Same");
  await expect(chip).not.toHaveClass(/is-own/);
  // That hour, past HARMONIE's run, is ECMWF's again by default.
  await expect(chip).toHaveAttribute("data-stars-from-chip", "ecmwf");
});

test("the display options open over the dimmed map from its controls, one panel at a time", async ({
  page,
}) => {
  await openDock(page);
  const trigger = page.getByRole("button", {
    name: "Display options",
    exact: true,
  });
  const panel = page.locator("#map-options");
  // Under your spots, over the map's information, in the controls' column.
  const names = await page
    .locator(".zbox button")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual([
    "Zoom in",
    "Zoom out",
    "Layers",
    "Your spots",
    "Display options",
    "Map information",
  ]);
  await expect(page.locator(".dock").getByLabel("Display options")).toHaveCount(
    0,
  );
  // From the keyboard: open, into it, and Escape hands focus back.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger).toHaveAttribute("aria-controls", "map-options");
  // A modal: the focus is in it from the start.
  await expect(
    page.getByRole("dialog", { name: "Display options" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector("#map-options")!.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
  // A press on the dimmed map round it shuts it, as its X does, and the
  // focus goes back to its button.
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(4, 400);
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await closePanel(page);
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the blend draws every model that covers the spot, on the strip's hours", async ({
  page,
}) => {
  await openDock(page);
  await page.locator(".dock").getByRole("button", { name: "Blend" }).click();
  const chart = page.locator(".dock .blend-chart");
  await expect(chart).toBeVisible();
  expect(await chart.locator(".model-line").count()).toBeGreaterThan(3);
  // The tide still runs under it. The chart's
  // label column is its unit and its scale, without a name.
  await expect(page.locator(".dock .tide-row")).toBeVisible();
  const scale = page.locator(".dock .dk-lab-blend");
  await expect(scale).toContainText("kn");
  await expect(scale.locator("b").first()).toHaveText(/^\d+$/);
  await expect(page.locator(".dk-labs")).not.toContainText(/Blend|Tide/);
  // The same glyph, pressed again, is the table.
  const blend = page.locator(".dock").getByRole("button", { name: "Blend" });
  await expect(blend).toHaveAttribute("aria-pressed", "true");
  await blend.click();
  await expect(blend).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("the head's chevron is the dock's one fold: the rows under the tide", async ({
  page,
}) => {
  await openDock(page);
  const chevron = page
    .locator(".dock .dk-tools")
    .getByRole("button", { name: "Show waves, sky and sea" });
  await expect(chevron).toHaveAttribute("aria-expanded", "false");
  // No folding the hours away, and no handle to do it with.
  await expect(
    page.getByRole("button", { name: /(Fold|Open) the hours/ }),
  ).toHaveCount(0);
  await expect(page.locator(".dock-grab")).toHaveCount(0);
  const height = async () =>
    (await page.locator(".dock").boundingBox())!.height;
  const before = await height();
  await chevron.click();
  const open = page
    .locator(".dock .dk-tools")
    .getByRole("button", { name: "Hide waves, sky and sea" });
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(1);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
  expect(await height()).toBeGreaterThan(before + 80);
  await open.click();
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(0);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("on a phone the dock is its hours alone, its tools on the chart, under a sixth of the screen", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".dock-grab")).toHaveCount(0);
  // No name and no row of buttons over the hours: the dock is its rows.
  const dock = (await page.locator(".dock").boundingBox())!;
  expect(dock.height).toBeLessThan(844 / 6);
  const hours = (await page.locator(".dock tr.tt-day").boundingBox())!;
  expect(hours.y - dock.y).toBeLessThan(8);
  // The name is there for a screen reader, and not on the screen: the
  // chart's loop says which spot it is.
  await expect(
    page.getByRole("region", { name: "Forecast for Brandon Bay" }),
  ).toBeVisible();
  expect(
    (await page.locator(".dock .dk-name").boundingBox())!.width,
  ).toBeLessThanOrEqual(1);
  // The tools stand on the chart just above the dock, folded into one
  // glyph until it is pressed, then glyphs alone, all within the screen.
  const tools = page.getByRole("group", { name: "This spot" });
  const fold = tools.getByRole("button", { name: "The spot's tools" });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  const folded = (await tools.boundingBox())!;
  expect(folded.width).toBeLessThan(48);
  await expect(tools.getByRole("button", { name: "Blend" })).toBeHidden();
  await fold.click();
  await expect(
    tools.getByRole("button", { name: "Fold the spot's tools" }),
  ).toHaveAttribute("aria-expanded", "true");
  const box = (await tools.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  expect(box.y + box.height).toBeGreaterThan(dock.y - 20);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Opened leftwards from under the finger: its right edge stays put.
  expect(box.x + box.width).toBeCloseTo(folded.x + folded.width, 0);
  for (const name of [
    "Star Brandon Bay",
    "Blend",
    "Spot page",
    "Show waves, sky and sea",
  ])
    await expect(
      tools.getByRole(name === "Spot page" ? "link" : "button", { name }),
    ).toBeVisible();
  // The blend's glyph switches the view, and back.
  const blend = tools.getByRole("button", { name: "Blend" });
  await blend.click();
  await expect(blend).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dock tr.tt-blend")).toBeVisible();
  await blend.click();
  await expect(blend).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".dock tr.tt-wind")).toBeVisible();
  await slider(page).fill("9");
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

/** The particle canvas's pixels with anything drawn in them. */
const inked = (page: Page) =>
  page.locator(".particle-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });

test("an hour past the map's model offers the run that reaches it", async ({
  page,
}) => {
  await openDock(page);
  const chip = page.getByRole("button", { name: /Show ECMWF on the map/ });
  const canvas = page.locator(".particle-canvas");
  const label = page.locator(".map-model");
  await expect(chip).toHaveCount(0);
  await expect(label).toHaveText("HARMONIE");
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  // The strip's last day: far past HARMONIE.
  const far = sampleStrip.length - 4;
  await slider(page).fill(String(far));
  await expect(chip).toBeVisible();
  // The map draws no wind there: HARMONIE's last frame left standing under
  // the lights' and the dock's reading of this hour was two moments shown as
  // one. It says why, where it names its model.
  await expect(canvas).toHaveClass(/is-blank/);
  await expect(label).toHaveText(
    /^HARMONIE ends \w{3} \d\d:\d\d · no wind drawn$/,
  );
  await expect.poll(() => inked(page), { timeout: 5000 }).toBe(0);
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".layers .models-note")).toHaveText(
    /^HARMONIE ends \w{3} \d\d:\d\d: no wind on the map at \w{3} \d\d:\d\d\. ECMWF reaches it\.$/,
  );
  await closePanel(page);
  // Back to an hour HARMONIE reaches, and its wind is drawn again.
  await slider(page).fill("2");
  await expect(chip).toHaveCount(0);
  await expect(canvas).not.toHaveClass(/is-blank/);
  await expect(label).toHaveText("HARMONIE");
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  await slider(page).fill(String(far));
  await expect(canvas).toHaveClass(/is-blank/);
  // Nothing switched by itself; the chip is the reader asking.
  await chip.click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator('[data-model="ecmwf"]')).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 20000 },
  );
  await expect(slider(page)).toHaveValue(String(far));
  await expect(chip).toHaveCount(0);
  // ECMWF reaches the hour: its wind is drawn, and named.
  await expect(canvas).not.toHaveClass(/is-blank/);
  await expect(label).toHaveText(/^ECMWF/);
  await expect(label).not.toContainText("no wind drawn");
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
});

/**
 * A newer HARMONIE run, 16 UTC to the bundled 13 UTC, in a run directory of its
 * own with tiles and spot squares of its own: a tile carries its run, hour and
 * place and is checked against the manifest that named it, and a square names
 * its run, which is what makes an atomic swap safe.
 */
const NEWER_RUN = "2026091316";
const NEWER_RUN_TIME = "2026-09-13T16:00:00Z";
const NEWER_BASE = `harmonie-${NEWER_RUN}-24h-v1-0a1b2c3d/`;
const NEWER_RUN_DIR = `weather/${NEWER_BASE}`.slice(0, -1);
const newerValidTime = (hour: number) =>
  new Date(Date.parse(NEWER_RUN_TIME) + hour * 3600000).toISOString();
const newerFrames = Array.from({ length: 25 }, (_, hour) => ({
  hour,
  validTime: newerValidTime(hour),
  gustIntervalHours: null,
}));
const newerHarmonie = {
  ...harmonie,
  run: NEWER_RUN,
  runTime: NEWER_RUN_TIME,
  generatedAt: NEWER_RUN_TIME,
  base: NEWER_BASE,
  frames: newerFrames,
};
/** One square of the newer run: every riding location in it, a steady wind. */
const places: { id: string; lat: number; lon: number }[] = JSON.parse(
  readFileSync("public/riding-locations.json", "utf8"),
);
const newerSquare = (square: string) => ({
  schemaVersion: 2,
  model: "harmonie",
  run: NEWER_RUN,
  square,
  spotForecasts: Object.fromEntries(
    places
      .filter((place) => spotSquare(place.lat, place.lon) === square)
      .map((place) => [
        place.id,
        newerFrames.map((frame, column) => ({
          hour: frame.hour,
          validTime: frame.validTime,
          u: 6 + column * 0.2,
          v: -4,
          gust: null,
        })),
      ]),
  ),
});
const CELLS = harmonie.grid.width * harmonie.grid.height;
/** Every tile of one hour of the newer run: a steady wind, written as the site's are. */
const newerTiles = new Map<number, Map<string, Buffer>>();
function newerTile(level: number, x: number, y: number, hour: number) {
  if (!newerTiles.has(hour)) {
    const { tiles } = buildPyramid(
      harmonie.grid,
      {
        u: Array.from({ length: CELLS }, () => 6),
        v: Array.from({ length: CELLS }, () => -4),
      },
      hour,
      NEWER_RUN,
      { size: harmonie.tiles.size },
    );
    newerTiles.set(
      hour,
      new Map(
        tiles.map((tile) => [`${tile.level}/${tile.x}/${tile.y}`, tile.bytes]),
      ),
    );
  }
  return newerTiles.get(hour)!.get(`${level}/${x}/${y}`);
}
async function withNewerRunFrames(page: Page) {
  await page.route(`**/${NEWER_RUN_DIR}/t/**`, (route) => {
    const [level, x, y, hour] = (
      /\/t\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(
        new URL(route.request().url()).pathname,
      ) ?? []
    )
      .slice(1)
      .map(Number);
    const body = newerTile(level, x, y, hour);
    return body
      ? route.fulfill({ body, contentType: "application/octet-stream" })
      : route.fulfill({ status: 404, body: "Not found" });
  });
  await page.route(`**/${NEWER_RUN_DIR}/spots/*`, (route) => {
    const square = /([ns]\d{2}[ew]\d{3})\.json$/.exec(
      new URL(route.request().url()).pathname,
    )?.[1];
    return route.fulfill({ json: newerSquare(square ?? "") });
  });
}

test("an open tab moves to a newer run and keeps the time it was showing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let published = harmonie;
  await withTides(page);
  await withNewerRunFrames(page);
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ json: published }),
  );
  await page.clock.install({ time: SAMPLE_CLOCK });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  // An hour ahead: one the clock has already overtaken would go back to now.
  const ahead =
    sampleStrip.findIndex((c) => c.time > SAMPLE_CLOCK.getTime()) + 3;
  await page.locator(`.dock tr.tt-wing td[data-i="${ahead}"]`).click();
  await expect(slider(page)).toHaveValue(String(ahead));
  const showing = (await slider(page).getAttribute("aria-valuetext"))!;
  published = newerHarmonie;
  // A check that comes due with the slider under the reader's hand is put off.
  await slider(page).focus();
  await page.clock.fastForward("05:01");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  // Hands off, and a minute later the deferred check goes through.
  await page.getByLabel("Display options", { exact: true }).focus();
  await page.clock.fastForward("01:00");
  await expect(page.locator(".frame-status")).toContainText(
    "Updated to the 16:00 UTC run",
    { timeout: 20000 },
  );
  // The reader keeps the hour they were reading.
  await expect(slider(page)).toHaveAttribute("aria-valuetext", showing);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tab whose run's tiles have gone moves to the run its pointer names now", async ({
  page,
}) => {
  // The run on screen is superseded and, past its grace period, deleted while
  // the tab still shows it: the next tiles it needs answer 404. The tab finds
  // the newer run then, not at its next five-minute check.
  let published = harmonie;
  let deleted = false;
  await withTides(page);
  await withNewerRunFrames(page);
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ json: published }),
  );
  await page.route(`**/weather/${harmonie.base}t/**`, (route) =>
    deleted
      ? route.fulfill({ status: 404, body: "Not found" })
      : route.fallback(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: SAMPLE_CLOCK });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  // An hour of the reader's own, so nothing but the map's view asks for tiles.
  const ahead =
    sampleStrip.findIndex((c) => c.time > SAMPLE_CLOCK.getTime()) + 3;
  await page.locator(`.dock tr.tt-wing td[data-i="${ahead}"]`).click();
  await expect(slider(page)).toHaveValue(String(ahead));
  await expect(page.locator(".frame-status")).toHaveCount(0, {
    timeout: 20000,
  });
  await page.waitForTimeout(1500);
  // All of Ireland on a phone is drawn from overview tiles; a bay needs native
  // ones, which nothing has read yet.
  published = newerHarmonie;
  deleted = true;
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect(page.locator(".frame-status")).toContainText(
    "Updated to the 16:00 UTC run",
    { timeout: 20000 },
  );
});

test("a tab coming back lands on now, unless the reader chose a later hour", async ({
  page,
}) => {
  await withTides(page);
  // An afternoon, so the hour the reader leaves can be overtaken by the clock.
  const afternoon = Date.parse("2026-09-14T09:00:00Z");
  await page.clock.install({ time: new Date(afternoon) });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  const strip = stripAt(afternoon);
  const opening = Number(await slider(page).inputValue());
  expect(strip[opening].time).toBeGreaterThanOrEqual(afternoon - 3600000);
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 10:00$/,
  );
  // The tab is left for six hours with the reader on the opening hour: the
  // hour has gone by, and coming back lands on now (15 UTC, 16:00 Irish).
  await page.clock.setSystemTime(new Date(afternoon + 6 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 1[5-7]:00$/,
  );
  // A time chosen ahead is the reader's own, and is kept.
  const later = Number(await slider(page).getAttribute("max")) - 3;
  await slider(page).fill(String(later));
  await page.clock.setSystemTime(new Date(afternoon + 8 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(slider(page)).toHaveValue(String(later));
});

test("a failed background check leaves the forecast alone and says nothing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let broken = false;
  await withTides(page);
  await page.route("**/weather/harmonie.json", (route) =>
    broken
      ? route.fulfill({ status: 503, body: "Gone" })
      : route.fulfill({ json: harmonie }),
  );
  await page.clock.install({ time: SAMPLE_CLOCK });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  const showing = (await slider(page).getAttribute("aria-valuetext"))!;
  broken = true;
  await page.clock.fastForward("05:01");
  await page.clock.fastForward("05:01");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(slider(page)).toHaveAttribute("aria-valuetext", showing);
  expect(errors).toEqual([]);
});

test("the strip runs fifteen days, the coarser far ones in narrower columns", async ({
  page,
}) => {
  await openDock(page);
  const dates = [...new Set(sampleStrip.map((c) => c.date))];
  expect(dates).toHaveLength(15);
  await expect(page.locator(".dock tr.tt-day td")).toHaveCount(15);
  await slider(page).press("End");
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`^\\w+ \\d{1,2} \\w+, \\d\\d:00$`),
  );
  const last = page.locator(
    `.dock tr.tt-hour td[data-i="${sampleStrip.length - 1}"]`,
  );
  await expect(last).toHaveClass(/c-sel/);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  const widths = await page
    .locator(".dock tr.tt-hour td[data-i]")
    .evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeLessThan(Math.max(...widths));
  expect(widths[0]).toBeCloseTo(Math.max(...widths), 0);
});

test("waves, sky, air, rain and sea are one tap away, and stay open", async ({
  page,
}) => {
  await openDock(page);
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(0);
  await page.getByRole("button", { name: "Show waves, sky and sea" }).click();
  for (const row of ["waves", "sky", "air", "rain", "sea"])
    await expect(page.locator(`.dock tr.tt-${row}`)).toHaveCount(1);
  // The sample's wave run is a short one: a few hours have a sea state.
  await expect
    .poll(() => page.locator(".dock tr.tt-waves .wave-cell b").count(), {
      timeout: 20000,
    })
    .toBeGreaterThan(0);
  await expect(
    page.locator(".dock tr.tt-waves .wave-cell b").first(),
  ).toHaveText(/^\d+\.\d$/);
  // The sample's weather run starts three days on: its hours, and dashes before.
  await expect
    .poll(() =>
      page.locator(".dock tr.tt-air td").filter({ hasText: /\d+°/ }).count(),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator(".dock tr.tt-sky .weather-cell").count())
    .toBeGreaterThan(0);
  // A total, a dash, or the dot of an hour inside a total printed further on.
  await expect(page.locator(".dock tr.tt-rain td[data-i]").first()).toHaveText(
    /^(–|·|\d+(\.\d)?)$/,
  );
  // The rows stay open across a reload, for the next spot chosen.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(1, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Hide waves, sky and sea" }).click();
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(0);
});

test("on a phone, the rows under the tide keep their units beside their glyphs", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?spot=brandon");
  await expect(page.locator(".dock tr.tt-wind")).toBeVisible({
    timeout: 30000,
  });
  await unfoldTools(page);
  await page.getByRole("button", { name: "Show waves, sky and sea" }).click();
  await expect(page.locator(".dock tr.tt-sea")).toHaveCount(1);
  // A bare 0.5, 12° or 0 says nothing: each figure's unit is on the screen,
  // the wind's under its glyph and the others' beside theirs (the sky's
  // glyphs need none).
  await expect(page.locator(".dk-labs .dk-lab-wind small")).toBeVisible();
  const units = page.locator(".dk-labs .dk-unit");
  await expect(units).toHaveText(["m", "°C", "mm", "°C"]);
  // Each within the label column, clear of its glyph and of the hours.
  const column = (await page.locator(".dk-labs").boundingBox())!;
  for (const unit of await units.all()) {
    await expect(unit).toBeVisible();
    const box = (await unit.boundingBox())!;
    const glyph = (await unit
      .locator("xpath=preceding-sibling::*[1]")
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(glyph.x + glyph.width);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
  }
});

/**
 * The coast's stations as the tide manifest publishes them: two Marine
 * Institute gauges on Dublin Bay, and Larne, 34 km from Lough Neagh's
 * shore at Antrim, inside the publisher's 40 km limit.
 */
const coastTides = {
  schemaVersion: 1,
  kind: "tide",
  maxDistanceKm: 40,
  stations: {
    Dublin_Port: {
      name: "Dublin Port",
      lat: 53.34574,
      lon: -6.22166,
      provider: "Marine Institute",
      url: "marine/tides-Dublin_Port-test.json",
    },
    Howth: {
      name: "Howth",
      lat: 53.39148,
      lon: -6.0683,
      provider: "Marine Institute",
      url: "marine/tides-Howth-test.json",
    },
    Larne_MODELLED: {
      name: "Larne",
      lat: 54.853,
      lon: -5.79,
      provider: "wingfoil.ie",
      modelled: true,
      url: "marine/tides-Larne-test.json",
    },
  },
  spots: {},
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};

/**
 * Choose the range ring round a chosen spot, before the page opens. The
 * loupe flies a spot in to fit its half-mile rose, three or four zooms
 * closer than `tapAt`'s two lights stand apart; the ring keeps the camera
 * where these taps were framed.
 */
const ringNotLoupe = (page: Page) =>
  page.addInitScript(() =>
    localStorage.setItem("wingfoil.map.focus.v1", "ring"),
  );

/**
 * Tap the chart at a place, from two riding places' lights round it: the
 * chart zoomed out until both are on it, and the place put on the screen
 * by Web Mercator from where their lights stand.
 */
async function tapAt(
  page: Page,
  [a, b]: [string, string],
  [lat, lon]: [number, number],
) {
  const canvas = page.locator(".maplibregl-canvas");
  const light = (id: string) =>
    page.locator(`.spot-marker[data-spot-id="${id}"]`);
  const onChart = () =>
    page.evaluate(
      ([a, b]) => {
        const chart = document
          .querySelector(".maplibregl-canvas")!
          .getBoundingClientRect();
        const foot = document.querySelector(".map-footer");
        const bottom = foot
          ? Math.min(chart.bottom, foot.getBoundingClientRect().top)
          : chart.bottom;
        return [a, b].every((id) => {
          const r = document
            .querySelector(`.spot-marker[data-spot-id="${id}"]`)!
            .getBoundingClientRect();
          return (
            r.left >= chart.left + 40 &&
            r.right <= chart.right - 40 &&
            r.top >= chart.top + 40 &&
            r.bottom <= bottom - 40
          );
        });
      },
      [a, b],
    );
  // The camera at rest: the light where it was, three looks running.
  const still = async () => {
    let last = "";
    let same = 0;
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await light(a).boundingBox());
          same = now === last ? same + 1 : 0;
          last = now;
          return same;
        },
        { intervals: [400], timeout: 20000 },
      )
      .toBeGreaterThanOrEqual(3);
  };
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (let i = 0; i < 6; i++) {
    await still();
    if (await onChart()) break;
    await zoomOut.click();
  }
  expect(await onChart()).toBe(true);
  // The water under the tap drawn.
  await steadyFrames(page);
  await page.waitForTimeout(1000);
  const merc = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const centre = async (id: string) => {
    const r = (await light(id).boundingBox())!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const [pa, pb] = [await centre(a), await centre(b)];
  const at = { a: SPOT_AT[a], b: SPOT_AT[b] };
  // Pixels per radian of longitude, which Mercator's y shares.
  const dx = ((at.b[1] - at.a[1]) * Math.PI) / 180;
  const dy = merc(at.b[0]) - merc(at.a[0]);
  const k = Math.hypot(pb.x - pa.x, pb.y - pa.y) / Math.hypot(dx, dy);
  const x = pa.x + k * (((lon - at.a[1]) * Math.PI) / 180);
  const y = pa.y - k * (merc(lat) - merc(at.a[0]));
  const box = (await canvas.boundingBox())!;
  // Nothing but the chart under the finger.
  expect(
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.tagName,
      [x, y],
    ),
  ).toBe("CANVAS");
  await canvas.click({ position: { x: x - box.x, y: y - box.y } });
}

/** Where those riding places are (public/riding-locations.json). */
const SPOT_AT: Record<string, [number, number]> = {
  dollymount: [53.367583, -6.144748],
  seapoint: [53.2973278, -6.1588509],
  "lough-neagh-antrim": [54.7161331, -6.2408518],
  "oxford-island": [54.489371, -6.3668812],
};

test("a point tapped on Dublin Bay reads its nearest station's tide; one on Lough Neagh has none", async ({
  page,
}) => {
  // Two pages opened and two points picked, each waiting on its tide: on a
  // shared CI runner it passed every step and ran out of the default time on
  // the last.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: coastTides }),
  );
  await page.route("**/marine/tides-*-test.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  await ringNotLoupe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?spot=dollymount");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount", {
    timeout: 30000,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);

  // Out on the bay, off Poolbeg: not a riding place, and no spot's tide link.
  await tapAt(page, ["dollymount", "seapoint"], [53.33, -6.1]);
  await expect(page.locator(".dock .dk-tools")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  const tide = page.locator(".dock .tide-row");
  await expect(tide).toHaveAttribute(
    "aria-label",
    /^Tide at (Dublin Port|Howth), \d+\.\d km away, metres above chart datum$/,
    { timeout: 15000 },
  );
  await expect(tide.locator(".tide-label").first()).toHaveText(
    /^\d\d:\d\d \d+\.\dm$/,
  );
  await expect(tide.locator(":scope > title")).toHaveText(
    /^Tide at (Dublin Port|Howth), \d+\.\d km away$/,
  );
  await expect(tide).not.toContainText("No tide station");

  // Lough Neagh: Larne is within the limit, but the sea does not reach it.
  await page.goto("/?spot=lough-neagh-antrim");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".dock .dk-name")).toHaveText(
    "Lough Neagh — Antrim",
    { timeout: 30000 },
  );
  await page.keyboard.press("Escape");
  await tapAt(page, ["lough-neagh-antrim", "oxford-island"], [54.6, -6.45]);
  await expect(page.locator(".dock .dk-tools")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  await expect(page.locator(".dock .tide-row .tide-none").first()).toHaveText(
    "No tide: a freshwater lake.",
    { timeout: 15000 },
  );
  // Said once, not all along the week.
  await expect(page.locator(".dock .tide-none")).toHaveCount(1);
  // And the dock closes from its own button, leaving the chart alone.
  await page
    .locator(".dock")
    .getByRole("button", { name: /^Close the forecast for / })
    .click();
  await expect(page.locator(".dock")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  // A step in the history like a choice: Back opens it again.
  await page.goBack();
  await expect(page.locator(".dock .tide-none")).toHaveText(
    "No tide: a freshwater lake.",
    { timeout: 15000 },
  );
  expect(errors).toEqual([]);
});

test("while the tide is fetched its row waits, and does not say there is none", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/marine/tides.json", async (route) => {
    await held;
    await route.fulfill({ json: tideManifest });
  });
  await page.route("**/marine/tides-Fenit-test.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  await page.goto("/?spot=brandon");
  const row = page.locator(".dock .tt-tide");
  await expect(row.locator(".tide-wait")).toBeVisible({ timeout: 30000 });
  await expect(row.locator("[aria-busy=true]")).toHaveCount(1);
  await expect(row.locator(".tide-none")).toHaveCount(0);
  release();
  await expect(row.locator(".tide-line").first()).toBeVisible();
  await expect(row.locator(".tide-wait")).toHaveCount(0);
  await expect(row.locator(".tide-none")).toHaveCount(0);
});

test("a point tapped off Dublin Bay reads wind, waves, weather and tide, and no blend", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: coastTides }),
  );
  await page.route("**/marine/tides-*-test.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  await ringNotLoupe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?spot=dollymount");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount", {
    timeout: 30000,
  });
  await page.keyboard.press("Escape");
  await tapAt(page, ["dollymount", "seapoint"], [53.33, -6.1]);
  const dock = page.locator(".dock");
  await expect(dock.locator(".dk-tools")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  // The wind, read from the map's frames at the point.
  await expect
    .poll(() => dock.locator("tr.tt-wind td .kn").count(), { timeout: 30000 })
    .toBeGreaterThan(5);
  // The tide, the nearest station's.
  await expect(dock.locator(".tide-row .tide-label").first()).toHaveText(
    /^\d\d:\d\d \d+\.\dm$/,
    { timeout: 15000 },
  );
  // The waves and the weather, a riding place's on the bay, said whose.
  await page.getByRole("button", { name: "Show waves, sky and sea" }).click();
  await expect(dock.locator(".dk-lent")).toHaveText(
    /^Waves, weather and sea from .+, \d+\.\d km$/,
  );
  await expect
    .poll(() => dock.locator("tr.tt-waves .wave-cell b").count(), {
      timeout: 20000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      dock.locator("tr.tt-air td").filter({ hasText: /\d+°/ }).count(),
    )
    .toBeGreaterThan(0);
  await expect(dock.locator("tr.tt-waves")).not.toContainText(
    "riding places only",
  );
  // No blend: every model's frames sampled at a point is megabytes.
  await expect(dock.getByRole("button", { name: "Blend" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the blend and the fold stay under the pointer from the first click, so every click is theirs, not the chart's", async ({
  page,
}) => {
  // The desktop the blend was found moving on (#91).
  await openDock(page, 1920, 1113);
  const dock = page.locator(".dock");
  const tools = dock.locator(".dk-tools");
  /** How far above the dock's top edge the tools stand. */
  const standing = async () => {
    const [t, d] = await Promise.all([tools.boundingBox(), dock.boundingBox()]);
    return d!.y - (t!.y + t!.height);
  };
  for (const [name, state] of [
    ["Blend", "aria-pressed"],
    [/waves, sky and sea/, "aria-expanded"],
  ] as const) {
    const button = tools.getByRole("button", { name });
    // Where it stands before the first click, which changes the dock's
    // height and once moved the tools with its top edge: three clicks there,
    // each of them the button's.
    const box = (await button.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const was = await button.getAttribute(state);
    const edge = await standing();
    for (let i = 1; i <= 3; i++) {
      await page.mouse.click(x, y);
      await expect(button).toHaveAttribute(
        state,
        i % 2 ? String(was !== "true") : String(was),
      );
      await expect
        .poll(async () => (await button.boundingBox())?.y)
        .toBeCloseTo(box.y, 0);
    }
    // No point was picked: the dock is still the spot's.
    await page.waitForTimeout(400);
    await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
    // Off the tools, they go back to the dock's top edge.
    await page.mouse.move(x - 600, y - 300);
    await expect.poll(standing).toBeCloseTo(edge, 0);
  }
});

test.describe("on a phone", () => {
  // The phone the blend was found moving on (#107), a finger and no mouse.
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });

  test("the blend stays under the finger from the first tap, so every tap is its, not the hours'", async ({
    page,
  }) => {
    await withTides(page);
    await page.goto("/?spot=malahide-estuary");
    const dock = page.locator(".dock");
    await expect(dock.locator("tr.tt-stars")).toBeVisible({ timeout: 30000 });
    const tools = dock.locator(".dk-tools");
    await unfoldTools(page);
    const standing = async () => {
      const [t, d] = await Promise.all([
        tools.boundingBox(),
        dock.boundingBox(),
      ]);
      return d!.y - (t!.y + t!.height);
    };
    const blend = tools.getByRole("button", { name: "Blend" });
    const box = (await blend.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const edge = await standing();
    const table = (await dock.boundingBox())!.height;
    for (let i = 1; i <= 3; i++) {
      await page.touchscreen.tap(x, y);
      await expect(blend).toHaveAttribute("aria-pressed", String(i % 2 === 1));
      await expect
        .poll(async () => (await blend.boundingBox())?.y)
        .toBeCloseTo(box.y, 0);
    }
    // The blend did grow the dock, under the tools rather than with them.
    await expect(dock.locator(".tt-blend")).toBeVisible();
    expect((await dock.boundingBox())!.height).toBeGreaterThan(table + 20);
    await page.waitForTimeout(400);
    await expect(
      page.getByRole("region", { name: "Forecast for Malahide Estuary" }),
    ).toBeVisible();
    // A tap anywhere else puts them back on the dock's top edge.
    const hours = (await dock.locator("tr.tt-day").boundingBox())!;
    await page.touchscreen.tap(hours.x + 40, hours.y + hours.height / 2);
    await expect.poll(standing).toBeCloseTo(edge, 0);
  });
});

test("on a phone's blend, a turn's time and height stay over the tide's dot where it passes them", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?spot=brandon");
  const dock = page.locator(".dock");
  await expect(dock.locator(".tide-label").first()).toBeVisible({
    timeout: 30000,
  });
  await unfoldTools(page);
  await dock.getByRole("button", { name: "Blend" }).click();
  await expect(dock.locator(".tt-blend")).toBeVisible();
  /**
   * Where the dot and a label meet, the points of the label's glyphs, and how
   * many of them the dot covers. The dot is made hit-testable for the asking,
   * as it is drawn (the pen's layers take no pointer).
   */
  const meeting = () =>
    page.evaluate(() => {
      const dot = document.querySelector<SVGCircleElement>(".dock .tide-dot");
      if (!dot) return null;
      const d = dot.getBoundingClientRect();
      const points: [number, number][] = [];
      for (const label of document.querySelectorAll(".dock .tide-label")) {
        const r = label.getBoundingClientRect();
        for (
          let x = Math.max(d.left, r.left);
          x < Math.min(d.right, r.right);
          x++
        )
          for (
            let y = Math.max(d.top, r.top);
            y < Math.min(d.bottom, r.bottom);
            y++
          )
            points.push([x + 0.5, y + 0.5]);
      }
      const at = ([x, y]: [number, number]) => document.elementFromPoint(x, y);
      dot.style.display = "none";
      const glyphs = points.filter((p) => at(p)?.closest(".tide-label"));
      dot.style.display = "";
      dot.style.pointerEvents = "auto";
      const covered = glyphs.filter((p) => at(p) === dot).length;
      dot.style.pointerEvents = "";
      return glyphs.length ? { glyphs: glyphs.length, covered } : null;
    });
  // Through the hours until the dot has passed over a few labels.
  const slider = page.getByRole("slider", { name: "Forecast time" });
  const last = Number(await slider.getAttribute("max"));
  const met: { glyphs: number; covered: number }[] = [];
  for (let at = 0; at <= last && met.length < 4; at++) {
    await slider.fill(String(at));
    const meets = await meeting();
    if (meets) met.push(meets);
  }
  expect(met.length).toBeGreaterThan(0);
  expect(met.map((m) => m.covered)).toEqual(met.map(() => 0));
});
