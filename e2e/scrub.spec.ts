import {
  backToIreland,
  barName,
  barPill,
  barReady,
  chooseSpot,
  closeSettings,
  expect,
  menuRow,
  modelChoice,
  openFromMenu,
  saveSettings,
  scrubBar,
  settingsDialog,
  unitChoice,
  steadyFrames,
  test,
  timeSlider,
  type Page,
} from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { clock, dayShort } from "../src/strip";
import { buildPyramid } from "../scripts/f5tile.mjs";
import { readFileSync } from "node:fs";
import { spotSquare } from "../force5/src/squares";
import { dayNights } from "../force5/src/sun";

const harmonie = readSample("harmonie");

// The chart's scrub bar (src/ScrubBar.tsx): the slim bar along the map's
// foot that moves the chart's time. With a spot chosen, a tap on its light or
// named in the link, it draws that spot's week; with none, it is a plain
// timeline. The map opens on no spot (e2e/no-spot.spec.ts). What the dock's
// table used to hold, hour by hour, is on the spot's page (spot-page.spec.ts).

/**
 * A tide fixture, so the Tide curve is tested the same way whether or not
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

/** The chart, up, and Brandon Bay's week in the bar, chosen from it, with the tide fixture. */
async function openBar(page: Page, width = 1440, height = 900) {
  await withTides(page);
  await page.setViewportSize({ width, height });
  await page.goto("/?map");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await chooseSpot(page, "brandon");
  // The tap flies the chart to the spot: let it land before the hours are
  // timed against the frames.
  await steadyFrames(page);
}

/** The strip's column at a valid time; it must be one of them. */
const columnAt = (validTime: string) => {
  const at = sampleStrip.findIndex((c) => c.validTime === validTime);
  expect(at, `${validTime} is a column of the strip`).toBeGreaterThanOrEqual(0);
  return at;
};

/** The column the sample clock stands on: 22:00 on the Sunday, in the dark. */
const opening = () =>
  sampleStrip.findIndex((c) => c.time === SAMPLE_CLOCK.getTime());

/**
 * The moment the readings over the strip are for, as a time: "Sun 13 22:00" is
 * Irish summer time, to the nearest ten minutes. Every day of the sample's
 * strip is in September, so the day's number names it.
 */
async function pillTime(page: Page) {
  const words = (
    (await barPill(page).locator(".sb-time-words").textContent()) ?? ""
  ).trim();
  const [, day, hh, mm] = /^\w{3} (\d{1,2}) (\d\d):(\d\d)$/.exec(words) ?? [];
  const date = sampleStrip.find(
    (c) => Number(c.date.slice(8)) === Number(day),
  )?.date;
  expect(date, `"${words}" is a day of the strip`).toBeTruthy();
  return Date.parse(`${date}T${hh}:${mm}:00+01:00`);
}

/**
 * A press on the chart with no light and no box over it: with a spot or a
 * point chosen, it lets go of it, and the bar's forecast with it.
 */
async function tapOff(page: Page) {
  const at = await page.evaluate(() => {
    for (let y = 200; y < innerHeight - 260; y += 20)
      for (let x = 60; x < innerWidth - 120; x += 20)
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains("maplibregl-canvas")
        )
          return { x, y };
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
}

/** The slider's value, as a number. */
const sliderAt = async (page: Page) =>
  Number(await timeSlider(page).inputValue());

test("the scrub bar draws the spot's week: its wind and gusts, its stars, the night, now and the playhead", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBar(page);
  const bar = scrubBar(page);
  await expect(
    page.getByRole("region", { name: "Forecast for Brandon Bay" }),
  ).toBeVisible();
  await expect(bar).not.toHaveClass(/is-bare/);
  await expect(barName(page)).toHaveText("Brandon Bay");
  // The data alone (the owner's ruling of 2026-11-02): no name on the
  // screen, no close, no play or steps, no switch of what the strip shows,
  // no Now. The spot's name is beside it on the map; its page is a press on
  // that name, and for the keys a link out of sight until it has the focus.
  await expect(barName(page)).not.toBeInViewport();
  await expect(bar.getByRole("button")).toHaveCount(0);
  await expect(bar.getByRole("group")).toHaveCount(0);
  await expect(bar.locator("[data-spot-page-link]")).toHaveText(
    /^Full forecast/,
  );
  await expect(bar.locator("table, tr")).toHaveCount(0);
  // The strip: the wind as a fill with its line and the gusts over it, one
  // row of the stars as colour under it, a lane each for the waves and the
  // tide, the night hatched, the hours gone faded behind the line at now,
  // and the playhead.
  const strip = bar.locator(".sb-strip");
  const wind = strip.locator('[data-curve="wind"]');
  await expect(wind.locator(".sb-area")).toHaveCount(1);
  await expect(wind.locator(".sb-line")).toHaveCount(1);
  await expect(wind.locator(".sb-gust")).toHaveCount(1);
  // The row's track, and a stretch of stars or more on it.
  expect(await strip.locator(".sb-stars rect").count()).toBeGreaterThan(1);
  await expect(strip.locator("[data-lane]")).toHaveCount(2);
  await expect(strip.locator('[data-lane="waves"]')).toBeAttached();
  await expect(strip.locator('[data-lane="tide"] .sb-line')).toHaveCount(1);
  expect(await strip.locator(".sb-night").count()).toBeGreaterThan(0);
  await expect(strip.locator(".sb-past")).toHaveCount(1);
  await expect(strip.locator(".sb-now-line[data-now]")).toHaveCount(1);
  await expect(strip.locator(".sb-head")).toHaveCount(1);
  // A week of day names under it, the playhead's own marked.
  const days = strip.locator(".sb-days span");
  expect(await days.count()).toBeGreaterThanOrEqual(7);
  expect(await days.count()).toBeLessThanOrEqual(8);
  await expect(strip.locator(".sb-days span.is-on")).toHaveText("Sun 13");
  // The time is a slider still, out of sight, for the keys and a screen
  // reader: a step a column of the strip, named by its day and hour.
  const slider = timeSlider(page);
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
  await expect(slider).toHaveValue(String(opening()));
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    /^Sun \d{1,2} [A-Z][a-z]{2,3}, 22:00$/,
  );
  // The readings over the strip: the playhead's time, the wind (its gust
  // where the hour has one) and where it comes from, the stars, the waves
  // and the tide. 22:00 is after last light: no stars, and it says so.
  const pill = barPill(page);
  await expect(pill).toHaveText(
    /^Sun 13 22:00Wind\d+ kn(g\d+)?[NSEW]{1,3}StarsDarkWaves(–|\d+\.\d m)Tide\d+\.\d m[↑↓]$/,
  );
  await expect(pill).not.toHaveAttribute("data-stars");
  // The map's small print stands over the bar, not under it.
  const print = await page.locator(".map-print").boundingBox();
  if (print)
    expect(print.y + print.height).toBeLessThanOrEqual(
      (await bar.boundingBox())!.y + 1,
    );
  // Nothing on the page scrolls sideways.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("a drag across the strip moves the time smoothly, and the map's hour is the column nearest it", async ({
  page,
}) => {
  await openBar(page);
  const strip = scrubBar(page).locator(".sb-strip");
  const box = (await strip.boundingBox())!;
  const y = box.y + box.height / 2;
  // The middle of the week in view, clear of the edges it slides on at.
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect.poll(() => sliderAt(page)).not.toBe(opening());
  const pressed = await pillTime(page);
  // A drag of about a third of an hour: the playhead goes with the pointer,
  // between the hours, not from one hour to the next.
  const hour = box.width / (7 * 24);
  await page.mouse.move(x + hour / 3, y, { steps: 3 });
  await expect.poll(() => pillTime(page)).not.toBe(pressed);
  const moved = (await pillTime(page)) - pressed;
  expect(moved).toBeGreaterThan(0);
  expect(moved).toBeLessThan(3600000);
  await page.mouse.up();
  // The map's hour is the column nearest the playhead (the pill is to ten
  // minutes, so it may be that far either way).
  const at = await pillTime(page);
  const off = (i: number) => Math.abs(sampleStrip[i].time - at);
  const nearest = Math.min(...sampleStrip.map((_, i) => off(i)));
  expect(off(await sliderAt(page))).toBeLessThanOrEqual(nearest + 5 * 60000);
  // And a press further along takes the time there at once.
  const before = await sliderAt(page);
  await page.mouse.click(x + box.width / 4, y);
  await expect.poll(() => sliderAt(page)).toBeGreaterThan(before);
});

