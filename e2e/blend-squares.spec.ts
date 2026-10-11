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
  await page.goto("/");
  // All of Ireland is in view: every place rated, from Ireland's squares.
  await expect(page.locator(".spot-marker")).toHaveCount(146, { timeout: 30000 });
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
  // The camera is at rest when the markers sit still: two readings a quarter
  // second apart agree. (Waiting for frame-rate drawing instead never ends on
  // CI's software renderer at this zoom.)
  const markers = () =>
    page.locator(".spot-marker").evaluateAll((all) =>
      all.slice(0, 8).map((marker) => {
        const box = marker.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)}`;
      }).join(" "),
    );
  const atRest = async () => {
    const first = await markers();
    await page.waitForTimeout(250);
    return first === (await markers());
  };
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 3; i++) {
    await zoomIn.click();
    await page.waitForTimeout(400);
  }
  await expect.poll(atRest, { timeout: 30000 }).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(1100, 650);
    await page.mouse.down();
    await page.mouse.move(700, 250, { steps: 8 });
    await page.mouse.move(300, 150, { steps: 8 });
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
