import {
  closeLayers,
  expect,
  layersRail,
  openFromMenu,
  test,
  type Page,
} from "./fixtures";

/**
 * The satellite image draws under the chart in the Malahide estuary, at high
 * tide and at low tide, from the committed offline set (public-data/satellite/
 * v…, which the e2e site serves in place of the national index:
 * scripts/e2e-site.mjs), and the choice is kept.
 *
 * As e2e/foil-depth.spec.ts does, nothing here knows the image's colours: the
 * chart is photographed with the image off, at high tide and at low tide, and
 * the three must differ, high from low where the estuary's flats are.
 */

const ARCHIVE = /\/(satellite|bathy)\/v[0-9a-f]+\/[^/]+\.pmtiles$/;
const LAYERS_KEY = "wingfoil.map.layers.v1";

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

async function open(page: Page) {
  trackArchives(page);
  // The foil layer off, so the photographs are of the image and the chart only.
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ foil: false }));
  }, LAYERS_KEY);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?spot=kilcrea");
  await expect(page.locator(".spot-marker").first()).toBeAttached({
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
async function differs(page: Page, a: Buffer, b: Buffer, by = 40) {
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

/** Each tide's button on the layers' rail, under Ground. */
const TILE = {
  "High tide": "Satellite, high tide",
  "Low tide": "Satellite, low tide",
} as const;
const tile = (page: Page, name: keyof typeof TILE) =>
  layersRail(page)
    .getByRole("group", { name: "Ground" })
    .getByRole("button", { name: TILE[name], exact: true });

async function choose(page: Page, name: "Off" | "High tide" | "Low tide") {
  await openFromMenu(page, "Layers");
  if (name === "Off") {
    // No image: the tide that is on, pressed again.
    for (const tide of ["High tide", "Low tide"] as const)
      if ((await tile(page, tide).getAttribute("aria-pressed")) === "true")
        await tile(page, tide).click();
    for (const tide of ["High tide", "Low tide"] as const)
      await expect(tile(page, tide)).toHaveAttribute("aria-pressed", "false");
  } else {
    await tile(page, name).click();
    await expect(tile(page, name)).toHaveAttribute("aria-pressed", "true");
  }
  await closeLayers(page);
}

test("the satellite image draws at high and at low tide in the Malahide estuary, and is kept", async ({
  page,
}) => {
  // Photographs of the chart, each waiting for it to settle, and a
  // reload: on a loaded runner its last steps ran past 45 s, though no step
  // hung, as the blend squares' and the dock's long tests do.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reads = new Map<string, number[]>();
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!ARCHIVE.test(path)) return;
    reads.set(path, [...(reads.get(path) ?? []), response.status()]);
  });
  await open(page);

  // Off by default: no index, no archive.
  expect([...reads.keys()].filter((p) => p.includes("/satellite/"))).toEqual(
    [],
  );
  const off = await photograph(page);

  await choose(page, "High tide");
  await expect(page.locator("[data-satellite='high']")).toHaveCount(1);
  const high = await photograph(page);
  await choose(page, "Low tide");
  await expect(page.locator("[data-satellite='low']")).toHaveCount(1);
  // Drawn whole once its tiles are in, over the high tide's until then.
  await expect(page.locator("[data-satellite-loading='false']")).toHaveCount(
    1,
    { timeout: 30000 },
  );
  const low = await photograph(page);

  // The image covers the view, land and sea; between the tides the estuary's
  // flats and channels change.
  expect(await differs(page, high, off)).toBeGreaterThan(0.3);
  expect(await differs(page, low, off)).toBeGreaterThan(0.3);
  expect(await differs(page, high, low, 30)).toBeGreaterThan(0.03);

  // Read by range from the offline set's versioned folder (scripts/satellite/publish.py).
  for (const option of ["high", "low"]) {
    const statuses = [...reads]
      .filter(([path]) =>
        new RegExp(`^/satellite/v[0-9a-f]+/${option}\\.pmtiles$`).test(path),
      )
      .flatMap(([, s]) => s);
    expect(statuses.length, option).toBeGreaterThan(1);
    expect(new Set(statuses), option).toEqual(new Set([206]));
  }

  // The key names the tide the image was taken at, near here.
  await openFromMenu(page, "About");
  await page.getByRole("tab", { name: "Satellite" }).click();
  await expect(page.locator(".k-sat")).toContainText(
    /Satellite: low tide \(≈\d\.\d m\)/,
  );
  await page.keyboard.press("Escape");

  // Kept in the layers' store, and drawn again after a reload.
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    LAYERS_KEY,
  );
  expect(stored.satellite).toBe("low");
  expect(stored.foil).toBe(false);
  await page.reload();
  await expect(page.locator("[data-satellite='low']")).toHaveCount(1, {
    timeout: 30000,
  });
  await openFromMenu(page, "Layers");
  await expect(tile(page, "Low tide")).toHaveAttribute("aria-pressed", "true");
  await closeLayers(page);

  // And off again is off, and stays so.
  await choose(page, "Off");
  await expect(page.locator("[data-satellite='off']")).toHaveCount(1);
  expect(errors).toEqual([]);
});