test("a wheel or a trackpad across the strip moves the playhead, and the week slides on under it", async ({
  page,
}) => {
  await openBar(page);
  const strip = scrubBar(page).locator(".sb-strip");
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const start = await pillTime(page);
  const days = scrubBar(page).locator(".sb-days span");
  const firstDay = await days.first().textContent();
  // A trackpad's sideways scroll of a few hours: the playhead goes with it,
  // between the hours, and the readout with it.
  const hour = box.width / (7 * 24);
  await page.mouse.wheel(hour * 3.5, 0);
  await expect.poll(() => pillTime(page)).not.toBe(start);
  const moved = (await pillTime(page)) - start;
  expect(moved).toBeGreaterThan(3 * 3600000 - 600000);
  expect(moved).toBeLessThan(4 * 3600000 + 600000);
  await expect.poll(() => sliderAt(page)).toBeGreaterThan(opening());
  // Back the other way: earlier.
  const back = await pillTime(page);
  await page.mouse.wheel(-hour * 2, 0);
  await expect.poll(() => pillTime(page)).toBeLessThan(back);
  // A mouse's wheel, up and down, moves it as well.
  const wheeled = await pillTime(page);
  await page.mouse.wheel(0, hour * 2);
  await expect.poll(() => pillTime(page)).toBeGreaterThan(wheeled);
  // Scrolled on and on, the playhead nears the edge and the week slides on
  // under it, the playhead staying in view.
  for (let i = 0; i < 12; i++) await page.mouse.wheel(box.width / 4, 0);
  await expect(days.first()).not.toHaveText(firstDay ?? "");
  const head = (await scrubBar(page).locator(".sb-head line").boundingBox())!;
  expect(head.x).toBeGreaterThanOrEqual(box.x);
  expect(head.x).toBeLessThanOrEqual(box.x + box.width + 1);
});

test("a finger swiped across the strip carries the playhead as far as it travels, and a tap takes the time there", async ({
  page,
}) => {
  await openBar(page);
  const strip = scrubBar(page).locator(".sb-strip");
  const box = (await strip.boundingBox())!;
  const hour = box.width / (7 * 24);
  const y = box.y + box.height / 2;
  /** A finger on the strip, from `from` to `to` in pixels. */
  const swipe = (from: number, to: number) =>
    strip.evaluate(
      (el, { from, to, y }) => {
        const touch = (type: string, x: number) =>
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 7,
              pointerType: "touch",
              isPrimary: true,
              button: type === "pointermove" ? -1 : 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: x,
              clientY: y,
            }),
          );
        touch("pointerdown", from);
        for (let i = 1; i <= 6; i++)
          touch("pointermove", from + ((to - from) * i) / 6);
        touch("pointerup", to);
      },
      { from, to, y },
    );
  const start = await pillTime(page);
  const slider = await sliderAt(page);
  // A swipe that starts far from the playhead does not take it to the
  // finger: it moves the playhead by the six hours the finger travelled.
  const far = box.x + box.width * 0.8;
  await swipe(far, far + hour * 6);
  await expect.poll(() => pillTime(page)).not.toBe(start);
  const moved = (await pillTime(page)) - start;
  expect(moved).toBeGreaterThan(5.5 * 3600000);
  expect(moved).toBeLessThan(6.5 * 3600000);
  expect(await sliderAt(page)).toBeLessThan(slider + 12);
  // Back the other way.
  const swiped = await pillTime(page);
  await swipe(far, far - hour * 3);
  await expect.poll(() => pillTime(page)).toBeLessThan(swiped);
  // A tap that does not travel takes the time where it lands.
  const before = await sliderAt(page);
  await swipe(box.x + box.width * 0.75, box.x + box.width * 0.75);
  await expect.poll(() => sliderAt(page)).toBeGreaterThan(before + 24);
});

