import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip } from "./columns";

/**
 * The Sentinel-2 intertidal heights draw over the foil layer in the Malahide
 * estuary, from the committed offline set (public-data/intertidal/v…, which
 * the e2e site serves in place of the national index: scripts/e2e-site.mjs),
 * under a routed Howth tide; and on the chart of all Ireland nothing of them
 * is fetched, not even the index.
 *
 * As e2e/foil-depth.spec.ts does, nothing here knows the colours: the estuary
 * at low water is photographed with the heights and with their index gone
 * (the foil archives alone), and the two must differ.
 */

const HOUR = 3600000;
const clock = SAMPLE_CLOCK.getTime();
const STEP_MINUTES = 30;
const FROM = clock - 24 * HOUR;
const SAMPLES = 8 * 48 + 1;
/** A plain semidiurnal tide at Howth, 0.5 m to 4.3 m above LAT. */
const height = (time: number) =>
  2.4 + 1.9 * Math.sin(((time - FROM) / HOUR) * ((2 * Math.PI) / 12.42));
const tideCurve = {
  stepMinutes: STEP_MINUTES,
  from: new Date(FROM).toISOString(),
  to: new Date(FROM + (SAMPLES - 1) * STEP_MINUTES * 60000).toISOString(),
  datum: "LAT",
  curve: Array.from({ length: SAMPLES }, (_, i) =>
    height(FROM + i * STEP_MINUTES * 60000),
  ),
  events: [],
};
const tideManifest = {
  schemaVersion: 1,
  kind: "tide",
  stations: {
    Howth: {
      name: "Howth",
      lat: 53.39,
      lon: -6.07,
      url: "marine/tides-Howth-foil.json",
    },
  },
  spots: { kilcrea: { station: "Howth", distanceKm: 9.8 } },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};

/** The lowest water among the strip's first day of hours. */
const low = sampleStrip
  .slice(0, 24)
  .map((c, i) => ({ i, t: height(c.time) }))
  .reduce((a, b) => (b.t < a.t ? b : a));

const ARCHIVE = /\/(intertidal|foildepth|bathy)\/v[0-9a-f]+\/[^/]+\.pmtiles$/;
const HEIGHTS = /^\/intertidal\//;

/** Archive reads still on their way, per page. */
const inFlight = new WeakMap<Page, Set<unknown>>();

/** Every read of the heights (their index and archives), by path, with its statuses. */
async function open(page: Page, path: string, withHeights = true) {
  const pending = new Set<unknown>();
  inFlight.set(page, pending);
  page.on("request", (r) => {
    if (ARCHIVE.test(new URL(r.url()).pathname)) pending.add(r);
  });
  for (const done of ["requestfinished", "requestfailed"] as const)
    page.on(done, (r) => pending.delete(r));
  const reads = new Map<string, number[]>();
  page.on("response", (response) => {
    const p = new URL(response.url()).pathname;
    if (HEIGHTS.test(p)) reads.set(p, [...(reads.get(p) ?? []), response.status()]);
  });
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-*-foil.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  if (!withHeights)
    await page.route("**/intertidal/index.json", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
  await expect(page.locator(".spot-marker").first()).toBeAttached({
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 30000 });
  return reads;
}

/** The estuary, zoomed in, at low water: as the foil spec frames it. */
async function frame(page: Page) {
  await page.addStyleTag({
    content:
      ".particle-canvas, .spot-marker, .map-pen, .pick-mark { visibility: hidden !important; }",
  });
  await page.keyboard.press("Escape"); // the focus's paper, off the estuary
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.fill(String(low.i));
  await expect(slider).toHaveValue(String(low.i));
}

/** The chart, once nothing is on its way and three looks half a second apart agree. */
async function photograph(page: Page) {
  const map = (await page.locator(".maplibregl-canvas").boundingBox())!;
  const dock = (await page.locator(".map-footer").boundingBox())!;
  const clip = {
    x: map.x + 80,
    y: map.y + 100,
    width: map.width - 200,
    height: dock.y - map.y - 140,
  };
  const pending = inFlight.get(page)!;
  let last = await page.screenshot({ clip });
  let same = 0;
  for (let i = 0; i < 60 && same < 2; i++) {
    await page.waitForTimeout(500);
    const next = await page.screenshot({ clip });
    same = next.equals(last) && pending.size === 0 ? same + 1 : 0;
    last = next;
  }
  expect(same, "the chart never settled").toBe(2);
  return last;
}

/** The share of pixels two photographs disagree on by more than `by` in a channel. */
async function differs(page: Page, a: Buffer, b: Buffer, by = 20) {
  return page.evaluate(
    async ([a, b, by]) => {
      const pixels = async (png: string) => {
        const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [x, y] = await Promise.all([pixels(a), pixels(b)]);
      let changed = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2]),
        );
        if (d > by) changed++;
      }
      return changed / (x.length / 4);
    },
    [a.toString("base64"), b.toString("base64"), by] as const,
  );
}

test("the intertidal heights are not fetched on the chart of all Ireland", async ({
  page,
}) => {
  const reads = await open(page, "/");
  // The chart settled, its foil regions drawn: still nothing of the heights.
  await page.waitForTimeout(1500);
  expect([...reads.keys()]).toEqual([]);
});

test("the intertidal heights draw over the foil layer in the Malahide estuary, by range", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reads = await open(page, "/?spot=kilcrea");
  await frame(page);
  const withHeights = await photograph(page);

  // The index once, then the region under the view by range only.
  expect(reads.get("/intertidal/index.json")).toEqual([200]);
  const archive = [...reads].filter(([p]) =>
    /^\/intertidal\/v[0-9a-f]+\/tide-howth\.pmtiles$/.test(p),
  );
  expect(archive).toHaveLength(1);
  expect(archive[0][1].length).toBeGreaterThan(1);
  expect(new Set(archive[0][1])).toEqual(new Set([206]));

  // Without them, the foil archives' own foreshore: another picture.
  const without = await page.context().newPage();
  await open(without, "/?spot=kilcrea", false);
  await frame(without);
  const foilOnly = await photograph(without);
  expect(await differs(page, withHeights, foilOnly)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});
