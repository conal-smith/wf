import { closePanel, expect, openFromMenu, test, type Page } from "./fixtures";

/**
 * The loupe's ride rose (force5/src/focus.ts, drawn by WindMap.tsx): round the
 * chosen spot, at half a nautical mile, the headings the rider can hold at the
 * dock's hour, the no-go, the drift, the offshore winds and the needle.
 *
 * Dollymount's beach faces 125°. The hours are found in the sample
 * (scripts/sample-weather.mjs) as a rider would find them, by scrubbing the
 * dock: the first daylight hour whose wind is cross-shore, and the first that
 * is offshore, each with the rider's wind to ride; Sunday 22:00 is dark.
 */
test.use({ reducedMotion: "reduce" });

const DARK = "Sun 13 Sept, 22:00";
const MIDDAY = "Mon 14 Sept, 14:00";

const slider = (page: Page) =>
  page.getByRole("slider", { name: "Forecast time" });

/** The dock at an hour, by the words its slider says it in. */
async function hour(page: Page, when: string) {
  const s = slider(page);
  await s.press("Home");
  for (let i = 0; i < 120; i++) {
    if ((await s.getAttribute("aria-valuetext")) === when) return;
    await s.press("ArrowRight");
  }
  throw new Error(`The dock has no ${when}`);
}

/**
 * The first hour in the dock whose foot box names this shore relation and
 * whose glass has its fans (daylight, wind enough): what it reads, and when.
 */
async function firstHour(page: Page, relation: string) {
  const s = slider(page);
  await s.press("Home");
  const rose = page.locator(".map-focus .map-loupe");
  for (let i = 0; i < 160; i++) {
    const said = await rose.locator(".map-loupe-relation").textContent();
    if (said === relation && (await rose.locator(".map-rose-fan").count()))
      return (await rose.locator(".map-loupe-reading").textContent())!;
    const was = await s.inputValue();
    await s.press("ArrowRight");
    if ((await s.inputValue()) === was) break;
  }
  throw new Error(`No ${relation} hour with wind to ride`);
}

/** The spot's link, with the loupe chosen round it (the range ring is the default). */
async function open(page: Page, spot: string, width = 1440, height = 900) {
  await page.addInitScript(() =>
    localStorage.setItem("wingfoil.map.focus.v1", "loupe"),
  );
  await page.setViewportSize({ width, height });
  await page.goto(`/?spot=${spot}`);
  await expect(page.locator(".map-focus")).toHaveAttribute(
    "data-focus",
    "loupe",
    { timeout: 30000 },
  );
  await expect(page.locator(".map-loupe-foot")).toBeVisible({
    timeout: 30000,
  });
}

const rose = (page: Page) => page.locator(".map-focus .map-loupe");
const labels = (page: Page) =>
  rose(page).locator(".map-rose-label").allTextContents();
/** The glass's radius on the screen. */
const radius = (page: Page) =>
  page
    .locator(".map-loupe-edge.is-inner")
    .evaluate((el) => el.getBoundingClientRect().width / 2);

