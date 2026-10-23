import { readFileSync } from "node:fs";
import { expect, openFromMenu, setLayer, test, type Page } from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip } from "./columns";

/**
 * A national region (one tide station's stretch of coast) draws, follows its
 * own station's tide, and answers a tap, with nothing from the network: the
 * index, the archive and the tides are all routed here. The archive is a
 * small synthetic one built as the regions are (scripts/foildepth/fixture.py):
 * for 4 km round Rusheen Bay the bed is a flat 1.0 m above LAT, so it is dry at
 * low water and has (tide − 1) m of water at high.
 *
 * And only what is in view is fetched: a second region, on the far coast,
 * has neither its archive nor its station's curve asked for.
 */

const HOUR = 3600000;
const clock = SAMPLE_CLOCK.getTime();
const STEP_MINUTES = 30;
const FROM = clock - 24 * HOUR;
const SAMPLES = 8 * 48 + 1;
/** A plain semidiurnal tide at Galway, 0.3 m to 4.9 m above LAT. */
const height = (time: number) =>
  2.6 + 2.3 * Math.sin(((time - FROM) / HOUR) * ((2 * Math.PI) / 12.42));
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
    Galway: {
      name: "Galway",
      lat: 53.269,
      lon: -9.048,
      url: "marine/tides-Galway-national.json",
    },
    Howth: {
      name: "Howth",
      lat: 53.39,
      lon: -6.07,
      url: "marine/tides-Howth-national.json",
    },
  },
  spots: { rusheen: { station: "Galway", distanceKm: 5 } },
  attribution: "Tidal predictions © Marine Institute, CC BY 4.0",
};

const BASE = "foildepth/v0000000000aa/";
const region = (
  id: string,
  station: string,
  bounds: number[],
  at: number[],
) => ({
  id,
  kind: "region",
  name: `Coast on the ${station} tide`,
  url: `${id}.pmtiles`,
  bounds,
  minzoom: 7,
  maxzoom: 12,
  tileSize: 512,
  station,
  stationLonLat: at,
  dryCeilingMetres: 6.1,
  sources: [
    {
      name: "fixture",
      role: "synthetic",
      years: "",
      resolution: "",
      licence: "",
    },
  ],
});
const index = {
  schemaVersion: 2,
  kind: "foildepth",
  generatedAt: "2026-10-11T00:00:00Z",
  datum: "LAT",
  encoding: "terrarium",
  base: BASE,
  floorMetres: -5,
  deepMetres: -20,
  landMetres: 50,
  noSurveyMetres: 40,
  estimateBlue: 4,
  padMetres: 10,
  areas: [
    region(
      "tide-galway",
      "Galway",
      [-9.25, 53.2, -9.0, 53.3],
      [-9.048, 53.269],
    ),
    region("tide-howth", "Howth", [-6.3, 53.3, -6.0, 53.5], [-6.068, 53.391]),
  ],
  attribution: "Synthetic.",
};
const archive = readFileSync("e2e/foildepth/tide-galway.pmtiles");

/** The highest and the lowest water among the strip's first day of hours. */
const day = sampleStrip.slice(0, 24).map((c, i) => ({ i, t: height(c.time) }));
const high = day.reduce((a, b) => (b.t > a.t ? b : a));
const low = day.reduce((a, b) => (b.t < a.t ? b : a));

