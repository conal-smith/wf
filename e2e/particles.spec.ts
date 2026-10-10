import { expect, test, type Page } from "./fixtures";

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
  // The first strokes wait for the whole chart to load -- tiles, every model's
  // manifest, the first frame -- which on a CI runner takes longer than the
  // default five seconds. The same allowance the rest of the suite gives the
  // chart to come up (openChart in map.spec.ts).
  await expect
    .poll(() => page.evaluate(() => window.particleWork.strokes), {
      timeout: 30000,
    })
    .toBeGreaterThan(5);
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

test("dragging defers field rebuilds until the map stops", async ({ page }) => {
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
  expect(await page.evaluate(() => window.particleWork)).toEqual(before);
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
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
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
    // Fresh arrows in the new style, not what was left of the last one.
    await page.waitForTimeout(150);
    await expect.poll(() => inked(page), { message: name }).toBeGreaterThan(100);
  }
  await panel.getByRole("radio", { name: "Wash" }).check();
  await page.reload();
  await expect(page.locator(".particle-canvas")).toHaveAttribute(
    "data-wind-style",
    "wash",
    { timeout: 30000 },
  );
  await expect.poll(() => inked(page)).toBeGreaterThan(100);
});
