import { expect, rememberSpot, test, type Page } from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { buildPyramid } from "../scripts/f5tile.mjs";
import { readFileSync } from "node:fs";
import { spotSquare } from "../force5/src/squares";

const harmonie = readSample("harmonie");

// A spot's dock: Brandon Bay's, as a visitor who chose it last sees it. A
// first visit opens on no spot (e2e/no-spot.spec.ts).
test.beforeEach(({ page }) => rememberSpot(page, "brandon"));

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

/** The chart and its dock, up, with the tide fixture. */
async function openDock(page: Page, width = 1440, height = 900) {
  await withTides(page);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
}

const slider = (page: Page) =>
  page.getByRole("slider", { name: "Forecast time" });

/** Where the selected column sits against the cursor, in pixels. */
async function offCursor(page: Page) {
  return page.evaluate(() => {
    const cell = document.querySelector(".dock tr.tt-hour td.c-sel");
    const cursor = document.querySelector(".dock .dk-cur");
    if (!cell || !cursor) return Infinity;
    const c = cell.getBoundingClientRect();
    return Math.abs(c.left + c.width / 2 - cursor.getBoundingClientRect().left);
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
  // The tide's turns are just their times on the curve; the turn and the
  // height in full are in its title.
  const tide = page.locator(".dock .tide-row");
  await expect(tide.locator(".tide-label").first()).toHaveText(/^\d\d:\d\d$/);
  await expect(tide.locator("g > title").first()).toHaveText(
    /^(High|Low) tide \d\d:\d\d · \d+\.\d m$/,
  );
  await expect(tide).not.toContainText(/\b(HW|LW)\b/);
  // The time is a slider still, for the keys and a screen reader, named
  // by its day and hour; on the screen it is the cursor over the hours.
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d\d:\d\d$/,
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
  // The time moving scrolls the strip: the hour sits under the cursor.
  await slider(page).fill("12");
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The strip scrolling moves the time, and the slider with it: whatever
  // comes to rest under the cursor is the hour.
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
  // before it, and the cursor comes out to the first hour instead.
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
  // and the red line stands on that column, not on the morning's.
  const small = sampleStrip.findIndex(
    (c) => c.date !== sampleStrip[0].date && c.hour === 3,
  );
  const cell = page.locator(`.dock tr.tt-wind td[data-i="${small}"]`);
  await expect(cell).toHaveClass(/\bnight\b/);
  await cell.click();
  await expect(slider(page)).toHaveValue(String(small));
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Monday 03:00");
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${small}"]`),
  ).toHaveClass(/\bc-sel\b/);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // The keys step through the night an hour at a time.
  await slider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Monday 04:00");
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

test("the head is the spot and its buttons, and no day is rated", async ({
  page,
}) => {
  await openDock(page);
  // No county, no compass, no line of the day's best, no small print, no
  // play: the star, the name, the view, the page and the rows.
  const head = page.locator(".dock .dk-head");
  await expect(head).toHaveText(/^Brandon Bay\s*Table\s*Blend\s*Spot page →$/);
  await expect(head.getByRole("img")).toHaveCount(0);
  await expect(
    head.getByRole("button", { name: "About these figures" }),
  ).toHaveCount(0);
  for (const name of ["Star Brandon Bay", "Show waves, sky and sea"])
    await expect(head.getByRole("button", { name })).toBeVisible();
  await expect(
    head.getByRole("button", { name: /Play forecast|Pause forecast/ }),
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
  await expect(
    page.getByRole("link", { name: "Spot page →" }).first(),
  ).toHaveAttribute("href", "/spot/brandon");
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
  await page
    .locator(".dock")
    .getByRole("button", { name: "Star Brandon Bay" })
    .click();
  await expect(
    page.locator(".dock").getByRole("button", { name: "Unstar Brandon Bay" }),
  ).toHaveAttribute("aria-pressed", "true");
  // A tap away, on the dock's star, closed it; the star opens it again.
  await expect(panel).toHaveCount(0);
  await yours.click();
  await expect(panel.locator(".fvl li").first()).toContainText("Brandon Bay");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wingfoil.spots.v1") ?? "{}"),
  );
  expect(stored.starred).toEqual(["brandon"]);
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
  await page.getByLabel("Close display options").click();
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
  await page.reload();
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

test("the display options open beside the map's controls, one panel at a time", async ({
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
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.keyboard.press("Tab");
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
  // One at a time: the layers take its place.
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Layers" })).toBeVisible();
  // A tap away, on the dock, shuts it; so does its own button, and Done.
  await trigger.click();
  await page.locator(".dock .dk-name").click();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await trigger.click();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await page.getByLabel("Close display options").click();
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the blend draws every model that covers the spot, on the strip's hours", async ({
  page,
}) => {
  await openDock(page);
  await page
    .locator(".dock")
    .getByRole("radio", { name: "Blend" })
    .or(page.locator(".dock").getByRole("button", { name: "Blend" }))
    .first()
    .click();
  const chart = page.locator(".dock .blend-chart");
  await expect(chart).toBeVisible();
  expect(await chart.locator(".model-line").count()).toBeGreaterThan(3);
  // The tide still runs under it, and the cursor over both. The chart's
  // label column is its unit and its scale, without a name.
  await expect(page.locator(".dock .tide-row")).toBeVisible();
  const scale = page.locator(".dock .dk-lab-blend");
  await expect(scale).toContainText("kn");
  await expect(scale.locator("b").first()).toHaveText(/^\d+$/);
  await expect(page.locator(".dk-labs")).not.toContainText(/Blend|Tide/);
  await page
    .locator(".dock")
    .getByRole("radio", { name: "Table" })
    .or(page.locator(".dock").getByRole("button", { name: "Table" }))
    .first()
    .click();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("the head's chevron is the dock's one fold: the rows under the tide", async ({
  page,
}) => {
  await openDock(page);
  const chevron = page
    .locator(".dock .dk-head")
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
    .locator(".dock .dk-head")
    .getByRole("button", { name: "Hide waves, sky and sea" });
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(1);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
  expect(await height()).toBeGreaterThan(before + 80);
  await open.click();
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(0);
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("on a phone the dock opens on the hours, with no handle to fold them", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".dock-grab")).toHaveCount(0);
  // The head and the always-there rows, and still under a third of the screen.
  expect(
    (await page.locator(".map-footer").boundingBox())!.height,
  ).toBeLessThan(844 / 3);
  await slider(page).fill("9");
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("an hour past the map's model offers the run that reaches it", async ({
  page,
}) => {
  await openDock(page);
  const chip = page.getByRole("button", { name: /Show ECMWF on the map/ });
  await expect(chip).toHaveCount(0);
  // The strip's last day: far past HARMONIE.
  const far = sampleStrip.length - 4;
  await slider(page).fill(String(far));
  await expect(chip).toBeVisible();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Layers", exact: true }).click();
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({
    timeout: 30000,
  });
  const strip = stripAt(afternoon);
  const opening = Number(await slider(page).inputValue());
  expect(strip[opening].time).toBeGreaterThanOrEqual(afternoon - 3600000);
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Monday 10:00");
  // The tab is left for six hours with the reader on the opening hour: the
  // hour has gone by, and coming back lands on now (15 UTC, 16:00 Irish).
  await page.clock.setSystemTime(new Date(afternoon + 6 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Monday 1[5-7]:00$/,
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
  await page.goto("/");
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
    new RegExp(`^\\w+ \\d\\d:00$`),
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
  await page.reload();
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(1, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Hide waves, sky and sea" }).click();
  await expect(page.locator(".dock tr.tt-waves")).toHaveCount(0);
});
