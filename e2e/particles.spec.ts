import {
  chooseSpot,
  closePanel,
  expect,
  openFromMenu,
  test,
  type Page,
} from "./fixtures";

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
  // A spot chosen: the dock's slider moves the time.
  await chooseSpot(page);
  await page.getByRole("slider", { name: "Forecast time" }).fill("4");
  await expectResumed(page);
});

test("the wind's two layers: the particles on and off by themselves, over the coloured wind or not, and remembered", async ({
  page,
}) => {
  await instrument(page);
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  const canvas = page.locator(".particle-canvas");
  await expect(canvas).toHaveAttribute("data-wind", "particles");
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
  await openFromMenu(page, "Layers");
  const panel = page.getByRole("group", { name: "Layers" });
  const press = (name: string) =>
    panel.getByRole("button", { name, exact: true }).click();
  // The coloured wind under them: the particles keep drawing, in ink.
  await press("Coloured wind");
  await expect(canvas).toHaveAttribute("data-wind", "wash particles");
  await expectResumed(page);
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
  expect(await tinted(page)).toBe(0);
  // The particles off: the colour alone, nothing drawn and nothing worked.
  await press("Particles");
  await expect(canvas).toHaveAttribute("data-wind", "wash");
  await expectIdle(page);
  expect(await inked(page)).toBe(0);
  // And back, over the colour, then alone.
  await press("Particles");
  await expect(canvas).toHaveAttribute("data-wind", "wash particles");
  await expectResumed(page);
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
  await press("Coloured wind");
  await expect(canvas).toHaveAttribute("data-wind", "particles");
  await expectResumed(page);
  // Neither: the plain chart.
  await press("Particles");
  await expect(canvas).toHaveAttribute("data-wind", "");
  await expectIdle(page);
  expect(await inked(page)).toBe(0);
  // The colour alone, kept: read back as the page mounts, and the particles
  // stay still once the chart is up again.
  await press("Coloured wind");
  await expect(canvas).toHaveAttribute("data-wind", "wash");
  expect(
    await page.evaluate(() => localStorage.getItem("wingfoil.map.wind.v2")),
  ).toBe(JSON.stringify({ wash: true, particles: false }));
  await page.reload();
  await expect(canvas).toHaveAttribute("data-wind", "wash");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expectIdle(page);
  expect(await inked(page)).toBe(0);
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

test("an older chart's wind style is read into the two layers", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator(".particle-canvas");
  await expect(canvas).toHaveAttribute("data-wind", "particles");
  // Ink was the particles alone; the coloured wind is the colour alone now;
  // the coloured arrows wanted the speed in colour and the way in lines.
  for (const [style, wind] of [
    ["ink", "particles"],
    ["wash", "wash"],
    ["arrows", "wash particles"],
  ]) {
    await page.evaluate((style) => {
      localStorage.removeItem("wingfoil.map.wind.v2");
      localStorage.setItem("wingfoil.map.wind.v1", style);
    }, style);
    await page.reload();
    await expect(canvas, style).toHaveAttribute("data-wind", wind);
  }
  // The new key wins over the old one once the rider has chosen.
  await openFromMenu(page, "Layers");
  await page
    .getByRole("group", { name: "Layers" })
    .getByRole("button", { name: "Particles", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-wind", "wash");
  await closePanel(page);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-wind", "wash");
});
