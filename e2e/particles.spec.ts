import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    particleWork: { strokes: number; clears: number; fields: number };
  }
}

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
    // Identify screen-space vector-grid allocations by their exact dimensions.
    window.Float32Array = new Proxy(Float32Array, {
      construct(target, args) {
        const canvas =
          document.querySelector<HTMLCanvasElement>(".particle-canvas");
        if (
          canvas &&
          args[0] ===
            (Math.ceil(canvas.clientWidth / 9) + 1) *
              (Math.ceil(canvas.clientHeight / 9) + 1) *
              2
        )
          window.particleWork.fields++;
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.particleWork.strokes))
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

test("particle work stops when disabled, hidden or reduced-motion, and resumes", async ({
  page,
}) => {
  await instrument(page);
  await page.getByLabel("Layers", { exact: true }).click();
  await page.getByLabel("Moving particles", { exact: true }).uncheck();
  await expectIdle(page);
  await page.getByLabel("Moving particles", { exact: true }).check();
  await expectResumed(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectIdle(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectResumed(page);
  // Deterministically exercise the visibility lifecycle without relying on
  // headless Chromium's tab-occlusion policy.
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

test("dragging defers vector-grid rebuilds until movement ends", async ({
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
