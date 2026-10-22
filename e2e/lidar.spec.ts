import { expect, openFromMenu, test, type Page } from "./fixtures";

/**
 * The LiDAR layer: off by default with nothing of it fetched; turned on in
 * Layers (in the site menu), it draws over Portmarnock and Baldoyle from the
 * committed offline set (public-data/lidar/v…, which the e2e site serves in
 * place of the national index: scripts/e2e-site.mjs), read by range; its key
 * is in the map's information, and the choice is kept.
 */

const LIDAR = /\/lidar\//;
const LAYERS_KEY = "wingfoil.map.layers.v1";

async function open(page: Page) {
  // The foil layer off, so the photographs are of the LiDAR and the chart only.
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ foil: false }));
  }, LAYERS_KEY);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?spot=portmarnock");
  await expect(page.locator(".spot-marker").first()).toBeAttached({
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0, { timeout: 30000 });
  await page.addStyleTag({
    content:
      ".particle-canvas, .spot-marker, .map-pen, .pick-mark { visibility: hidden !important; }",
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".map-canvas")).not.toHaveClass(/is-focus/);
}

/** The chart, once three looks half a second apart agree. */
async function photograph(page: Page) {
  const map = (await page.locator(".maplibregl-canvas").boundingBox())!;
  const dock = (await page.locator(".map-footer").boundingBox())!;
  const clip = {
    x: map.x + 40,
    y: map.y + 90,
    width: map.width - 120,
    height: dock.y - map.y - 120,
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

/** Do two photographs differ anywhere by more than a little? */
async function changed(page: Page, a: Buffer, b: Buffer) {
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
      let n = 0;
      for (let i = 0; i < x.length; i += 4)
        if (
          Math.max(
            Math.abs(x[i] - y[i]),
            Math.abs(x[i + 1] - y[i + 1]),
            Math.abs(x[i + 2] - y[i + 2]),
          ) > 30
        )
          n++;
      return n / (x.length / 4);
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

async function toggle(page: Page, on: boolean) {
  await openFromMenu(page, "Layers");
  const box = page.getByRole("checkbox", { name: "LiDAR data" });
  await expect(box).toBeChecked({ checked: !on });
  await box.setChecked(on);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Layers" })).toHaveCount(0);
}

test("the LiDAR layer loads nothing until it is turned on, then draws, keys and is kept", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reads: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (LIDAR.test(path)) reads.push({ path, status: response.status() });
  });
  await open(page);

  // Off by default: no index, no archive, no outline.
  await expect(page.locator("[data-lidar='off']")).toHaveCount(1);
  expect(reads).toEqual([]);
  const off = await photograph(page);

  await toggle(page, true);
  await expect(page.locator("[data-lidar='on']")).toHaveCount(1);
  await expect
    .poll(() => reads.filter((r) => r.path.endsWith(".pmtiles")).length, {
      timeout: 30000,
    })
    .toBeGreaterThan(1);
  const on = await photograph(page);
  // The land round Portmarnock, Baldoyle's estuary and the Velvet Strand:
  // a land survey has nothing over the sea, which is most of the view.
  expect(await changed(page, on, off)).toBeGreaterThan(0.03);

  // The index from the site, the archive by range and the outline from the
  // offline set's versioned folder (scripts/lidar/publish.py).
  expect(reads.some((r) => r.path === "/lidar/index.json")).toBe(true);
  const archive = reads.filter((r) =>
    /^\/lidar\/v[0-9a-f]+\/lidar\.pmtiles$/.test(r.path),
  );
  expect(new Set(archive.map((r) => r.status))).toEqual(new Set([206]));
  expect(
    reads.some((r) => /^\/lidar\/v[0-9a-f]+\/coverage\.json$/.test(r.path)),
  ).toBe(true);

  // Its key, from the Layers panel's "i": the scale and the surveys.
  await openFromMenu(page, "Layers");
  await page.getByRole("button", { name: "About the LiDAR data" }).click();
  const key = page.locator("[data-lidar-key]");
  await expect(key).toBeVisible();
  await expect(key.locator(".fk-scale")).toBeVisible();
  await expect(key.locator("[data-lidar-sources] li").first()).toContainText(
    /Lough Foyle: bathymetric, 2008, 5 m; CC BY 4\.0/,
  );
  await expect(page.locator("#map-info-sources")).toContainText(
    "OSNI River Basin LiDAR",
  );
  await page.keyboard.press("Escape");

  // Kept, and drawn again after a reload; off again is off.
  await page.reload();
  await expect(page.locator("[data-lidar='on']")).toHaveCount(1, {
    timeout: 30000,
  });
  await toggle(page, false);
  await expect(page.locator("[data-lidar='off']")).toHaveCount(1);
  expect(errors).toEqual([]);
});
