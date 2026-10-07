import { expect, test, type Page } from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { encodeFrame } from "../scripts/f5bin.mjs";

const harmonie = readSample("harmonie");

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
    Math.sign(height(i) - height(i - 1)) !== Math.sign(height(i + 1) - height(i)),
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
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
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

test("the week is one strip of hours, 07:00 to 20:00, under the day slider", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDock(page);
  const hours = page.locator(".dock tr.tt-hour td[data-i]");
  await expect(hours).toHaveCount(sampleStrip.length);
  expect(
    (await hours.allTextContents()).map((h) => Number(h)).every(
      (h) => h >= 7 && h <= 20,
    ),
  ).toBe(true);
  // Seven days, each a block of the slider and a heading on the strip.
  const days = new Set(sampleStrip.map((c) => c.date)).size;
  await expect(page.locator(".sc-day")).toHaveCount(days);
  // No spacer cells either side: the table starts against the labels.
  await expect(page.locator(".dock tr.tt-day td")).toHaveCount(days);
  // The rows, by their labels.
  await expect(page.locator(".dk-labs")).toContainText("Stars");
  for (const row of ["Wind", "From", "Wing", "Tide"])
    await expect(page.locator(".dk-labs")).toContainText(row);
  // Stars only where it is light; a dark hour is left empty, not rated zero.
  expect(
    await page.locator(".dock tr.tt-stars td[data-i] .star-tip").count(),
  ).toBeGreaterThan(0);
  expect(
    await page.locator(".dock tr.tt-stars td.night:not(:has(.star-tip))").count(),
  ).toBeGreaterThan(0);
  // Every hour reads its wind and gust, and where it blows from against the shore.
  await expect(page.locator(".dock tr.tt-wind td .kn").first()).toHaveText(/^\d+$/);
  await expect(
    page.locator(".dock tr.tt-from td .g-shore").first(),
  ).toHaveAttribute("aria-label", /shore|offshore|onshore/);
  // The tide's turns are named in words, never as HW and LW: a short label
  // on the row, the time and the height in full in the turn's title.
  const tide = page.locator(".dock .tide-row");
  await expect(tide.locator(".tide-label").first()).toHaveText(
    /^(High|Low) \d\d:\d\d$/,
  );
  await expect(tide.locator("g > title").first()).toHaveText(
    /^(High|Low) tide \d\d:\d\d · \d+\.\d m$/,
  );
  await expect(tide).not.toContainText(/\b(HW|LW)\b/);
  // The day slider's blocks carry each day's best, and the hand its hour.
  await expect(page.locator(".sc-hand .sc-flag")).toHaveText(
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d$/,
  );
  // Nothing on the page scrolls sideways; the strip carries the hours.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the strip and the slider move together, by swipe, wheel, drag and key", async ({
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
  // Shift and the wheel move the hours sideways.
  await wrap.hover();
  const before = await wrap.evaluate((el) => el.scrollLeft);
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, cw * 3);
  await page.keyboard.up("Shift");
  await expect
    .poll(() => wrap.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(before + cw);
  await expect
    .poll(async () => Number(await slider(page).inputValue()))
    .toBeGreaterThan(scrolled);
  // A plain vertical wheel is never taken: the strip stays where it is and the
  // event goes on to the page.
  const held = await wrap.evaluate((el) => el.scrollLeft);
  const prevented = await wrap.evaluate((el) => {
    const event = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(200);
  expect(await wrap.evaluate((el) => el.scrollLeft)).toBe(held);
  // Dragging along the day slider still works: the last day's block.
  const days = page.locator(".sc-day");
  const last = (await days.last().boundingBox())!;
  await page.mouse.move(last.x + 10, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 10, last.y + last.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await slider(page).inputValue()))
    .toBeGreaterThan(sampleStrip.length - 6);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  // And the keys: a day at a time with Page Up and Down.
  await slider(page).focus();
  await slider(page).press("Home");
  await expect(slider(page)).toHaveValue("0");
  // At the start the table sits against the labels, with no blank paper
  // before it, and the cursor comes out to the first hour instead.
  await expect.poll(() => wrap.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  await slider(page).press("PageUp");
  const day = sampleStrip.findIndex((c) => c.date !== sampleStrip[0].date);
  await expect(slider(page)).toHaveValue(String(day));
});

test("a tap on an hour selects it", async ({ page }) => {
  await openDock(page);
  const cell = page.locator('.dock tr.tt-wing td[data-i="6"]');
  await cell.click();
  await expect(slider(page)).toHaveValue("6");
});

test("the stars explain themselves on hover, and the ? leads to how they work", async ({
  page,
}) => {
  await openDock(page);
  const star = page.locator(".dock tr.tt-stars .star-tip").first();
  await star.scrollIntoViewIfNeeded();
  await star.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText(/kg (intermediate|learning|advanced)/);
  await expect(tip.getByRole("link", { name: "How?" })).toHaveAttribute(
    "href",
    "/stars",
  );
  await page.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  await expect(
    page.locator(".dock").getByRole("link", { name: "How the stars work" }),
  ).toHaveAttribute("href", "/stars");
});

test("the head says the day's best, and the pen loops each day's", async ({
  page,
}) => {
  await openDock(page);
  await expect(page.locator(".dk-best")).toHaveText(
    /^(Best (today|tomorrow|[A-Z][a-z]+day) \d\d:\d\d(–\d\d:\d\d)? · .*· [\d.]+ m² wing|[A-Z][a-z]+: (no stars|done))$/,
  );
  await expect(page.locator(".dk-best")).not.toContainText(/\b(HW|LW)\b/);
  const best = await page
    .locator(".dock tr.tt-day td i")
    .allTextContents();
  // A loop for each day whose best still ahead is worth riding: two stars or
  // more. A one-star day keeps its "best" in the heading and gets no loop.
  const loops = await page.locator(".dock .tt-pen .pen-loop").count();
  expect(loops).toBeLessThanOrEqual(best.length);
  await expect(
    page.getByRole("link", { name: "Spot page →" }).first(),
  ).toHaveAttribute("href", "/spot/brandon");
});

test("a starred spot is kept on this device: the dock, the popup and your spots agree", async ({
  page,
}) => {
  await openDock(page);
  const panel = page.getByRole("complementary", {
    name: "Your spots and the key",
  });
  await expect(panel).toContainText("Tap the red star");
  await page.locator(".dock").getByRole("button", { name: "Star Brandon Bay" }).click();
  await expect(
    page.locator(".dock").getByRole("button", { name: "Unstar Brandon Bay" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator(".fvl li").first()).toContainText("Brandon Bay");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wingfoil.spots.v1") ?? "{}"),
  );
  expect(stored.starred).toEqual(["brandon"]);
  // The popup's star is the same star.
  await page.getByRole("combobox", { name: "Find a spot" }).fill("Brandon");
  await page.locator(".spot-row").first().click();
  const popup = page.getByRole("dialog", { name: "Brandon Bay at a glance" });
  await expect(
    popup.getByRole("button", { name: "Unstar Brandon Bay" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Opening a spot counts it among the often opened; the count is in the
  // entry's title, not printed as a bare "1×".
  await page.getByRole("combobox", { name: "Find a spot" }).fill("Dollymount");
  await page.locator(".spot-row").first().click();
  await expect(panel).toContainText("Often opened");
  await expect(panel).toContainText("Dollymount");
  await expect(panel).not.toContainText("1×");
  await expect(
    panel.locator(".fvl li", { hasText: "Dollymount" }).locator(".fv-go span"),
  ).toHaveAttribute("title", /^Opened (once|\d+ times) on this device$/);
  await page.reload();
  await expect(panel.locator(".fvl li").first()).toContainText("Brandon Bay", {
    timeout: 30000,
  });
  // And unstarring from the panel takes it off.
  await panel.getByRole("button", { name: "Unstar Brandon Bay" }).click();
  await expect(panel).toContainText("Tap the red star");
  // The key is a tab away.
  await panel.getByRole("tab", { name: "Key" }).click();
  await expect(panel).toContainText("Depths in metres below chart datum");
});

test("units, the rider and the blend's models are display options, kept on reload", async ({
  page,
}) => {
  await openDock(page);
  const wing = () => page.locator(".dock tr.tt-wing td[data-i]").allTextContents();
  const before = await wing();
  await page.getByLabel("Display options", { exact: true }).click();
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
  await page.getByLabel("Display options", { exact: true }).click();
  await expect(page.locator('[data-units="m/s"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-skill="beginner"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('input[data-model-toggle="gfs"]')).not.toBeChecked();
});

test("the display options open and close from the keyboard", async ({ page }) => {
  await openDock(page);
  const trigger = page.getByLabel("Display options", { exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog.display-filter");
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document
        .querySelector("dialog.display-filter")!
        .contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("the blend draws every model that covers the spot, on the strip's hours", async ({
  page,
}) => {
  await openDock(page);
  await page.locator(".dock").getByRole("radio", { name: "Blend" }).or(
    page.locator(".dock").getByRole("button", { name: "Blend" }),
  ).first().click();
  const chart = page.locator(".dock .blend-chart");
  await expect(chart).toBeVisible();
  expect(await chart.locator(".model-line").count()).toBeGreaterThan(3);
  // The tide still runs under it, and the cursor over both.
  await expect(page.locator(".dock .tide-row")).toBeVisible();
  await page.locator(".dock").getByRole("radio", { name: "Table" }).or(
    page.locator(".dock").getByRole("button", { name: "Table" }),
  ).first().click();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("the hours fold away and come back", async ({ page }) => {
  await openDock(page);
  await page.getByRole("button", { name: "Fold the hours" }).click();
  await expect(page.locator(".dock tr.tt-stars")).toHaveCount(0);
  await expect(page.locator(".sc-day").first()).toBeVisible();
  await page.getByRole("button", { name: "Open the hours" }).click();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
});

test("on a phone the dock opens folded, and its handle opens the hours", async ({
  page,
}) => {
  await withTides(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".sc-day").first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".dock tr.tt-stars")).toHaveCount(0);
  await page.locator(".dock-grab").click();
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible();
  await slider(page).fill("9");
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
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
 * A newer HARMONIE run, 16 UTC to the bundled 13 UTC, with frames of its own:
 * a frame carries its run and hour and is checked against the manifest that
 * named it, which is what makes an atomic swap safe.
 */
const NEWER_RUN = "2026091316";
const NEWER_RUN_TIME = "2026-09-13T16:00:00Z";
const NEWER_RUN_DIR = `weather/harmonie-${NEWER_RUN}-24h-test`;
const newerValidTime = (hour: number) =>
  new Date(Date.parse(NEWER_RUN_TIME) + hour * 3600000).toISOString();
const newerFrames = Array.from({ length: 25 }, (_, hour) => ({
  hour,
  validTime: newerValidTime(hour),
  url: `${NEWER_RUN_DIR}/${String(hour).padStart(3, "0")}.bin`,
  gustIntervalHours: null,
}));
const newerHarmonie = {
  ...harmonie,
  run: NEWER_RUN,
  runTime: NEWER_RUN_TIME,
  generatedAt: NEWER_RUN_TIME,
  frames: newerFrames,
  spotForecasts: Object.fromEntries(
    Object.keys(harmonie.spotForecasts as Record<string, unknown>).map(
      (spot) => [
        spot,
        newerFrames.map((frame, column) => ({
          hour: frame.hour,
          validTime: frame.validTime,
          u: 6 + column * 0.2,
          v: -4,
          gust: null,
        })),
      ],
    ),
  ),
};
const CELLS = harmonie.grid.width * harmonie.grid.height;
const newerFrame = (hour: number) => ({
  model: "harmonie",
  run: NEWER_RUN,
  hour,
  validTime: newerValidTime(hour),
  grid: harmonie.grid,
  gustIntervalHours: null,
  u: Array.from({ length: CELLS }, () => 6),
  v: Array.from({ length: CELLS }, () => -4),
  gust: null,
});
async function withNewerRunFrames(page: Page) {
  await page.route(`**/${NEWER_RUN_DIR}/*`, (route) => {
    const hour = Number(
      /(\d+)\.bin$/.exec(new URL(route.request().url()).pathname)?.[1] ?? -1,
    );
    return route.fulfill({
      body: encodeFrame(newerFrame(hour)),
      contentType: "application/octet-stream",
    });
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
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({ timeout: 30000 });
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

test("a tab coming back lands on now, unless the reader chose a later hour", async ({
  page,
}) => {
  await withTides(page);
  // An afternoon, so the hour the reader leaves can be overtaken by the clock.
  const afternoon = Date.parse("2026-09-14T09:00:00Z");
  await page.clock.install({ time: new Date(afternoon) });
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({ timeout: 30000 });
  const strip = stripAt(afternoon);
  const opening = Number(await slider(page).inputValue());
  expect(strip[opening].time).toBeGreaterThanOrEqual(afternoon - 3600000);
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "Monday 10:00");
  // The tab is left for six hours with the reader on the opening hour: the
  // hour has gone by, and coming back lands on now (15 UTC, 16:00 Irish).
  await page.clock.setSystemTime(new Date(afternoon + 6 * 3600000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Monday 1[5-7]:00$/,
  );
  // A time chosen ahead is the reader's own, and is kept.
  const later = Number(await slider(page).getAttribute("max")) - 3;
  await slider(page).fill(String(later));
  await page.clock.setSystemTime(new Date(afternoon + 8 * 3600000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
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
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({ timeout: 30000 });
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
  await expect(page.locator(".sc-day")).toHaveCount(15);
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

test("play steps the cursor and the lights through the hours, and stops at a touch", async ({
  page,
}) => {
  await openDock(page);
  await slider(page).fill("2");
  const play = page.getByRole("button", { name: "Play forecast" });
  await play.click();
  await expect(
    page.getByRole("button", { name: "Pause forecast" }),
  ).toBeVisible();
  await expect
    .poll(async () => Number(await slider(page).inputValue()), {
      timeout: 8000,
    })
    .toBeGreaterThan(3);
  await expect.poll(() => offCursor(page)).toBeLessThan(2);
  const light = await page
    .locator('[data-spot-id="brandon"]')
    .getAttribute("aria-label");
  expect(light).toMatch(/\d\d:00/);
  // A touch anywhere takes the hours back.
  await page.locator(".dk-name").click();
  await expect(play).toBeVisible();
  const held = await slider(page).inputValue();
  await page.waitForTimeout(1500);
  await expect(slider(page)).toHaveValue(held);
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
  await expect(page.locator(".dock tr.tt-waves .wave-cell b").first()).toHaveText(
    /^\d+\.\d$/,
  );
  // The sample's weather run starts three days on: its hours, and dashes before.
  await expect
    .poll(() => page.locator(".dock tr.tt-air td").filter({ hasText: /\d+°/ }).count())
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