test("the waves and the tide have lanes of their own under the wind, and none where nothing reaches", async ({
  page,
}) => {
  await openBar(page);
  const bar = scrubBar(page);
  const cell = (name: string) => barPill(page).locator(`[data-cell="${name}"]`);
  // The wind, its gusts dashed over it.
  await expect(
    bar.locator('.sb-strip [data-curve="wind"] .sb-gust'),
  ).toHaveCount(1);
  // The waves, from the wave models, read once the spot is chosen. The
  // sample's wave run covers a night midweek alone: there the cell reads a
  // height, and outside it no figure stands in for one.
  await expect(bar.locator('[data-lane="waves"] .sb-line')).toHaveCount(1, {
    timeout: 30000,
  });
  await expect(cell("waves")).toHaveText("Waves–");
  // Every cell keeps its place as the hour moves.
  const places = () =>
    barPill(page)
      .locator("[data-cell]")
      .evaluateAll((cells) =>
        cells.map((c) => {
          const r = c.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width)];
        }),
      );
  const before = await places();
  await timeSlider(page).fill(String(columnAt("2026-09-17T00:00:00Z")));
  await expect(cell("waves")).toHaveText(/^Waves\d+\.\d m$/);
  expect(await places()).toEqual(before);
  // The tide, Fenit's: a height and which way it is going.
  await expect(bar.locator('[data-lane="tide"] .sb-line')).toHaveCount(1);
  await expect(cell("tide")).toHaveText(/^Tide\d+\.\d m[↑↓]$/);
  // Dollymount has no tide station within reach: no lane, no cell.
  await chooseSpot(page, "dollymount");
  await expect(bar.locator('[data-lane="tide"]')).toHaveCount(0);
  await expect(cell("tide")).toHaveCount(0);
  await expect(bar.locator('[data-lane="waves"]')).toHaveCount(1);
});

test("a tap off the spot lets it go, leaving the plain timeline still moving the map, and Back opens it again", async ({
  page,
}) => {
  await openBar(page);
  await timeSlider(page).fill(String(opening() + 12));
  await tapOff(page);
  // No spot open: the bar stays, as the chart's timeline alone.
  await expect(barName(page)).toHaveCount(0);
  await expect(scrubBar(page)).toHaveClass(/is-bare/);
  await expect(
    page.getByRole("region", { name: "Forecast time, for the whole chart" }),
  ).toBeVisible();
  await expect(scrubBar(page)).not.toHaveAttribute("data-spot");
  await expect(scrubBar(page).locator("[data-spot-page-link]")).toHaveCount(0);
  await expect(
    scrubBar(page).locator("[data-curve], [data-lane], .sb-stars"),
  ).toHaveCount(0);
  await expect(barPill(page)).toContainText("Tap the map for a forecast");
  // Its time is the one the spot's week had, and it still moves.
  await expect(timeSlider(page)).toHaveValue(String(opening() + 12));
  await expect(scrubBar(page).locator(".sb-night").first()).toBeAttached();
  await timeSlider(page).fill(String(opening() + 13));
  await expect(timeSlider(page)).toHaveValue(String(opening() + 13));
  // A step in the history like the choice: Back opens it again.
  await page.goBack();
  await expect(page.locator('.scrub[data-spot="brandon"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(barName(page)).toHaveText("Brandon Bay");
});

test("the spot's name on the map opens its page at the hour in hand, and so does the keys' link", async ({
  page,
}) => {
  await openBar(page);
  const at = (i: number) =>
    `/spot/brandon?at=${encodeURIComponent(sampleStrip[i].validTime)}`;
  const later = columnAt("2026-09-15T12:00:00Z");
  await timeSlider(page).fill(String(later));
  // The link for the keys: out of sight until it has the focus.
  const link = scrubBar(page).locator("[data-spot-page-link]");
  await expect(link).toHaveAttribute("href", at(later));
  await link.focus();
  await expect(link).toBeInViewport();
  // The name beside the chosen light.
  const name = page.locator(
    '.spot-marker.sel[data-spot-id="brandon"] .lt-lab b',
  );
  await expect(name).toHaveText("Brandon Bay");
  await name.click();
  await expect(page).toHaveURL(
    new RegExp(
      `/spot/brandon\\?at=${encodeURIComponent(sampleStrip[later].validTime)}$`,
    ),
  );
});

test("a night hour is a column of its own: chosen, keyed, and read as dark", async ({
  page,
}) => {
  await openBar(page);
  // The sample clock stands at 22:00 on the Sunday, in the dark: the strip
  // opens on that hour, not on Monday's first light.
  expect(sampleStrip[opening()].hour).toBe(22);
  await expect(timeSlider(page)).toHaveValue(String(opening()));
  // The small hours of Monday: chosen, the slider says so, and the pill
  // reads that hour's wind with no stars, dark.
  const small = sampleStrip.findIndex(
    (c) => c.date !== sampleStrip[0].date && c.hour === 3,
  );
  await timeSlider(page).fill(String(small));
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 03:00$/,
  );
  await expect(barPill(page)).toHaveText(/^Mon 14 03:00.*\d+ kn.*StarsDark/);
  await expect(barPill(page)).not.toHaveAttribute("data-stars");
  // The keys step through the night an hour at a time.
  await timeSlider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 04:00$/,
  );
  await expect(barPill(page)).toHaveText(/^Mon 14 04:00/);
});

