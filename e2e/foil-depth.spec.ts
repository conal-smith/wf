import { expect, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip } from "./columns";

/**
 * The foilable-depth layer draws, and moves with the tide, in the Malahide
 * estuary: the committed archives (public/foildepth) under a routed Howth tide.
 *
 * Twice: from a host that serves byte ranges (vite preview, Caddy, R2), and
 * from one that answers every range with a 200 and the whole file, as
 * Cloudflare Pages does. On Pages the pmtiles reader refused that answer and
 * the map, which takes its own errors, said nothing: the layer, and the depth
 * tints with it, were never drawn on staging (force5/src/archives.ts).
 *
 * Nothing here knows the layer's colours or the map's internals: the chart is
 * photographed with the layer on at high and at low water and with it off,
 * and the three must differ where the estuary is.
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
    Fenit: {
      name: "Fenit",
      lat: 52.27,
      lon: -9.87,
      url: "marine/tides-Fenit-foil.json",
    },
  },
  spots: { kilcrea: { station: "Howth", distanceKm: 9.8 } },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};

/** The highest and the lowest water among the strip's first day of hours. */
const day = sampleStrip.slice(0, 24).map((c, i) => ({ i, t: height(c.time) }));
const high = day.reduce((a, b) => (b.t > a.t ? b : a));
const low = day.reduce((a, b) => (b.t < a.t ? b : a));

const ARCHIVE = /\/(foildepth|bathy)\/[^/]+\.pmtiles$/;

async function open(page: Page, ranges: boolean) {
  trackArchives(page);
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-*-foil.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  if (!ranges)
    await page.route(ARCHIVE, async (route) => {
      const headers = { ...route.request().headers() };
      delete headers.range;
      const whole = await route.fetch({ headers });
      await route.fulfill({
        status: 200,
        body: await whole.body(),
        headers: { "content-type": "application/octet-stream" },
      });
    });
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ foil: true }),
    ),
  );
  // No flights and no drifting arrows: the same chart, photographed twice,
  // is the same picture.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?spot=kilcrea");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 30000 });
  await page.addStyleTag({
    content:
      ".particle-canvas, .spot-marker, .map-pen, .pick-mark { visibility: hidden !important; }",
  });
  await page.keyboard.press("Escape"); // the focus's paper, off the estuary
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await zoomIn.click();
}

/** Archive reads still on their way, per page. */
const inFlight = new WeakMap<Page, Set<unknown>>();
function trackArchives(page: Page) {
  const pending = new Set<unknown>();
  inFlight.set(page, pending);
  page.on("request", (r) => {
    if (ARCHIVE.test(new URL(r.url()).pathname)) pending.add(r);
  });
  for (const done of ["requestfinished", "requestfailed"] as const)
    page.on(done, (r) => pending.delete(r));
}

/**
 * The chart over the estuary, once nothing is on its way and three looks
 * half a second apart agree: the camera still, every tile in, the fade done.
 */
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

/** The share of pixels two photographs disagree on, plainly (not noise). */
async function differs(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([a, b]) => {
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
        if (d > 40) changed++;
      }
      return changed / (x.length / 4);
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

for (const ranges of [true, false])
  test(`the foilable depth draws in the Malahide estuary and follows the tide, from a host ${ranges ? "that serves ranges" : "that sends the whole file for a range, as Cloudflare Pages does"}`, async ({
    page,
  }) => {
    expect(high.t - low.t).toBeGreaterThan(3);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const reads = new Map<string, number[]>();
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (!ARCHIVE.test(path)) return;
      reads.set(path, [...(reads.get(path) ?? []), response.status()]);
    });
    await open(page, ranges);
    const slider = page.getByRole("slider", { name: "Forecast time" });

    await slider.fill(String(high.i));
    await expect(slider).toHaveValue(String(high.i));
    const atHigh = await photograph(page);
    await slider.fill(String(low.i));
    await expect(slider).toHaveValue(String(low.i));
    const atLow = await photograph(page);
    // The same hour with the layer off.
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page
      .getByRole("group", { name: "Layers" })
      .getByRole("checkbox", { name: "Foilable depth at the tide (pilot)" })
      .uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("group", { name: "Layers" })).toHaveCount(0);
    const off = await photograph(page);

    // The tints are over the estuary at both tides, and the tide moves them.
    expect(await differs(page, atHigh, off)).toBeGreaterThan(0.05);
    expect(await differs(page, atLow, off)).toBeGreaterThan(0.05);
    expect(await differs(page, atHigh, atLow)).toBeGreaterThan(0.02);

    // Every archive the estuary needs was read, and read as the host serves:
    // by range, or once as a whole file kept for every later read.
    for (const name of ["malahide-lagoon", "dublin-north"]) {
      const statuses = reads.get(`/foildepth/${name}.pmtiles`) ?? [];
      if (ranges) {
        expect(statuses.length, name).toBeGreaterThan(1);
        expect(new Set(statuses), name).toEqual(new Set([206]));
      } else expect(statuses, name).toEqual([200]);
    }
    expect(errors).toEqual([]);
  });
