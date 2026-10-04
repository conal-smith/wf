import { expect, test as base, type Page } from "@playwright/test";
import { SAMPLE_CLOCK } from "./columns";

/**
 * Every e2e test runs at `SAMPLE_CLOCK` unless it says otherwise.
 *
 * The site under test is served a calendar frozen in September 2026 (see
 * scripts/sample-weather.mjs), and almost everything the dock draws is a
 * statement about now: which runs have expired, which are stale, where the Now
 * line falls, and which column the scrubber opens on. A spec left on the wall
 * clock therefore asserts something different every day it is run, and in 2027
 * it asserts nothing at all — every run has expired and the page says so.
 *
 * Pinning it in a fixture rather than in each spec means a new spec is
 * time-independent by default: there is no line to forget. A test that needs
 * another moment simply calls `page.clock.setFixedTime` or `page.clock.install`
 * itself, which replaces this one — the clock replays its log in order, so the
 * last word wins.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(SAMPLE_CLOCK);
    await use(page);
  },
});

export { expect } from "@playwright/test";
export type { Locator, Page } from "@playwright/test";

/**
 * Wait until the page draws at frame rate: the longest of ten frames under
 * 50 ms. For a gesture that is judged on timing — a double-click inside the
 * map's single-click wait, a camera said to be at rest because two readings
 * a quarter-second apart agree — right after load, while the page is still
 * reading every model's manifest and placing every riding place's marker.
 */
export async function steadyFrames(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const times: number[] = [];
              const tick = (time: number) => {
                times.push(time);
                if (times.length < 11) requestAnimationFrame(tick);
                else
                  resolve(
                    Math.max(...times.slice(1).map((t, i) => t - times[i])),
                  );
              };
              requestAnimationFrame(tick);
            }),
        ),
      { timeout: 30000 },
    )
    .toBeLessThan(50);
}
