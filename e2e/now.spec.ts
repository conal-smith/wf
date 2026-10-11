import { expect, rememberSpot, test } from "./fixtures";
import { readSample } from "./sample";
import { stripAt } from "./columns";

const harmonie = readSample("harmonie");

/**
 * The strip has no Now line: the hours already gone are drawn faint, and the
 * page opens on the hour now. Which hours are gone is the clock's business,
 * never the selection's.
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

test("at night the strip opens on first light", async ({ page }) => {
  // 22:00 Irish time.
  const night = Date.parse(harmonie.runTime) + 8 * 3600000;
  await page.clock.setFixedTime(new Date(night));
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toHaveAttribute("aria-valuetext", /^\w+ 07:00$/, {
    timeout: 30000,
  });
});
