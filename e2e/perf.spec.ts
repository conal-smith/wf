import { chooseSpot, expect, test, type Page } from "./fixtures";

// The map as a rider has it once they choose a spot: every light rated on the
// whole of Ireland, then Brandon Bay's whole week in the dock, the most it
// draws (nothing opens a dock as the page loads).

/**
 * Performance budgets: what each page downloads, how often, and whether it
 * stands still while it loads.
 *
 * These are regression gates rather than measurements. The preview server
 * compresses nothing and the browser runs WebGL in software, so the numbers
 * here are not what a visitor sees (`scripts/perf-audit.mjs` measures that, in
 * real Chrome on a throttled network). What they catch is the change that
 * quietly undoes a win: the map pulled back into another section's bundle,
 * the map's model fetched twice or late, MapLibre folded back into the map's
 * own chunk, the page shifting as it fills in.
 */

/** Every response the page gets, with the bytes it carried. */
function record(page: Page) {
  const responses: { url: string; bytes: number; type: string }[] = [];
  page.on("response", async (response) => {
    const length = Number(response.headers()["content-length"] ?? NaN);
    const bytes = Number.isFinite(length)
      ? length
      : await response
          .body()
          .then((body) => body.length)
          .catch(() => 0);
    responses.push({
      url: response.url(),
      bytes,
      type: response.request().resourceType(),
    });
  });
  return responses;
}

const path = (url: string) => new URL(url).pathname;
/** Each file once: MapLibre starts its worker script once per worker. */
const scriptBytes = (responses: ReturnType<typeof record>) =>
  [
    ...new Map(
      responses
        .filter((r) => r.type === "script")
        .map((r) => [path(r.url), r.bytes]),
    ).values(),
  ].reduce((sum, bytes) => sum + bytes, 0);

async function mapReady(page: Page) {
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
}

// The stars page reads the forecast itself (spot/web), so only the others
// are held to asking for none of it.
for (const [section, route, readsForecast] of [
  ["marketplace", "/market", false],
  ["community", "/community", false],
  ["AI page", "/ai", false],
  ["stars page", "/stars", true],
] as const) {
  test(`the ${section} downloads none of the map`, async ({ page }) => {
    const responses = record(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const scripts = responses
      .filter((r) => r.type === "script")
      .map((r) => path(r.url));
    expect(scripts.length).toBeGreaterThan(0);
    // MapLibre is a megabyte of script, the map app a quarter more.
    expect(
      scripts.filter((s) => /\/(maplibre|App)-[^/]*\.js$/.test(s)),
    ).toEqual([]);
    // Nor does the page's head start the map's requests on its way past.
    if (!readsForecast)
      expect(
        responses
          .map((r) => path(r.url))
          .filter((p) => p === "/weather/harmonie.json" || p === "/spots.json"),
      ).toEqual([]);
  });
}

test("the map asks for its model and its places once each, early", async ({
  page,
}) => {
  const responses = record(page);
  // The map's chunk is held back: anything asked for while it is, the entry
  // asked for (force5/src/boot.ts), not the map once it had run.
  let held = true;
  const whileHeld: string[] = [];
  page.on("request", (request) => {
    if (held) whileHeld.push(path(request.url()));
  });
  await page.route(/\/assets\/App-[^/]*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    held = false;
    await route.continue();
  });
  await page.goto("/");
  await mapReady(page);
  expect(whileHeld).toContain("/weather/harmonie.json");
  expect(whileHeld).toContain("/spots.json");
  // And once each: the page used to read the manifest twice, once itself
  // and once through the model sweep.
  const count = (p: string) =>
    responses.filter((r) => path(r.url) === p).length;
  expect(count("/weather/harmonie.json")).toBe(1);
  expect(count("/spots.json")).toBe(1);
});

test("MapLibre and React are cached apart from the map's own code", async ({
  page,
}) => {
  const responses = record(page);
  await page.goto("/");
  await mapReady(page);
  const scripts = responses.filter((r) => r.type === "script");
  const named = (pattern: RegExp) =>
    scripts.filter((r) => pattern.test(path(r.url)));
  // Their own chunks, whose names do not change when the site does.
  expect(named(/\/assets\/maplibre-[^/]*\.js$/)).not.toHaveLength(0);
  expect(named(/\/assets\/react-[^/]*\.js$/)).not.toHaveLength(0);
  // So a deploy that changes the map re-sends a few hundred kilobytes, not
  // the 1.3 MB the map's chunk was with MapLibre inside it.
  const app = named(/\/assets\/App-[^/]*\.js$/);
  expect(app).toHaveLength(1);
  expect(app[0].bytes).toBeLessThan(450_000);
  // Uncompressed, as the preview serves it: MapLibre 1.03 MB and its worker
  // 0.51 MB, React 0.22 MB, the map 0.28 MB and some shared code. A new
  // dependency on the map has to argue for itself.
  expect(scriptBytes(responses)).toBeLessThan(2_400_000);
});

test("the map fills in without moving the page", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[])
        if (!entry.hadRecentInput)
          (window as unknown as { __cls: number }).__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("/");
  await mapReady(page);
  await page.waitForTimeout(2000);
  const cls = await page.evaluate(
    () => (window as unknown as { __cls: number }).__cls,
  );
  // 0.1 is the line between a good score and one that needs work.
  expect(cls).toBeLessThan(0.1);
});

test("stepping through the forecast answers within an interaction budget", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const worst = ((window as unknown as { __events: number[] }).__events = []);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        interactionId?: number;
      })[])
        if (entry.interactionId) worst.push(entry.duration);
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
  await page.goto("/");
  await mapReady(page);
  await page.waitForTimeout(1000);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const durations = await page.evaluate(
    () => (window as unknown as { __events: number[] }).__events,
  );
  expect(durations.length).toBeGreaterThan(0);
  // Generous, for a software-rendered map in a headless browser: the field
  // threshold for a good interaction is 200 ms on a real one.
  expect(Math.max(...durations)).toBeLessThan(500);
});