test("Dollymount's cross-shore hour: the no-go, out and home, and the wind at the foot", async ({
  page,
}) => {
  await open(page, "dollymount");
  const reading = await firstHour(page, "CROSS");
  const r = rose(page);
  expect(reading).toMatch(/^[NESW]{1,3} \d+( g\d+)?$/);
  await expect(r.locator(".map-loupe-relation")).toHaveText("CROSS");
  await expect(r.locator(".map-loupe-relation")).not.toHaveClass(/is-warn/);
  // The no-go upwind, hatched; the tack out washed to the rim; the tack home.
  await expect(r.locator(".map-rose-nogo")).toHaveCount(1);
  await expect(
    r.locator(".map-rose-fan.is-out .map-rose-fan-fill"),
  ).toHaveCount(1);
  await expect(r.locator(".map-rose-fan.is-home")).toHaveCount(1);
  const words = await labels(page);
  expect(words).toEqual(
    expect.arrayContaining([
      "NO-GO",
      "OUT",
      "HOME",
      "DRIFT",
      "0.5 NM",
      "0.25 NM",
    ]),
  );
  // Bearings to 5°, said as about, never to the degree.
  const bearings = words.filter((w) => /°$/.test(w));
  expect(bearings).toHaveLength(2);
  for (const b of bearings) {
    const [from, to] = b.replace("°", "").split("–").map(Number);
    expect(from % 5).toBe(0);
    expect(to % 5).toBe(0);
  }
  // A north-easterly drifts a rider along the beach, not out: in ink.
  await expect(r.locator(".map-rose-drift")).not.toHaveClass(/is-out/);
  // The offshore winds for this beach are red on the bezel; the needle is the
  // wind's colour, the only one in the glass.
  await expect(r.locator(".map-dial-offshore")).toHaveCount(1);
  await expect(r.locator(".map-dial-words")).toHaveText("OFFSHORE");
  await expect(r.locator(".map-dial-needle path")).toHaveAttribute(
    "fill",
    /^rgb\(/,
  );
  // The light's own small wedge goes while the rose says the same, bigger.
  await expect(
    page.locator('[data-spot-id="dollymount"] .lt-wedge path'),
  ).not.toHaveAttribute("d", /A/);

  // It follows the dock: back at the start, another hour's reading.
  await slider(page).press("Home");
  await expect(r.locator(".map-loupe-reading")).not.toHaveText(reading);

  // Half a nautical mile with knots; a kilometre with km/h, a little larger.
  const before = await radius(page);
  await openFromMenu(page, "Display options");
  await page.locator('[data-units="km/h"]').click();
  await closePanel(page);
  await expect
    .poll(() => labels(page))
    .toEqual(expect.arrayContaining(["1 km", "500 m"]));
  expect((await radius(page)) / before).toBeCloseTo(1000 / 926, 1);
  await expect(r.locator(".map-loupe-reading")).toHaveText(/^\w+ \d+( g\d+)?$/);
});

test("an offshore hour: the drift out to sea in red, and no way out or home", async ({
  page,
}) => {
  await open(page, "dollymount");
  const reading = await firstHour(page, "OFF");
  const r = rose(page);
  // Offshore at Dollymount is a wind from the west to the north.
  expect(reading).toMatch(/^(W|WNW|NW|NNW) \d+/);
  await expect(r.locator(".map-loupe-relation")).toHaveText("OFF");
  await expect(r.locator(".map-loupe-relation")).toHaveClass(/is-warn/);
  await expect(r.locator(".map-rose-drift")).toHaveClass(/is-out/);
  await expect(r.locator(".map-rose-label.is-warn")).toHaveText([
    "DRIFT",
    "OUT TO SEA",
  ]);
  // Nothing heads out in an offshore wind: two plain reaches.
  await expect(r.locator(".map-rose-fan.is-out")).toHaveCount(0);
  await expect(r.locator(".map-rose-fan.is-home")).toHaveCount(0);
  await expect(r.locator(".map-rose-fan.is-reach")).toHaveCount(2);
  // The needle sits in the red.
  await expect(r.locator(".map-dial-needle")).toHaveCount(1);
});

test("in the dark, only the wind: the needle, the reading and the red", async ({
  page,
}) => {
  await open(page, "dollymount");
  await hour(page, DARK);
  const r = rose(page);
  await expect(r.locator(".map-loupe-reading")).toHaveText(/^WSW \d+/);
  await expect(r.locator(".map-rose-nogo")).toHaveCount(0);
  await expect(r.locator(".map-rose-fan")).toHaveCount(0);
  await expect(r.locator(".map-rose-drift")).toHaveCount(0);
  await expect(r.locator(".map-dial-needle")).toHaveCount(1);
  await expect(r.locator(".map-dial-offshore")).toHaveCount(1);
});

test("a spot with no shore facing: no red, no out or home, the needle and the reading", async ({
  page,
}) => {
  // Malahide Estuary's facing is null (data/locations/shore-facing.json).
  await open(page, "malahide-estuary");
  await hour(page, MIDDAY);
  const r = rose(page);
  await expect(r.locator(".map-dial-needle")).toHaveCount(1);
  await expect(r.locator(".map-loupe-reading")).toHaveText(/^\w+ \d+( g\d+)?$/);
  // With no beach, the units where the shore would be.
  await expect(r.locator(".map-loupe-relation")).toHaveText("KN");
  await expect(r.locator(".map-dial-offshore")).toHaveCount(0);
  await expect(r.locator(".map-dial-crossoff")).toHaveCount(0);
  await expect(r.locator(".map-rose-fan.is-out")).toHaveCount(0);
  await expect(r.locator(".map-rose-fan.is-home")).toHaveCount(0);
  await expect(r.locator(".map-rose-drift")).not.toHaveClass(/is-out/);
  expect(await labels(page)).not.toContain("OUT");
});

test("on a phone the rose fits above the dock, and stays readable zoomed out or in", async ({
  page,
}) => {
  await open(page, "dollymount", 390, 844);
  const reading = await firstHour(page, "CROSS");
  const r = rose(page);
  // Flown in to fit: the bezel inside the screen's width, its foot box above the dock.
  const rim = await page
    .locator(".map-loupe-edge:not(.is-inner)")
    .boundingBox();
  expect(rim!.x).toBeGreaterThanOrEqual(0);
  expect(rim!.x + rim!.width).toBeLessThanOrEqual(390);
  const foot = await r.locator(".map-loupe-foot-box").boundingBox();
  const dock = await page.locator(".dock").boundingBox();
  expect(foot!.y + foot!.height).toBeLessThanOrEqual(dock!.y);
  await expect(r.locator(".map-rose-fan.is-out")).toHaveCount(1);
  await expect(r.locator(".map-loupe-reading")).toHaveText(reading);

  // Zoomed far out the rose is held at its smallest: no fans, the wind stays.
  const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
  for (let i = 0; i < 4; i++) await zoomOut.click();
  await expect(r.locator(".map-rose-fan")).toHaveCount(0);
  await expect(r.locator(".map-rose-nogo")).toHaveCount(0);
  await expect(r.locator(".map-dial-needle")).toHaveCount(1);
  await expect.poll(() => radius(page)).toBeCloseTo(70, 0);
  expect(await labels(page)).not.toContain("0.5 NM");

  // Zoomed all the way in the bezel runs off the screen; the box stays in view.
  const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
  for (let i = 0; i < 6; i++) await zoomIn.click();
  await expect.poll(() => radius(page)).toBeGreaterThan(195);
  const pinned = await r.locator(".map-loupe-foot-box").boundingBox();
  const dockNow = await page.locator(".dock").boundingBox();
  expect(pinned!.y + pinned!.height).toBeLessThanOrEqual(dockNow!.y);
  expect(pinned!.x).toBeGreaterThanOrEqual(0);
  expect(pinned!.x + pinned!.width).toBeLessThanOrEqual(390);
});

test("degrees into the wind: set in Customise, they move the no-go, and are kept", async ({
  page,
}) => {
  await open(page, "dollymount");
  await firstHour(page, "CROSS");
  const bearings = async () => (await labels(page)).filter((w) => /°$/.test(w));
  const riding = await bearings();
  expect(riding).toHaveLength(2);
  // Past the course, downwind, is drawn faintly along the rim.
  await expect(rose(page).locator(".map-rose-slow")).toHaveCount(1);

  // Display options no longer carry it: Customise is where the rider says.
  await openFromMenu(page, "Display options");
  await expect(page.getByText("Pointing upwind")).toHaveCount(0);
  await closePanel(page);

  const upwind = async () => {
    await openFromMenu(page, "Customise");
    const wizard = page.getByRole("dialog", { name: "Customise" });
    await wizard.getByRole("button", { name: "Upwind", exact: true }).click();
    return wizard;
  };
  const wizard = await upwind();
  await expect(wizard.locator("[data-upwind] output")).toHaveText("20°");
  await wizard
    .getByRole("group", { name: "Can you ride upwind?" })
    .getByRole("button", { name: /^Not yet/ })
    .click();
  await wizard.getByRole("button", { name: "Done", exact: true }).click();
  await wizard.getByRole("button", { name: "Show me the chart" }).click();
  await expect(wizard).toHaveCount(0);

  // Straight across the wind: each course's upwind edge drops 20°, to 90°
  // off the wind, and its deep edge stays at 120°.
  await expect.poll(bearings).not.toEqual(riding);
  const across = await bearings();
  const span = (b: string) => {
    const [from, to] = b.replace("°", "").split("–").map(Number);
    return (to - from + 360) % 360;
  };
  for (let i = 0; i < 2; i++)
    expect(span(across[i])).toBeLessThan(span(riding[i]));

  // Kept on the device, with the weight and the level.
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("force5.prefs.v1")!).rider.upwind,
    ),
  ).toBe(0);
  await page.reload();
  await expect(page.locator(".map-loupe-foot")).toBeVisible({ timeout: 30000 });
  const again = await upwind();
  await expect(again.locator("[data-upwind] output")).toHaveText("0°");
});
