import { expect, rememberSpot, test } from "./fixtures";
import { readSample } from "./sample";
import { stripAt } from "./columns";

const harmonie = readSample("harmonie");

/**
 * The hours already gone are drawn faint, the page opens on the hour now, and
 * the red pen rules a line down the strip at the time now, the time written
 * over it. Which hours are gone is the clock's business, never the
 * selection's.
 */
test("the strip opens on now and fades the hours gone, whatever is selected", async ({
  page,
}) => {
  // An afternoon inside HARMONIE's run: 16:30 Irish time.
  const now = Date.parse(harmonie.runTime) + 2.5 * 3600000;
  await page.clock.setFixedTime(new Date(now));
  await rememberSpot(page, "brandon");
  await page.goto("/");
  await expect(page.locator(".dock tr.tt-stars")).toBeVisible({ timeout: 30000 });
  const strip = stripAt(now);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  const opening = Number(await slider.inputValue());
  expect(Math.abs(strip[opening].time - now)).toBeLessThanOrEqual(90 * 60000);
  const past = () =>
    page
      .locator(".dock tr.tt-hour td.past")
      .evaluateAll((tds) => tds.map((td) => (td as HTMLElement).dataset.i));
  const gone = strip.filter((c) => c.time + 3600000 <= now).length;
  expect(await past()).toHaveLength(gone);
  // Scrubbing moves the selection, not the past.
  await slider.fill(String(strip.length - 2));
  expect(await past()).toHaveLength(gone);
  await slider.fill("0");
  expect(await past()).toHaveLength(gone);
  // The clock moving on fades more of them.
  await page.clock.setFixedTime(new Date(now + 2 * 3600000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await past()).length).toBeGreaterThan(gone);
});

test("at night the strip opens on the hour now, a night column of its own", async ({
  page,
}) => {
  // 22:00 Irish time on the Sunday. The strip used to cut the night out and
  // open on Monday 07:00, with the selected line drawn there.
  const night = Date.parse(harmonie.runTime) + 8 * 3600000;
  // The dark is a place's: the night is hatched only with a spot open.
  await rememberSpot(page, "brandon");
  await page.clock.setFixedTime(new Date(night));
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toHaveAttribute("aria-valuetext", "Sunday 22:00", {
    timeout: 30000,
  });
  const at = await slider.inputValue();
  expect(stripAt(night)[Number(at)].time).toBe(night);
  const hour = page.locator(`.dock tr.tt-hour td[data-i="${at}"]`);
  await expect(hour).toHaveText("22");
  await expect(hour).toHaveClass(/\bnight\b/);
  await expect(hour).toHaveClass(/\bc-sel\b/);
});

test("the pen rules a line at the time now, between the hours, and writes the time over it", async ({
  page,
}) => {
  // 16:30 Irish time: half way from 16's column to 17's.
  const now = Date.parse(harmonie.runTime) + 2.5 * 3600000;
  await page.clock.setFixedTime(new Date(now));
  await rememberSpot(page, "brandon");
  await page.goto("/");
  const mark = page.locator(".dock .tt-under");
  await expect(mark.locator(".pen-now-time")).toHaveText("16:30", {
    timeout: 30000,
  });
  const strip = stripAt(now);
  const lineAt = () =>
    mark
      .locator(".pen-now")
      .evaluate((p) => Number(p.getAttribute("d")!.match(/^M([\d.]+)/)![1]));
  const centre = (i: number) =>
    page
      .locator(`.dock tr.tt-hour td[data-i="${i}"]`)
      .evaluate((td: HTMLElement) => td.offsetLeft + td.offsetWidth / 2);
  const at = strip.findIndex((c) => c.time === now - 1800000);
  expect(strip[at].hour).toBe(16);
  const [a, b] = [await centre(at), await centre(at + 1)];
  expect(Math.abs((await lineAt()) - (a + b) / 2)).toBeLessThan(3);
  // It is the clock's, not the selection's: moving the hours leaves it be.
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.fill(String(at + 6));
  expect(Math.abs((await lineAt()) - (a + b) / 2)).toBeLessThan(3);
  // And it goes on with the clock.
  await page.clock.setFixedTime(new Date(now + 2 * 3600000));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(mark.locator(".pen-now-time")).toHaveText("18:30");
  expect(await lineAt()).toBeGreaterThan(b);
});
