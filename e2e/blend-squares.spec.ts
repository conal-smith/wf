import { expect, test } from "./fixtures";
import { readSample } from "./sample";

/**
 * The published blend is a pointer and one file per 2° spot square
 * (src/spotBlend.ts). The map's lights read only the squares in view, once the
 * camera settles, so the page never downloads every place's blend at once.
 */
const SQUARE = /\/weather\/blend-[^/]+\/spots\/([ns]\d{2}[ew]\d{3})\.json$/;

test("the lights read the blend's squares in view, and nothing where the blend has none", async ({
  page,
}) => {
  // Its poll alone may take 30 s of the 45 s a test has: on a loaded runner
  // the page's own start left too little, so it gets the slow budget.
  test.slow();
  const pointer = readSample("blend");
  const squares: string[] = [];
  const pointers: unknown[] = [];
  const problems: string[] = [];
  page.on("response", async (response) => {
    const path = new URL(response.url()).pathname;
    const square = SQUARE.exec(path)?.[1];
    if (square) squares.push(square);
    if (path.endsWith("/weather/blend.json")) pointers.push(await response.json());
    if (path.includes("/weather/blend") && !response.ok())
      problems.push(`${path} answered ${response.status()}`);
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /blend|square|spots\//i.test(message.text()))
      problems.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?map");
  // All of Ireland is in view: every place rated, from Ireland's squares.
  await expect(page.locator(".spot-marker")).toHaveCount(149, { timeout: 30000 });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  // The pointer names the squares and carries no places of its own.
  expect(pointers).toHaveLength(1);
  expect(pointers[0]).toMatchObject({ schemaVersion: 2, spots: { keys: ["spotBlend"] } });
  expect(pointers[0]).not.toHaveProperty("spotBlend");
  expect([...new Set(squares)].sort()).toEqual(pointer.spots.squares);
  // Each square once: a square is immutable, and kept once read.
  expect(squares.length).toBe(new Set(squares).size);
  const read = squares.length;

  // Zoom in, then pan far to the south-east, over Brittany: a long way from
  // any square the blend lists.
  // The camera is at rest once a move has ended: through one the lights are
  // drawn on a canvas and their buttons wait where it last rested
  // (force5/src/lights.ts), so buttons that sit still say nothing of the
  // camera. (Waiting for frame-rate drawing instead never ends on CI's
  // software renderer at this zoom.)
  const atRest = () =>
    page.waitForFunction(
      () => !document.querySelector(".map-lights.is-moving"),
      null,
      { polling: 100, timeout: 30000 },
    );
  // Three steps in, each pressed once the last has ended, all in the page:
  // on CI's software renderer every frame of the chart settling is the whole
  // map drawn and read back, and a press from the test waited on it.
  await page
    .getByRole("button", { name: "Zoom in" })
    .evaluate(async (zoomIn: HTMLElement) => {
      const atRest = () =>
        new Promise<void>((resolve) => {
          const look = () =>
            document.querySelector(".map-lights.is-moving")
              ? setTimeout(look, 50)
              : resolve();
          look();
        });
      for (let i = 0; i < 3; i++) {
        zoomIn.click();
        await atRest();
      }
    });
  await atRest();
  // A drag in two strokes of two steps each: every step waits for a frame of
  // the map, and the chart goes where the pointer goes however many it takes.
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(1100, 650);
    await page.mouse.down();
    await page.mouse.move(700, 250, { steps: 2 });
    await page.mouse.move(300, 150, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  // Nowhere near a light now: every one is off the screen once the camera stops.
  const onScreen = () =>
    page.locator(".spot-marker").evaluateAll((markers) =>
      markers.filter((marker) => {
        const box = marker.getBoundingClientRect();
        return (
          box.right > 0 &&
          box.bottom > 0 &&
          box.left < window.innerWidth &&
          box.top < window.innerHeight
        );
      }).length,
    );
  await expect.poll(onScreen, { timeout: 30000 }).toBe(0);
  // Settled there, it has asked for nothing new, and nothing went wrong.
  await page.waitForTimeout(500);
  expect(squares.length).toBe(read);
  expect(problems).toEqual([]);
});
