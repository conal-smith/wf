import { expect, test, type Page } from "./fixtures";
import { readSample } from "./sample";
import { SAMPLE_CLOCK } from "./columns";
import { tileOf } from "../force5/src/f5tile";

/**
 * The map reads its wind as tiles (force5/src/tiledField.ts): the level the
 * screen needs, and only the tiles in view. The e2e site's HARMONIE is the real
 * grid (scripts/sample-weather.mjs --site), so it has all three levels the
 * production run has: nine native tiles, four at level 1, one at level 2.
 */
const harmonie = readSample("harmonie");
// Where the site's owner put it (data/locations/owner-places.json).
const DOLLYMOUNT = { lat: 53.367583, lon: -6.144748 };

/** Every HARMONIE tile the page asks for, as [level, x, y, hour]. */
function tilesAsked(page: Page) {
  const asked: [number, number, number, number][] = [];
  page.on("request", (request) => {
    const found =
      /\/weather\/harmonie-[^/]+\/t\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(
        new URL(request.url()).pathname,
      );
    if (found)
      asked.push(
        found.slice(1).map(Number) as [number, number, number, number],
      );
  });
  return asked;
}

const places = (asked: [number, number, number, number][], level: number) => [
  ...new Set(
    asked.filter((tile) => tile[0] === level).map(([, x, y]) => `${x}/${y}`),
  ),
];

test("a phone showing all of Ireland asks for overview tiles only, and a bay for its own native tiles", async ({
  page,
}) => {
  expect(
    harmonie.tiles.levels.map((level: { level: number }) => level.level),
  ).toEqual([0, 1, 2]);
  await page.setViewportSize({ width: 390, height: 844 });
  const asked = tilesAsked(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  // The first frame and the next hour's are in.
  await expect.poll(() => asked.length, { timeout: 20000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  // All of Ireland on a phone: HARMONIE's cells are under 5 px at level 1, so
  // nothing native is fetched at all.
  expect(places(asked, 0)).toEqual([]);
  expect(places(asked, 1).length).toBeGreaterThan(0);
  expect(places(asked, 1).length).toBeLessThanOrEqual(4);
  const overview = asked.length;

  // Into Dublin Bay: native tiles now, and only the one or two in view.
  await page.locator('[data-spot-id="dollymount"]').dispatchEvent("click");
  await expect
    .poll(() => places(asked, 0).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  const native = places(asked, 0);
  const home = tileOf(harmonie.grid, 0, DOLLYMOUNT.lat, DOLLYMOUNT.lon)!;
  expect(native).toContain(`${home.x}/${home.y}`);
  expect(native.length).toBeLessThanOrEqual(2);
  // On the way in, nothing coarser was asked for but the one level-2 tile held
  // under the native ones as a base, and only for the hour on screen: a zoom
  // back out draws from it at once instead of leaving blank what the bay's
  // tiles do not cover.
  const coarser = asked.slice(overview).filter(([level]) => level !== 0);
  expect(coarser.every(([level]) => level === 2)).toBe(true);
  expect(new Set(coarser.map(([, x, y]) => `${x}/${y}`)).size).toBe(1);
  expect(new Set(coarser.map(([, , , hour]) => hour)).size).toBe(1);
  expect(coarser).toHaveLength(1);
  // Nine native tiles a frame exist; a bay costs a fraction of them.
  const nineAnHour = 9;
  const hoursAsked = new Set(
    asked.filter(([level]) => level === 0).map(([, , , hour]) => hour),
  );
  expect(asked.filter(([level]) => level === 0).length).toBeLessThan(
    nineAnHour * hoursAsked.size,
  );
});

test("a desktop showing all of Ireland asks for the native tiles and never an absent one", async ({
  page,
}) => {
  const asked = tilesAsked(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect
    .poll(() => places(asked, 0).length, { timeout: 20000 })
    .toBeGreaterThan(0);
  const absent = new Set(
    harmonie.tiles.levels.flatMap(
      (level: { level: number; absent: number[][] }) =>
        level.absent.map(([x, y]) => `${level.level}/${x}/${y}`),
    ),
  );
  expect(
    asked.filter(([level, x, y]) => absent.has(`${level}/${x}/${y}`)),
  ).toEqual([]);
});

test("the first frame the page asks for is the one it opens on", async ({
  page,
}) => {
  // The page used to ask for the run's first hour, and prefetch the second,
  // before it knew its opening time, then for the hour it opens on: the first
  // pair was thrown away on every load.
  await page.setViewportSize({ width: 390, height: 844 });
  const asked = tilesAsked(page);
  await page.clock.install({ time: SAMPLE_CLOCK });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect.poll(() => asked.length, { timeout: 20000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const hours = [...new Set(asked.map(([, , , hour]) => hour))];
  // The opening hour first, then the next, prefetched; nothing else.
  expect(hours).toHaveLength(2);
  expect(hours[0]).toBeGreaterThan(0);
  expect(hours[1]).toBe(
    harmonie.frames[
      harmonie.frames.findIndex(
        (frame: { hour: number }) => frame.hour === hours[0],
      ) + 1
    ].hour,
  );
});