test("the keys step the slider by the hour, to either end, and a day at a time", async ({
  page,
}) => {
  await openBar(page);
  const slider = timeSlider(page);
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue(String(sampleStrip.length - 1));
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue(String(sampleStrip.length - 2));
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  // The same hour the next day, not as many columns into it: the first day
  // starts with the morning's three-hourly steps and the next is hourly.
  await slider.press("PageUp");
  const day = sampleStrip.findIndex(
    (c) => c.date !== sampleStrip[0].date && c.hour === sampleStrip[0].hour,
  );
  await expect(slider).toHaveValue(String(day));
  await slider.press("PageDown");
  await expect(slider).toHaveValue("0");
  // Shift with an arrow is a day too, wherever the focus is.
  await page.getByRole("button", { name: "Site menu" }).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(slider).toHaveValue(String(day));
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(slider).toHaveValue("0");
});

test("the strip runs fifteen days, a week in view, and slides on as the playhead nears its edge", async ({
  page,
}) => {
  await openBar(page);
  const dates = [...new Set(sampleStrip.map((c) => c.date))];
  expect(dates).toHaveLength(15);
  const days = scrubBar(page).locator(".sb-days span");
  const first = `${dayShort(sampleStrip[0].time)} ${Number(dates[0].slice(8))}`;
  const lastColumn = sampleStrip.at(-1)!;
  const last = `${dayShort(lastColumn.time)} ${Number(dates.at(-1)!.slice(8))}`;
  // The first week in view: the first day named, the last not.
  await expect(days.first()).toHaveText(first);
  await expect(days.filter({ hasText: last })).toHaveCount(0);
  await timeSlider(page).press("End");
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`^\\w+ \\d{1,2} \\w+, ${clock(lastColumn.time)}$`),
  );
  // The last week: the last day named, and the playhead's, and the first gone.
  await expect(days.last()).toHaveText(last);
  await expect(scrubBar(page).locator(".sb-days span.is-on")).toHaveText(last);
  await expect(days.filter({ hasText: new RegExp(`^${first}$`) })).toHaveCount(
    0,
  );
  // The playhead is in the strip, not past its end.
  const strip = (await scrubBar(page).locator(".sb-strip").boundingBox())!;
  const head = (await scrubBar(page).locator(".sb-head line").boundingBox())!;
  expect(head.x).toBeGreaterThanOrEqual(strip.x);
  expect(head.x).toBeLessThanOrEqual(strip.x + strip.width + 1);
});

test("the hours after dark can be left out, from last light to first, and stay so", async ({
  page,
}) => {
  await openBar(page);
  const slider = timeSlider(page);
  // Round the clock unless the reader says otherwise, the night hatched.
  await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
  await expect(scrubBar(page).locator(".sb-night").first()).toBeAttached();
  const days = scrubBar(page).locator(".sb-strip .sb-day");
  const dayLines = async () =>
    (await days.evaluateAll((lines) =>
      lines.map((line) => Number(line.getAttribute("x1"))),
    )) as number[];
  const roundTheClock = await dayLines();
  await openFromMenu(page, "Settings");
  const hours = page.getByRole("group", { name: "Hours", exact: true });
  await expect(
    hours.getByRole("button", { name: "Day and night" }),
  ).toHaveAttribute("aria-pressed", "true");
  await hours.getByRole("button", { name: "Daylight only" }).click();
  await expect(
    hours.getByRole("button", { name: "Daylight only" }),
  ).toHaveAttribute("aria-pressed", "true");
  await saveSettings(page);
  // Nothing on the strip is night: no hatching, and the days stand closer,
  // side by side, the line between them.
  await expect(scrubBar(page).locator(".sb-night")).toHaveCount(0);
  await expect
    .poll(async () => {
      const lines = await dayLines();
      return lines.length > 1 && roundTheClock.length > 1
        ? lines[1] - lines[0] < roundTheClock[1] - roundTheClock[0]
        : false;
    })
    .toBe(true);
  // Brandon's lit hours alone: from civil dawn to civil dusk, each day.
  const nights = dayNights(
    52.276,
    -10.024,
    new Date(sampleStrip[0].time),
    new Date(sampleStrip.at(-1)!.time + 86400000),
    { boundary: "civil" },
  );
  const lit = sampleStrip.filter(
    (c) =>
      !nights.some(
        (night) =>
          c.time >= night.from.getTime() && c.time < night.to.getTime(),
      ),
  );
  expect(lit.length).toBeLessThan(sampleStrip.length);
  // None of the small hours; the twilight after sunset stays.
  expect(lit.some((c) => c.hour < 5)).toBe(false);
  // The slider counts the lit hours alone.
  await expect(slider).toHaveAttribute("max", String(lit.length - 1));
  // The clock stands at 22:00 on the Sunday, after last light: the time
  // moves on to Monday's first light, and the map goes with it.
  const morning = lit.findIndex((c) => c.date !== sampleStrip[0].date);
  await expect(slider).toHaveValue(String(morning));
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`^Mon \\d{1,2} [A-Z][a-z]{2,3}, ${clock(lit[morning].time)}$`),
  );
  // A key back is Sunday's last light, not its night; and on again skips the
  // night to Monday's first.
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    new RegExp(
      `^Sun \\d{1,2} [A-Z][a-z]{2,3}, ${clock(lit[morning - 1].time)}$`,
    ),
  );
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute(
    "aria-valuetext",
    new RegExp(`^Mon \\d{1,2} [A-Z][a-z]{2,3}, ${clock(lit[morning].time)}$`),
  );
  // Kept on reload, for the next spot chosen.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(slider).toHaveAttribute("max", String(lit.length - 1), {
    timeout: 30000,
  });
  // And back round the clock.
  await openFromMenu(page, "Settings");
  await page
    .getByRole("group", { name: "Hours", exact: true })
    .getByRole("button", { name: "Day and night" })
    .click();
  await saveSettings(page);
  await expect(scrubBar(page).locator(".sb-night").first()).toBeAttached();
  await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
});

