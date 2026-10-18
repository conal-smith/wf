import { expect, rememberSpot, test, type Page } from "./fixtures";

declare global {
  interface Window {
    particleWork: { strokes: number; clears: number; fields: number };
  }
}

/** Counts the particle canvas's strokes and clears, and its field rebuilds. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.particleWork = { strokes: 0, clears: 0, fields: 0 };
    const prototype = CanvasRenderingContext2D.prototype;
    const stroke = prototype.stroke;
    prototype.stroke = function (...args: Parameters<typeof stroke>) {
      if (this.canvas.classList.contains("particle-canvas"))
        window.particleWork.strokes++;
      return stroke.apply(this, args);
    };
    const clear = prototype.clearRect;
    prototype.clearRect = function (...args: Parameters<typeof clear>) {
      if (this.canvas.classList.contains("particle-canvas"))
        window.particleWork.clears++;
      return clear.apply(this, args);
    };
    // The screen-space field: three numbers per 10 px cell.
    window.Float32Array = new Proxy(Float32Array, {
      construct(target, args) {
        const canvas =
          document.querySelector<HTMLCanvasElement>(".particle-canvas");
        if (
          canvas &&
          args[0] ===
            (Math.ceil(canvas.clientWidth / 10) + 1) *
              (Math.ceil(canvas.clientHeight / 10) + 1) *
              3
        )
          window.particleWork.fields++;
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto("/");
  await firstStrokes(page);
}

/**
 * The first strokes on a page just loaded. They wait for the whole chart to
 * load -- tiles, every model's manifest, the first frame -- which on a CI
 * runner takes longer than the default five seconds. The same allowance the
 * rest of the suite gives the chart to come up (openChart in map.spec.ts).
 */
async function firstStrokes(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.particleWork.strokes), {
      timeout: 30000,
    })
    .toBeGreaterThan(5);
}

/**
 * Sets the camera off and waits for it to come to rest. The field is
 * resampled for the view once the camera is still, and never while it moves
 * (windLayer.ts), so a rebuild counted after the move began is one made where
 * it stopped. The count is taken before the move: read after it, a short zoom
 * could already have stopped and rebuilt, and no rebuild would follow. A
 * zoom on a CI runner, under the pinned clock, can block the page for a few
 * seconds before it settles, so it gets the chart's own allowance, not five.
 */
async function cameraAtRest(page: Page, move: () => Promise<void>) {
  const before = await page.evaluate(() => window.particleWork.fields);
  await move();
  await expect
    .poll(() => page.evaluate(() => window.particleWork.fields), {
      timeout: 30000,
    })
    .toBeGreaterThan(before);
}

async function expectIdle(page: Page) {
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => ({ ...window.particleWork }));
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.particleWork)).toEqual(before);
}

async function expectResumed(page: Page) {
  const before = await page.evaluate(() => window.particleWork.strokes);
  await expect
    .poll(() => page.evaluate(() => window.particleWork.strokes))
    .toBeGreaterThan(before + 2);
}

/** Pixels the particle canvas has ink on. */
const inked = (page: Page) =>
  page.locator(".particle-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
    return count;
  });

test("particle work stops when hidden or for reduced motion, and resumes", async ({
  page,
}) => {
  await instrument(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectIdle(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectResumed(page);
  // The visibility lifecycle, without relying on headless tab occlusion.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectIdle(page);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectResumed(page);
});

test("dragging carries the arrows with the map and defers field rebuilds until it stops", async ({
  page,
}) => {
  // A returning visitor's spot: the dock's slider moves the time at the end.
  await rememberSpot(page);
  await instrument(page);
  await page.mouse.move(700, 260);
  await page.mouse.down();
  await page.mouse.move(720, 270, { steps: 3 });
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => ({ ...window.particleWork }));
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(730 + i * 8, 275 + i * 3);
    await page.waitForTimeout(35);
  }
  const during = await page.evaluate(() => ({ ...window.particleWork }));
  // The same lines are drawn as the map moves, carried with it, but the
  // field is resampled only once it stops: per frame it is too costly.
  expect(during.strokes).toBeGreaterThan(before.strokes);
  expect(during.fields).toBe(before.fields);
  await page.mouse.up();
  await expectResumed(page);
  await expect
    .poll(() => page.evaluate(() => window.particleWork.fields))
    .toBeGreaterThan(before.fields);
  await page.setViewportSize({ width: 820, height: 900 });
  await expectResumed(page);
  await page.getByRole("slider", { name: "Forecast time" }).fill("4");
  await expectResumed(page);
});

test("every wind style keeps the arrows drawing, in any order, and is remembered", async ({
  page,
}) => {
  await instrument(page);
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  const canvas = page.locator(".particle-canvas");
  await expect(canvas).toHaveAttribute("data-wind-style", "ink");
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  await layers.click();
  const panel = page.getByRole("group", { name: "Layers" });
  for (const [name, style] of [
    ["Wash", "wash"],
    ["Coloured arrows", "arrows"],
    ["Ink", "ink"],
    ["Coloured arrows", "arrows"],
    ["Wash", "wash"],
    ["Ink", "ink"],
  ]) {
    await panel.getByRole("radio", { name }).check();
    await expect(canvas).toHaveAttribute("data-wind-style", style);
    // Fresh arrows in the new style, not what was left of the last one: the
    // attribute is set once the layer has the style (WindMap.tsx), and each
    // frame drawn after that clears the canvas and draws every line in it.
    await expectResumed(page);
    await expect
      .poll(() => inked(page), { message: name })
      .toBeGreaterThan(100);
  }
  await panel.getByRole("radio", { name: "Wash" }).check();
  await page.reload();
  // The style is read back as the page mounts, before the chart is up; the
  // arrows then wait for the whole chart to load again, as they did the first
  // time, and on a CI runner that has taken longer than five seconds.
  await expect(canvas).toHaveAttribute("data-wind-style", "wash");
  await firstStrokes(page);
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
});

/** Pixels the particle canvas has a clear colour on, rather than ink. */
const tinted = (page: Page) =>
  page.locator(".particle-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        data[i + 3] > 40 &&
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) >
          30
      )
        count++;
    return count;
  });

test("zoomed right in, the coloured arrows go to ink and keep moving", async ({
  page,
}) => {
  // Seven zooms, each waited out: more than the default test time on CI.
  test.slow();
  await instrument(page);
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  await layers.click();
  await page
    .getByRole("group", { name: "Layers" })
    .getByRole("radio", { name: "Coloured arrows" })
    .check();
  await layers.click();
  await expect.poll(() => tinted(page)).toBeGreaterThan(20);
  // The depths take over from zoom 11 (windLayer.ts); the chart opens near 6.
  // A press zooms one level on from wherever the camera has got to, so each
  // waits for the last to finish. Under the pinned clock (fixtures.ts) the
  // page gets a few animation frames a second, not sixty, and seven presses
  // 400 ms apart ended anywhere from 10.4 to 11.4, still moving: coloured.
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  for (let i = 0; i < 7; i++) {
    await cameraAtRest(page, () => zoomIn.click());
  }
  await expectResumed(page);
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
  expect(await tinted(page)).toBe(0);
});