async function open(page: Page, asked: string[]) {
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (/foildepth|tides-/.test(path)) asked.push(path);
  });
  await page.route("**/foildepth/index.json", (route) =>
    route.fulfill({ json: index }),
  );
  await page.route(`**/${BASE}*.pmtiles`, async (route) => {
    if (!route.request().url().endsWith("/tide-galway.pmtiles"))
      return route.fulfill({ status: 404 });
    // By range, as the data host serves it.
    const range = /bytes=(\d+)-(\d+)/.exec(
      route.request().headers()["range"] ?? "",
    );
    if (!range) return route.fulfill({ body: archive });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), archive.length - 1);
    await route.fulfill({
      status: 206,
      body: archive.subarray(start, end + 1),
      headers: {
        "content-type": "application/octet-stream",
        "content-range": `bytes ${start}-${end}/${archive.length}`,
      },
    });
  });
  await page.route("**/marine/tides.json", (route) =>
    route.fulfill({ json: tideManifest }),
  );
  await page.route("**/marine/tides-*-national.json", (route) =>
    route.fulfill({ json: tideCurve }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The chart at the zoom these photographs were framed for. The loupe flies
  // a chosen spot in to fit its half-mile rose, where the frame would hold
  // only the flat by the spot; the range ring keeps the camera where it was.
  await page.addInitScript(() =>
    localStorage.setItem("wingfoil.map.focus.v1", "ring"),
  );
  // The layer is on by default: nothing stored.
  await page.goto("/?spot=rusheen");
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 30000 });
  await expect(
    page.locator('.spot-marker[data-spot-id="rusheen"]'),
  ).toHaveCount(1, { timeout: 30000 });
  // The same chart, photographed twice, is the same picture: nothing that
  // moves or marks over it (a marker hidden still has its box, for the tap).
  await page.addStyleTag({
    content:
      ".particle-canvas, .spot-marker, .map-pen, .pick-mark { visibility: hidden !important; }",
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
}

/** The chart round the spot, once three looks half a second apart agree. */
async function photograph(page: Page) {
  const box = (await page
    .locator('.spot-marker[data-spot-id="rusheen"]')
    .boundingBox())!;
  const clip = {
    x: box.x - 260,
    y: box.y - 160,
    width: 520,
    height: 320,
  };
  let last = await page.screenshot({ clip });
  let same = 0;
  for (let i = 0; i < 60 && same < 2; i++) {
    await page.waitForTimeout(500);
    const next = await page.screenshot({ clip });
    same = next.equals(last) ? same + 1 : 0;
    last = next;
  }
  expect(same, "the chart never settled").toBe(2);
  return last;
}

/** The share of pixels two photographs plainly disagree on. */
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

test("a national region draws on its own station's tide, answers a tap, and only what is in view is fetched", async ({
  page,
}) => {
  expect(high.t - low.t).toBeGreaterThan(3);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked: string[] = [];
  await open(page, asked);
  const slider = page.getByRole("slider", { name: "Forecast time" });

  await slider.fill(String(high.i));
  await expect(slider).toHaveValue(String(high.i));
  const atHigh = await photograph(page);
  await slider.fill(String(low.i));
  await expect(slider).toHaveValue(String(low.i));
  const atLow = await photograph(page);
  await openFromMenu(page, "Layers");
  await setLayer(page, "Tidal depth", false);
  await page.keyboard.press("Escape");
  const off = await photograph(page);
  expect(await differs(page, atHigh, off)).toBeGreaterThan(0.05);
  expect(await differs(page, atLow, off)).toBeGreaterThan(0.05);
  expect(await differs(page, atHigh, atLow)).toBeGreaterThan(0.02);

  // Back on, at high water: a tap beside the spot, on the flat, is read out
  // as (tide − 1) m of water at Galway's tide.
  await openFromMenu(page, "Layers");
  await setLayer(page, "Tidal depth", true);
  await page.keyboard.press("Escape");
  await slider.fill(String(high.i));
  const spot = (await page
    .locator('.spot-marker[data-spot-id="rusheen"]')
    .boundingBox())!;
  await page.mouse.click(
    spot.x + spot.width / 2 + 40,
    spot.y + spot.height / 2,
  );
  await openFromMenu(page, "About the map");
  const probe = page.locator(".foil-probe");
  await expect(probe).toBeVisible({ timeout: 10000 });
  const water =
    /^~(\d+\.\d) m of water at .* \(tide (\d+\.\d) m at Galway\)\.$/.exec(
      (await probe.innerText()).trim(),
    );
  expect(water, await probe.innerText()).not.toBeNull();
  expect(Number(water![1])).toBeCloseTo(Number(water![2]) - 1, 1);

  // The Galway region's archive was read by range; Howth's, out of view,
  // was never asked for, nor Howth's tide.
  expect(asked.some((p) => p.endsWith("/tide-galway.pmtiles"))).toBe(true);
  expect(asked.some((p) => p.includes("tides-Galway"))).toBe(true);
  expect(asked.filter((p) => /howth/i.test(p))).toEqual([]);
  expect(errors).toEqual([]);
});

test("over the whole chart nothing of it is fetched, and Layers says to zoom in", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (/foildepth|tides-/.test(path)) asked.push(path);
  });
  await page.route("**/foildepth/index.json", (route) =>
    route.fulfill({ json: index }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The layer is on by default: nothing stored.
  await page.goto("/");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(1000);
  expect(asked).toEqual([]);
  await openFromMenu(page, "Layers");
  const panel = page.getByRole("group", { name: "Layers" });
  await expect(panel.locator('[data-layer="foil"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.locator("[data-foil-note]")).toHaveText("Zoom in to see.");
  await page.keyboard.press("Escape");

  // In to a bay's zoom, the index is read and the note goes.
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 3; i++) await zoomIn.click();
  await expect
    .poll(() => asked.some((p) => p.endsWith("/foildepth/index.json")))
    .toBe(true);
  await openFromMenu(page, "Layers");
  await expect(panel.locator("[data-foil-note]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