test("the arrow keys step the hour as the page opens, with nothing clicked, and only as pressed", async ({
  page,
}) => {
  await withTides(page);
  await page.goto("/?spot=brandon");
  await barReady(page);
  const start = await sliderAt(page);
  // Nothing has the focus: no hour has been chosen, nor the strip touched.
  expect(
    await page.evaluate(() => document.activeElement === document.body),
  ).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(timeSlider(page)).toHaveValue(String(start + 1));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(timeSlider(page)).toHaveValue(String(start + 2));
  // Nothing comes later: no glide left running is read back as hours.
  await page.waitForTimeout(1500);
  await expect(timeSlider(page)).toHaveValue(String(start + 2));
  // In the search field the keys move the caret, not the hour.
  const search = page.getByRole("combobox", { name: "Search spots" });
  await search.fill("keel");
  await search.press("ArrowLeft");
  await expect(timeSlider(page)).toHaveValue(String(start + 2));
});

test("the arrow keys run through the hours as fast as they come, with no page error", async ({
  page,
}) => {
  // A runner draws each hour in up to a second.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBar(page);
  const start = await sliderAt(page);
  // Faster than the hours can be drawn, as a key held down sends them: each
  // hour's render used to leave the map's hour queued behind it, and past
  // fifty React stopped the page with "Maximum update depth exceeded".
  const steps = 60;
  for (let i = 0; i < steps; i++) await page.keyboard.press("ArrowRight");
  await expect(timeSlider(page)).toHaveValue(String(start + steps));
  // The playhead and the pill are on the hour the keys came to.
  await expect(barPill(page)).toHaveText(
    new RegExp(
      `^${dayShort(sampleStrip[start + steps].time)} \\d{1,2} ${clock(sampleStrip[start + steps].time)}`,
    ),
  );
  expect(errors).toEqual([]);
});

test("units, the hours, the model and the spot page's blend are Settings', kept on reload", async ({
  page,
}) => {
  await openBar(page);
  await expect(barPill(page)).toContainText(/\d+ kn/);
  // One place for all of it: Settings, from the site menu.
  await openFromMenu(page, "Settings");
  const settings = settingsDialog(page);
  await expect(settings.locator(".st-h")).toHaveText([
    "Appearance",
    "About you",
    "Wind strength",
    "Wind direction",
    "Riding upwind",
    "Forecast",
  ]);
  await unitChoice(page, "m/s").click();
  const gfs = settings.locator('input[data-model-toggle="gfs"]');
  await expect(gfs).toBeEnabled({ timeout: 30000 });
  await gfs.uncheck();
  await saveSettings(page);
  // The readings give the wind in them.
  await expect(barPill(page)).toContainText("m/s");
  await expect(barPill(page)).not.toContainText(" kn");
  // Kept on reload; the spot, as on any visit, is chosen again.
  await page.reload();
  await chooseSpot(page, "brandon");
  await expect(barPill(page)).toContainText("m/s", { timeout: 30000 });
  await openFromMenu(page, "Settings");
  await expect(unitChoice(page, "m/s")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('input[data-model-toggle="gfs"]'),
  ).not.toBeChecked();
});

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

/**
 * Brandon's stars at the hour in hand, as the pill over the playhead has them
 * and as its light on the map has them: "pill/light", the light's empty
 * figure a nought. The pill names none where the hour is not rated.
 */
const pillAndLight = (page: Page) =>
  page.evaluate(() => {
    const pill =
      document
        .querySelector(".scrub [data-readout]")
        ?.getAttribute("data-stars") ?? "none";
    const light =
      document
        .querySelector('.spot-marker[data-spot-id="brandon"] .lt-n')
        ?.textContent?.trim() || "0";
    return `${pill}/${light}`;
  });

/** Whether the bar's stars for the hour in hand are Brandon's light's. */
const barAndLightAgree = async (page: Page) => {
  const [pill, light] = (await pillAndLight(page)).split("/");
  return pill !== "none" && pill === light;
};

/** Pick the rider's one model in Settings, and save. */
async function pickModel(page: Page, model: string) {
  await openFromMenu(page, "Settings");
  await settingsDialog(page)
    .getByRole("group", { name: "Model", exact: true })
    .getByRole("button", { name: model, exact: true })
    .click();
  await saveSettings(page);
}

