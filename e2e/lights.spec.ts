import { expect, steadyFrames, test, type Page } from "./fixtures";

/**
 * Through a camera move the lights are drawn on one canvas, and their
 * buttons step aside (force5/src/lights.ts): held mid-drag, a light's button
 * is out of sight and the canvas has it where the chart has moved it; let
 * go, the button is back there and the canvas is clear.
 */

const ID = "brandon";

/** The light's centre on the page. */
const centre = (page: Page) =>
  page.locator(`.spot-marker[data-spot-id="${ID}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

/** The canvas's most opaque pixel within `r` px of a point on the page. */
const painted = (page: Page, at: { x: number; y: number }, r = 4) =>
  page.evaluate(
    ([at, r]) => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(".lights-canvas")!;
      const box = canvas.getBoundingClientRect();
      const k = canvas.width / box.width;
      const x = Math.round((at.x - box.left - r) * k);
      const y = Math.round((at.y - box.top - r) * k);
      const n = Math.max(1, Math.round(2 * r * k));
      const data = canvas.getContext("2d")!.getImageData(x, y, n, n).data;
      let most = 0;
      for (let i = 3; i < data.length; i += 4) most = Math.max(most, data[i]);
      return most;
    },
    [at, r] as const,
  );

test("through a move the lights are drawn on a canvas, and the buttons come back where the chart has them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?map");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await steadyFrames(page);
  const before = await centre(page);
  expect(await painted(page, before)).toBe(0);

  // A drag from open chart, held.
  const from = await page.evaluate(() => {
    for (let y = 200; y < 700; y += 37)
      for (let x = 300; x < 1200; x += 41)
        if (
          document
            .elementFromPoint(x, y)
            ?.classList.contains("maplibregl-canvas")
        )
          return { x, y };
    return null;
  });
  expect(from).not.toBeNull();
  const by = { x: 120, y: 60 };
  await page.mouse.move(from!.x, from!.y);
  await page.mouse.down();
  await page.mouse.move(from!.x + by.x, from!.y + by.y, { steps: 12 });
  await page.waitForTimeout(300);
  await expect(page.locator(".map-lights")).toHaveClass(/is-moving/);
  const light = page.locator(`.spot-marker[data-spot-id="${ID}"]`);
  await expect(light).toHaveCSS("opacity", "0");
  const moved = { x: before.x + by.x, y: before.y + by.y };
  expect(await painted(page, moved)).toBeGreaterThan(200);

  // Let go: the button is back, where the chart is now, and nothing is drawn.
  await page.mouse.up();
  await expect(page.locator(".map-lights")).not.toHaveClass(/is-moving/, {
    timeout: 10000,
  });
  await expect(light).toHaveCSS("opacity", "1");
  const after = await centre(page);
  const shift = { x: after.x - before.x, y: after.y - before.y };
  // The drag's own distance, give or take what the chart coasted on after.
  expect(Math.abs(shift.x - by.x)).toBeLessThan(40);
  expect(Math.abs(shift.y - by.y)).toBeLessThan(40);
  expect(await painted(page, after)).toBe(0);
  expect(errors).toEqual([]);
});
