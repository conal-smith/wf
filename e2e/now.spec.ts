import {
  barPill,
  barReady,
  expect,
  test,
  timeSlider,
  type Page,
} from "./fixtures";
import { readSample } from "./sample";
import { stripAt } from "./columns";

const harmonie = readSample("harmonie");

/**
 * The hours already gone are drawn faint, the page opens on the hour now, and
 * a red line is ruled down the strip at the time now. Which hours are gone is
 * the clock's business, never the selection's.
 *
 * Read off the scrub bar's strip (src/ScrubBar.tsx), in its own pixels: the
 * faded past runs from the strip's left edge to now, the line stands at now,
 * and the playhead stands on the hour selected.
 */
const strip = (page: Page) => page.locator(".scrub .sb-strip");

/** Where the faded past ends, from the strip's left edge; null with none. */
const pastEnd = (page: Page) =>
  strip(page)
    .locator(".sb-past")
    .evaluateAll((rects) =>
      rects.length
        ? Number(rects[0].getAttribute("x")) +
          Number(rects[0].getAttribute("width"))
        : null,
    );

/** Where the now line is ruled. */
const nowAt = (page: Page) =>
  strip(page)
    .locator(".sb-now-line[data-now]")
    .evaluate((line) => Number(line.getAttribute("x1")));

/** Where the playhead stands. */
const headAt = (page: Page) =>
  strip(page)
    .locator(".sb-head")
    .evaluate((head) =>
      Number(head.getAttribute("transform")!.match(/translate\(([-\d.]+)/)![1]),
    );

/** The playhead on a column of the strip, and where it stands there. */
async function headOn(page: Page, at: number) {
  await timeSlider(page).fill(String(at));
  await expect(timeSlider(page)).toHaveValue(String(at));
  let x = NaN;
  await expect
    .poll(async () => {
      const was = x;
      x = await headAt(page);
      return x === was;
    })
    .toBe(true);
  return x;
}

test("the strip opens on now and fades the hours gone, whatever is selected", async ({
  page,
}) => {
  // An afternoon inside HARMONIE's run: 16:30 Irish time.
  const now = Date.parse(harmonie.runTime) + 2.5 * 3600000;
  await page.clock.setFixedTime(new Date(now));
  await page.goto("/?spot=brandon");
  await barReady(page);
  const columns = stripAt(now);
  const slider = timeSlider(page);
  const opening = Number(await slider.inputValue());
  expect(Math.abs(columns[opening].time - now)).toBeLessThanOrEqual(90 * 60000);
  // Faded from the strip's left edge to the line at now.
  const fadedToNow = async () => {
    await expect(strip(page).locator(".sb-past")).toHaveAttribute("x", "0");
    const end = (await pastEnd(page))!;
    expect(end).toBeGreaterThan(0);
    expect(Math.abs(end - (await nowAt(page)))).toBeLessThan(0.5);
    return end;
  };
  await fadedToNow();
  // Scrubbing moves the selection, not the past: on through the week, and
  // back to the strip's first hour, the past still ends at now. (The week
  // in view may slide as the playhead nears its edge; the past and the line
  // slide with it.)
  const later = columns.findIndex((c) => c.time >= now + 3 * 86400000);
  await headOn(page, later);
  await fadedToNow();
  await headOn(page, 0);
  const atStart = await fadedToNow();
  // The clock moving on fades more of them.
  await page.clock.setFixedTime(new Date(now + 2 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect
    .poll(async () => (await pastEnd(page))!)
    .toBeGreaterThan(atStart);
  await fadedToNow();
});

test("at night the strip opens on the hour now, a night column of its own", async ({
  page,
}) => {
  // 22:00 Irish time on the Sunday. The strip used to cut the night out and
  // open on Monday 07:00, with the selected line drawn there.
  const night = Date.parse(harmonie.runTime) + 8 * 3600000;
  // The dark is a place's: the night is hatched only with a spot open.
  await page.clock.setFixedTime(new Date(night));
  await page.goto("/?spot=brandon");
  const slider = timeSlider(page);
  await expect(slider).toHaveAttribute("aria-valuetext", "Sun 13 Sept, 22:00", {
    timeout: 30000,
  });
  await barReady(page);
  const at = await slider.inputValue();
  expect(stripAt(night)[Number(at)].time).toBe(night);
  // The pill reads the hour out, and that it is dark: no stars to give.
  const pill = barPill(page);
  await expect(pill).toContainText("Sun 13 22:00");
  await expect(pill).toContainText("dark");
  await expect(pill).not.toHaveAttribute("data-stars");
  // And the playhead stands in the night's hatching.
  const x = await headAt(page);
  const nights = await strip(page)
    .locator(".sb-night")
    .evaluateAll((rects) =>
      rects.map((r) => [
        Number(r.getAttribute("x")),
        Number(r.getAttribute("x")) + Number(r.getAttribute("width")),
      ]),
    );
  expect(nights.some(([from, to]) => from < x && x < to)).toBe(true);
});

test("a red line is ruled at the time now, between the hours, and writes nothing by it", async ({
  page,
}) => {
  // 16:30 Irish time: half way from 16's column to 17's.
  const now = Date.parse(harmonie.runTime) + 2.5 * 3600000;
  await page.clock.setFixedTime(new Date(now));
  await page.goto("/?spot=brandon");
  await barReady(page);
  const mark = strip(page).locator(".sb-now-line[data-now]");
  await expect(mark).toHaveCount(1);
  // A line, and no words: the days under the strip and the pill say the time.
  await expect(strip(page).locator("svg text")).toHaveCount(0);
  const columns = stripAt(now);
  const at = columns.findIndex((c) => c.time === now - 1800000);
  expect(columns[at].hour).toBe(16);
  expect(columns[at + 1].hour).toBe(17);
  // Half way from where the playhead stands at 16:00 to where it stands at
  // 17:00.
  const a = await headOn(page, at);
  const b = await headOn(page, at + 1);
  expect(b).toBeGreaterThan(a);
  expect(Math.abs((await nowAt(page)) - (a + b) / 2)).toBeLessThan(1);
  // It is the clock's, not the selection's: moving the hours leaves it be.
  await headOn(page, at + 6);
  expect(Math.abs((await nowAt(page)) - (a + b) / 2)).toBeLessThan(1);
  // And it goes on with the clock: to 18:30, past 17's hour.
  await page.clock.setFixedTime(new Date(now + 2 * 3600000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => nowAt(page)).toBeGreaterThan(b + (b - a));
  expect(Math.abs((await nowAt(page)) - (a + 2.5 * (b - a)))).toBeLessThan(1);
});