test("the stars come from one model, the rider's: the bar's hour and the lights agree, and the map follows", async ({
  page,
}) => {
  // Out to the whole of Ireland twice, a step at a time, each step read once
  // the camera rests (backToIreland).
  test.slow();
  await openBar(page);
  // The whole of Ireland, with Brandon's week open: every light rated.
  await backToIreland(page);
  // No model chip in the bar: the rider's one model is set in Settings.
  await expect(scrubBar(page).locator("[data-stars-from-chip]")).toHaveCount(0);
  // A daylight hour of HARMONIE's, Monday's noon, where the lights have stars
  // to show: the pill's stars are Brandon's light's.
  const hour = columnAt("2026-09-14T11:00:00Z");
  expect(sampleStrip[hour].model).toBe("harmonie");
  await timeSlider(page).fill(String(hour));
  await expect(barPill(page)).toHaveAttribute("data-stars", /^[0-5]$/);
  await expect.poll(() => barAndLightAgree(page)).toBe(true);
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  const lightsBefore = await lightRatings(page);

  // GFS, the rider's model now. The sample's GFS run starts days later, so
  // that hour is ECMWF's now, the model that takes over: never HARMONIE's.
  await pickModel(page, "GFS");
  // The map follows at the same hour: every light rated again, from the
  // models' own spot squares, and Brandon's light is the bar's hour.
  await expect(timeSlider(page)).toHaveValue(String(hour));
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect
    .poll(() => lightRatings(page), { timeout: 30000 })
    .not.toEqual(lightsBefore);
  await expect
    .poll(() => barAndLightAgree(page), { timeout: 30000 })
    .toBe(true);
  // At an hour GFS reaches the map draws GFS's own wind: the model the
  // rider sees is the one the stars rate.
  const gfsHour = columnAt("2026-09-16T12:00:00Z");
  await timeSlider(page).fill(String(gfsHour));
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Wed 16 [A-Z][a-z]{2,3}, 13:00$/,
  );
  await expect(page.locator(".map-model")).toHaveText(/^GFS\b/, {
    timeout: 30000,
  });
  await expect
    .poll(() => barAndLightAgree(page), { timeout: 30000 })
    .toBe(true);

  // And back to the default puts the published blend's lights back as they
  // were.
  await pickModel(page, "HARMONIE");
  await backToIreland(page);
  await timeSlider(page).fill(String(hour));
  await expect
    .poll(() => lightRatings(page), { timeout: 30000 })
    .toEqual(lightsBefore);
  await expect.poll(() => barAndLightAgree(page)).toBe(true);
});

test("one model to pick and no fallback to set, and a blend of the rider's own that moves no star", async ({
  page,
}) => {
  await openBar(page);
  await backToIreland(page);
  await timeSlider(page).fill(String(columnAt("2026-09-14T11:00:00Z")));
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  const lightsBefore = await lightRatings(page);
  const starsBefore = await pillAndLight(page);
  await openFromMenu(page, "Settings");
  const panel = settingsDialog(page);
  // One choice: no "Stars from", nothing for when the run ends, no spot's own.
  await expect(panel).not.toContainText(/stars from/i);
  await expect(panel.getByRole("group", { name: /ends$/ })).toHaveCount(0);
  await expect(panel.getByRole("group", { name: /^Stars at/ })).toHaveCount(0);
  await expect(
    panel
      .getByRole("group", { name: "Model", exact: true })
      .getByRole("button"),
  ).toHaveText(["HARMONIE", "ICON-EU", "ECMWF", "GFS"]);
  // A blend of the rider's own (the spot page draws it): GFS and ICON-EU
  // left out.
  for (const id of ["gfs", "icon-eu"]) {
    const box = panel.locator(`[data-model-toggle="${id}"]`);
    await expect(box).toBeEnabled({ timeout: 30000 });
    await box.uncheck();
  }
  await saveSettings(page);
  // The lights are the stars, and the stars are HARMONIE's whatever the
  // blend: the lights and the bar's hour are as they were.
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0);
  expect(await lightRatings(page)).toEqual(lightsBefore);
  expect(await pillAndLight(page)).toBe(starsBefore);
});

test("Settings is the one place for how the forecast is shown: no display options on the chart or in the menu", async ({
  page,
}) => {
  await openBar(page);
  const trigger = page.getByRole("button", { name: "Site menu" });
  const settings = settingsDialog(page);
  // The map's controls are zoom and the layers, and nothing to set.
  const names = await page
    .locator(".zbox button")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(["Back to the list", "Zoom in", "Zoom out", "Layers"]);
  await expect(scrubBar(page).getByLabel("Display options")).toHaveCount(0);
  // From the keyboard: open, into it, and Escape hands focus back.
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menuRow(page, "Settings")).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "Site menu" })
      .getByText("Display options"),
  ).toHaveCount(0);
  // Past the chart and the spot finder.
  for (let i = 0; i < 2; i++) await page.keyboard.press("Tab");
  await expect(menuRow(page, "Settings")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(settings).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  // A modal: the focus is in it from the start, on the box itself and not
  // ringing its close button.
  await expect(settings).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("dialog[open]"),
    ),
  ).toBe(true);
  // Inside it the arrow keys are its own, not the chart's hour.
  const hour = await timeSlider(page).inputValue();
  await page.keyboard.press("ArrowRight");
  await expect(timeSlider(page)).toHaveValue(hour);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(barName(page)).toHaveText("Brandon Bay");
  // A press on the dimmed map round it shuts it, as its X does, and the
  // focus goes back to the menu's trigger.
  await openFromMenu(page, "Settings");
  await page.mouse.click(4, 400);
  await expect(settings).toHaveCount(0);
  await openFromMenu(page, "Settings");
  await closeSettings(page);
  await expect(trigger).toBeFocused();
});

/** The strip's first HARMONIE column, after today's ECMWF morning. */
const firstHarmonie = () =>
  sampleStrip.findIndex((column) => column.model === "harmonie");

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

test("an hour past the map's model hands the map to the run that reaches it", async ({
  page,
}) => {
  await openBar(page);
  const canvas = page.locator(".particle-canvas");
  const label = page.locator(".map-model");
  await expect(label).toHaveText("HARMONIE");
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  // The strip's last day: far past HARMONIE, inside ECMWF's run.
  const far = sampleStrip.length - 4;
  // An hour inside HARMONIE's run: today's morning before it is ECMWF's.
  const near = String(firstHarmonie() + 2);
  await timeSlider(page).fill(String(far));
  // The map draws ECMWF there, the run the strip's columns come from, and
  // says so where it names its model: from ECMWF's first hour past
  // HARMONIE's last. Today's morning before HARMONIE's run is ECMWF's too
  // (the ruling of 25 October 2026).
  const seam =
    sampleStrip[
      sampleStrip.findLastIndex((column) => column.model === "harmonie") + 1
    ];
  const from = `${dayShort(seam.time)} ${clock(seam.time)}`;
  // The sample's ECMWF run is more than eighteen hours old at the sample
  // clock, and the label says so of whichever run it is drawing.
  const handedOver = new RegExp(
    `^ECMWF on the map from ${from}( · older run)?$`,
  );
  await expect(label).toHaveText(handedOver, { timeout: 20000 });
  await expect(label).toHaveAttribute("data-reach", "handover");
  await expect(canvas).not.toHaveClass(/is-blank/);
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  // Nothing to ask for: the bar's chip that offers ECMWF is not needed.
  await expect(
    page.getByRole("button", { name: /Show ECMWF on the map/ }),
  ).toHaveCount(0);
  await expect(scrubBar(page).locator(".map-reach")).toHaveCount(0);
  // The reader's choice is still HARMONIE.
  await openFromMenu(page, "Settings");
  await expect(modelChoice(page, "harmonie")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await closeSettings(page);
  // Back and forth across the seam: both runs are in hand, so no manifest is
  // read again, and the map is HARMONIE's within its hours.
  const manifests: string[] = [];
  page.on("request", (request) => {
    if (/\/weather\/(harmonie|ecmwf)\.json/.test(request.url()))
      manifests.push(request.url());
  });
  await timeSlider(page).fill(near);
  await expect(label).toHaveText("HARMONIE");
  await expect(canvas).not.toHaveClass(/is-blank/);
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  await timeSlider(page).fill(String(far));
  await expect(label).toHaveText(handedOver);
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  await timeSlider(page).fill(near);
  await expect(label).toHaveText("HARMONIE");
  await timeSlider(page).fill(String(far));
  await expect(label).toHaveText(handedOver);
  expect(manifests).toEqual([]);
  // With the spot closed, the bar a plain timeline, the hand-over stands: it
  // comes from the runs on offer, not from the spot.
  await tapOff(page);
  await expect(barName(page)).toHaveCount(0);
  await expect(scrubBar(page)).toHaveClass(/is-bare/);
  await expect(timeSlider(page)).toHaveValue(String(far));
  await expect(label).toHaveText(handedOver);
  await expect(canvas).not.toHaveClass(/is-blank/);
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
});

test("an hour no run the map can draw reaches draws no wind, and says why", async ({
  page,
}) => {
  // ECMWF cannot be read: the strip's long range still names it (from the
  // published blend), but there is nothing to hand the map over to.
  await page.route("**/weather/ecmwf.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await openBar(page);
  const canvas = page.locator(".particle-canvas");
  const label = page.locator(".map-model");
  await expect.poll(() => inked(page), { timeout: 20000 }).toBeGreaterThan(0);
  await timeSlider(page).fill(String(sampleStrip.length - 4));
  // Never HARMONIE's last frame standing in for the hour.
  await expect(canvas).toHaveClass(/is-blank/, { timeout: 20000 });
  await expect(label).toHaveText(
    /^HARMONIE ends \w{3} \d\d:\d\d · no wind drawn$/,
  );
  await expect(label).toHaveAttribute("data-reach", "beyond");
  await expect.poll(() => inked(page), { timeout: 5000 }).toBe(0);
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
  await barReady(page);
  // An hour ahead: one the clock has already overtaken would go back to now.
  const ahead =
    sampleStrip.findIndex((c) => c.time > SAMPLE_CLOCK.getTime()) + 3;
  await timeSlider(page).fill(String(ahead));
  await expect(timeSlider(page)).toHaveValue(String(ahead));
  const showing = (await timeSlider(page).getAttribute("aria-valuetext"))!;
  published = newerHarmonie;
  // A check that comes due with the slider under the reader's hand is put off.
  await timeSlider(page).focus();
  await page.clock.fastForward("05:01");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  // Hands off, and a minute later the deferred check goes through.
  await page.getByRole("button", { name: "Site menu" }).focus();
  await page.clock.fastForward("01:00");
  await expect(page.locator(".frame-status")).toContainText(
    "Updated to the 16:00 UTC run",
    { timeout: 20000 },
  );
  // The reader keeps the hour they were reading, and the spot's week.
  await expect(timeSlider(page)).toHaveAttribute("aria-valuetext", showing);
  await expect(barName(page)).toHaveText("Brandon Bay");
  await barReady(page);
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
  await barReady(page);
  // The flight in to the spot over first: chosen on the way, the hour's tiles
  // were read for the wider view the camera passed through, the next bay's
  // among them.
  await expect(page.locator(".map-lights")).toHaveCount(1, { timeout: 30000 });
  await expect
    .poll(
      async () => {
        await page.waitForTimeout(300);
        return page.locator(".map-lights.is-moving").count();
      },
      { timeout: 15000 },
    )
    .toBe(0);
  // An hour of the reader's own, so nothing but the map's view asks for tiles.
  const ahead =
    sampleStrip.findIndex((c) => c.time > SAMPLE_CLOCK.getTime()) + 3;
  await timeSlider(page).fill(String(ahead));
  await expect(timeSlider(page)).toHaveValue(String(ahead));
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
  await barReady(page);
  const strip = stripAt(afternoon);
  const start = await sliderAt(page);
  expect(strip[start].time).toBeGreaterThanOrEqual(afternoon - 3600000);
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 10:00$/,
  );
  // The tab is left for six hours with the reader on the opening hour: the
  // hour has gone by, and coming back lands on now (15 UTC, 16:00 Irish).
  await page.clock.setSystemTime(new Date(afternoon + 6 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(timeSlider(page)).toHaveAttribute(
    "aria-valuetext",
    /^Mon \d{1,2} [A-Z][a-z]{2,3}, 1[5-7]:00$/,
  );
  // The playhead goes with it: the pill reads the hour landed on.
  await expect(barPill(page)).toHaveText(/^Mon 14 1[5-7]:00/);
  // A time chosen ahead is the reader's own, and is kept.
  const later = Number(await timeSlider(page).getAttribute("max")) - 3;
  await timeSlider(page).fill(String(later));
  await page.clock.setSystemTime(new Date(afternoon + 8 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(timeSlider(page)).toHaveValue(String(later));
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
  await barReady(page);
  const showing = (await timeSlider(page).getAttribute("aria-valuetext"))!;
  broken = true;
  await page.clock.fastForward("05:01");
  await page.clock.fastForward("05:01");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(timeSlider(page)).toHaveAttribute("aria-valuetext", showing);
  await barReady(page);
  expect(errors).toEqual([]);
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
};

/** A point's coordinates as the bar writes them. */
const COORDS = /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/;

test("a point tapped off Dublin Bay reads its wind and its nearest station's tide in the bar, with no stars", async ({
  page,
}) => {
  // A tap, then two runs' frames read at the point one file at a time: on a
  // shared CI runner that can outlast the default time.
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
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(barName(page)).toHaveText("Dollymount", { timeout: 30000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  // And let go of: a tap with a spot chosen would only let go of it.
  await page.keyboard.press("Escape");
  await expect(barName(page)).toHaveCount(0);
  // Out on the bay, off Poolbeg: not a riding place.
  await tapAt(page, ["dollymount", "seapoint"], [53.33, -6.1]);
  const bar = scrubBar(page);
  // Its coordinates, for a screen reader, and its name beside its mark.
  await expect(bar.locator(".sb-coords")).toContainText(COORDS);
  await expect(page.locator(".pick-mark .pick-lab")).toBeVisible();
  await expect(bar).not.toHaveAttribute("data-spot");
  await barReady(page);
  // The wind, read from the map's frames at the point, and no stars: a point
  // is not rated, so the strip has no row of them and the pill names none.
  await expect(bar.locator('.sb-strip [data-curve="wind"]')).toHaveCount(1);
  await expect(bar.locator(".sb-stars")).toHaveCount(0);
  await expect(barPill(page)).toContainText(/\d+ kn/);
  await expect(barPill(page)).not.toHaveAttribute("data-stars");
  await expect(barPill(page).locator('[data-cell="stars"]')).toHaveCount(0);
  // The strip's columns past HARMONIE's run are ECMWF's, as a spot's are.
  // The point used to read the map's own run alone, and left every one of
  // them empty. An hour far past HARMONIE has its wind, under the map's
  // hand-over.
  const far = sampleStrip.flatMap((column, at) =>
    column.model === "ecmwf" ? [at] : [],
  );
  expect(far.length).toBeGreaterThan(10);
  const farHour = far[far.length - 4];
  await timeSlider(page).fill(String(farHour));
  await expect(page.locator(".map-model")).toHaveText(
    /^ECMWF on the map from \w{3} \d\d:\d\d( · older run)?$/,
  );
  await expect(barPill(page)).toContainText(/\d+ kn/, { timeout: 45000 });
  // And within HARMONIE's run, HARMONIE's wind is read as before.
  await timeSlider(page).fill(String(firstHarmonie() + 2));
  await expect(barPill(page)).toContainText(/\d+ kn/, { timeout: 30000 });
  // The tide, the nearest station's, in a lane of its own.
  await expect(bar.locator('[data-lane="tide"] .sb-line')).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(barPill(page).locator('[data-cell="tide"]')).toHaveText(
    /^Tide\d+\.\d m[↑↓]$/,
  );
  // Its page is the point's own, at the hour in hand.
  await timeSlider(page).fill(String(farHour));
  await expect(bar.locator("[data-spot-page-link]")).toHaveAttribute(
    "href",
    new RegExp(
      `^/spot/@53\\.3\\d{3},-6\\.[01]\\d{3}\\?at=${encodeURIComponent(sampleStrip[farHour].validTime)}$`,
    ),
  );
  // And a tap off it lets it go, leaving the chart alone.
  await tapOff(page);
  await expect(barName(page)).toHaveCount(0);
  await expect(bar).toHaveClass(/is-bare/);
  await expect(page).toHaveURL(/\/\?map$/);
  // A step in the history like a choice: Back opens it again.
  await page.goBack();
  await expect(bar.locator(".sb-coords")).toContainText(COORDS, {
    timeout: 15000,
  });
  expect(errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("at 390px nothing in the bar runs off the screen, and the day names never overlap", async ({
    page,
  }) => {
    await withTides(page);
    await page.goto("/?spot=broadmeadows-south");
    await barReady(page);
    await expect(barName(page)).toHaveText(
      "Broadmeadows Estuary — south shore",
    );
    const days = scrubBar(page).locator(".sb-days span");
    await expect(days.first()).toBeVisible();
    /**
     * Whatever in the bar is wider than the window or past its edges, by its
     * class; the strip's drawing is clipped to the strip, so only the strip's
     * own box counts.
     */
    const overflowing = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".scrub, .scrub *")]
          .filter((el) => !el.closest("svg") || el.tagName === "svg")
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.left < -0.5 || r.right > innerWidth + 0.5);
          })
          .map((el) => `${el.tagName}.${el.className}`),
      );
    /** Day names that run into the next one. */
    const overlapping = () =>
      days.evaluateAll((spans) => {
        const boxes = spans
          .map((span) => span.getBoundingClientRect())
          .sort((a, b) => a.left - b.left);
        return boxes.filter((box, i) => i > 0 && box.left < boxes[i - 1].right)
          .length;
      });
    expect(await overflowing()).toEqual([]);
    expect(await overlapping()).toBe(0);
    // And with the playhead at either end of the strip.
    for (const key of ["End", "Home"]) {
      await timeSlider(page).press(key);
      await expect(days.first()).toBeVisible();
      expect(await overflowing()).toEqual([]);
      expect(await overlapping()).toBe(0);
    }
    // Nothing on the page scrolls sideways.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
