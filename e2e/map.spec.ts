import {
  expect,
  rememberSpot,
  steadyFrames,
  test,
  type Page,
} from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { readSample } from "./sample";

const manifest = readSample("latest");
const harmonie = readSample("harmonie");

/** The chart, up: every light placed and rated, the dock drawn. */
export async function openChart(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(141, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator(".dock tr.tt-day td").first()).toBeVisible();
}

/** Find a spot by name and take the first result. */
export async function findSpot(page: Page, words: string, pick?: RegExp) {
  await page.getByRole("combobox", { name: "Find a spot" }).fill(words);
  const rows = page.locator(".spot-row");
  await (pick ? rows.filter({ hasText: pick }) : rows).first().click();
}

/** Somewhere on the chart with no light or box over it. */
async function openWater(page: Page) {
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  return page.evaluate((box) => {
    for (let y = 300; y < box.height - 360; y += 30)
      for (let x = 700; x > 120; x -= 30) {
        const hit = document.elementFromPoint(box.x + x, box.y + y);
        if (hit?.tagName === "CANVAS") return { x, y };
      }
    return { x: 600, y: 300 };
  }, box);
}

async function openLayers(page: Page) {
  const layers = page.getByRole("button", { name: "Layers", exact: true });
  if ((await layers.getAttribute("aria-expanded")) !== "true")
    await layers.click();
}

/** The model the map is drawing, from the layers panel. */
async function chooseModel(page: Page, id: string) {
  await openLayers(page);
  await page.locator(`[data-model="${id}"]`).click();
}

/** Which model the layers panel says is on the map. */
async function expectModel(page: Page, id: string) {
  await openLayers(page);
  await expect(page.locator(`[data-model="${id}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

test("the chart opens on paper: the head, the controls, the lights and a flush dock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openChart(page, 390, 844);
  await expect(page.locator(".map-loading")).toHaveCount(0);
  // The brand, not the old one: the wordmark, and no Force5 logo or glass.
  await expect(page.locator(".map-head")).toContainText("wingfoil.ie");
  await expect(page.locator(".force5-logo, .platform-brand, .glass")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Find a spot" })).toHaveAttribute(
    "placeholder",
    "Find a spot…",
  );
  for (const box of [".map-head", ".zbox", ".dock"]) {
    const filter = await page
      .locator(box)
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(filter === "none" || filter === "", box).toBe(true);
  }
  const dock = (await page.locator(".map-footer").boundingBox())!;
  expect(dock.x).toBe(0);
  expect(dock.width).toBe(390);
  expect(dock.y + dock.height).toBe(844);
  // A phone opens on the hours: the head, the week's days over the hours,
  // and no row of day blocks or folded state between them.
  expect(dock.height).toBeLessThan(844 / 3);
  await expect(page.locator(".dock tr.tt-day td")).toHaveCount(
    new Set(sampleStrip.map((c) => c.date)).size,
  );
  // Nothing else is on the chart: the rider's spots are behind the star.
  await expect(page.locator(".side")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Your spots", exact: true }),
  ).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expect(page.locator(".map-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the depths are one static file, read by range requests", async ({
  page,
}) => {
  const response = await page.request.get("/bathy/ireland.pmtiles", {
    headers: { Range: "bytes=0-126" },
  });
  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toMatch(/^bytes 0-126\/\d+$/);
  const head = await response.body();
  // A PMTiles v3 archive opens with its name and version.
  expect(head.subarray(0, 7).toString("latin1")).toBe("PMTiles");
  expect(head[7]).toBe(3);
  // And the chart asks for it through the protocol, not as a whole download.
  const ranged: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/bathy/ireland.pmtiles"))
      ranged.push(request.headers()["range"] ?? "none");
  });
  await openChart(page);
  await expect.poll(() => ranged.length).toBeGreaterThan(0);
  expect(ranged.every((range) => /^bytes=\d+-\d+$/.test(range))).toBe(true);
});

test("finding a spot flies there and focuses it, with no box over the map; Escape clears it", async ({
  page,
}) => {
  await openChart(page);
  const map = page.locator(".map-canvas");
  await expect(map).not.toHaveClass(/is-focus/);
  await findSpot(page, "Dollymount");
  await expect(map).toHaveClass(/is-focus/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
  // The other lights stay at full strength, to be compared with it.
  await expect
    .poll(() =>
      page
        .locator('[data-spot-id="brandon"] > svg')
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page
        .locator('[data-spot-id="dollymount"] > svg')
        .evaluate((el) => Number(getComputedStyle(el).opacity)),
    )
    .toBe(1);
  // The pen rings it and writes the day's best beside it.
  await expect(page.locator(".map-pen .map-pen-loop")).toHaveCount(1);
  // The wind stays at full strength.
  await expect(page.locator(".particle-canvas")).toHaveCSS("opacity", "1");

  await page.keyboard.press("Escape");
  await expect(map).not.toHaveClass(/is-focus/);

  // Clearing the focus is not choosing another place: the dock keeps it.
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
});

test("a tap on the open map reads that point's forecast into the dock, focused on it", async ({
  page,
}) => {
  await openChart(page);
  const map = page.locator(".map-canvas");
  await steadyFrames(page);
  const at = await openWater(page);
  await page.locator(".maplibregl-canvas").click({ position: at });
  // Named by the nearest place or its coordinates, with no star and no page.
  const name = page.locator(".dock .dk-name");
  await expect(name).not.toHaveText("Brandon Bay");
  await expect(page.locator(".dock .dk-head")).toContainText(
    /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/,
  );
  await expect(
    page.locator(".dock").getByRole("button", { name: /^Star / }),
  ).toHaveCount(0);
  await expect(page.locator(".dock [data-spot-page-link]")).toHaveCount(0);
  await expect(page.locator(".pick-mark")).toHaveCount(1);
  await expect(map).toHaveClass(/is-focus/);
  // Its hours fill from the map model's frames. No beach, so no stars.
  await expect
    .poll(() => page.locator(".dock tr.tt-wind td .kn").count(), {
      timeout: 30000,
    })
    .toBeGreaterThan(5);
  await expect(page.locator(".dock tr.tt-stars")).toHaveCount(0);
  await expect(page.locator(".dk-labs")).not.toContainText("Stars");
  // A double tap zooms and picks nothing.
  const before = await name.textContent();
  await page.locator(".maplibregl-canvas").dblclick({ position: { x: at.x + 40, y: at.y } });
  await page.waitForTimeout(500);
  await expect(name).toHaveText(before!);
  // Escape clears the focus, and a light chooses a riding place again.
  await page.keyboard.press("Escape");
  await expect(map).not.toHaveClass(/is-focus/);
  await findSpot(page, "Dollymount");
  await expect(name).toHaveText("Dollymount");
  await expect(page.locator(".pick-mark")).toHaveCount(0);
});

test("a light shows the selected hour's stars, as the dock does, and follows the time", async ({
  page,
}) => {
  await openChart(page);
  await findSpot(page, "Brandon");
  const light = page.locator('[data-spot-id="brandon"]');
  const slider = page.getByRole("slider", { name: "Forecast time" });
  // Through a few hours, day and night: the light's figure is the dock's
  // stars, and a dark hour's light is dark.
  for (const at of [2, 5, 9, 16, 30]) {
    if (at >= sampleStrip.length) continue;
    await slider.fill(String(at));
    const cell = page.locator(`.dock tr.tt-stars td[data-i="${at}"]`);
    await expect(cell).toHaveClass(/c-sel/);
    const stars0 = cell.locator(".hour-stars");
    const said = (await stars0.count())
      ? await stars0.getAttribute("aria-label")
      : null;
    const label = await light.getAttribute("aria-label");
    if (!said) {
      await expect(light).toHaveClass(/\bdark\b/);
      continue;
    }
    const stars = /(\d) of 5 star/.exec(said)?.[1] ?? "0";
    expect(label, `column ${at}`).toContain(
      stars === "1" ? "1 star" : `${stars} stars`,
    );
    await expect(light.locator(".lt-n")).toHaveText(stars);
  }
});

test("only offshore is struck through; a learner's cross-offshore is too", async ({
  page,
}) => {
  await openChart(page);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  // An hour with a struck light and a cross-offshore one, if the sample has it.
  let found = -1;
  for (let at = 0; at < sampleStrip.length && found < 0; at++) {
    await slider.fill(String(at));
    if (
      (await page.locator(".spot-marker.xoff").count()) > 0 &&
      (await page.locator(".spot-marker.off").count()) > 0
    )
      found = at;
  }
  expect(found).toBeGreaterThanOrEqual(0);
  for (const label of await page
    .locator(".spot-marker.off")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))))
    expect(label).toMatch(/, offshore$/);
  for (const label of await page
    .locator(".spot-marker.xoff")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))))
    expect(label).toMatch(/cross-offshore$/);
  const crossOff = await page
    .locator(".spot-marker.xoff")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.spotId));
  // The rider is learning: every cross-offshore hour is struck as well.
  await page
    .getByRole("button", { name: "Display options", exact: true })
    .click();
  await page.locator('[data-skill="beginner"]').click();
  await page.getByLabel("Close display options").click();
  await expect(page.locator(".spot-marker.xoff")).toHaveCount(0);
  for (const id of crossOff)
    await expect(page.locator(`[data-spot-id="${id}"]`)).toHaveClass(/\boff\b/);
});

test("switches the map's model from the layers and keeps the hour", async ({
  page,
}) => {
  await openChart(page);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.fill("3");
  await chooseModel(page, "icon-eu");
  await expectModel(page, "icon-eu");
  await expect(page.locator(".map-model")).toContainText(manifest.modelName);
  await expect(slider).toHaveValue("3");
  await chooseModel(page, "harmonie");
  await expectModel(page, "harmonie");
  await expect(page.locator(".map-model")).toContainText(harmonie.modelName);
  await expect(slider).toHaveValue("3");
});

test("a failed or mislabelled model download leaves the old model on the map", async ({
  page,
}) => {
  // Every live manifest is read on load and cached for five minutes, so fail
  // the target from the start; the page still opens on HARMONIE.
  await page.route("**/weather/latest.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await openChart(page);
  await chooseModel(page, "icon-eu");
  await expect(page.locator(".frame-status")).toContainText(
    "HARMONIE is still shown",
  );
  await expectModel(page, "harmonie");
  await page.unroute("**/weather/latest.json");
  await page.route("**/weather/latest.json", (route) =>
    route.fulfill({ json: harmonie }),
  );
  await chooseModel(page, "icon-eu");
  await expect(page.locator(".frame-status")).toContainText("does not match");
  await expectModel(page, "harmonie");
});

test("a model switch that fails or is cancelled cannot relabel what is drawn", async ({
  page,
}) => {
  const clock = Date.parse(harmonie.runTime) + 3600000;
  await page.clock.setFixedTime(new Date(clock));
  await openChart(page);
  await chooseModel(page, "icon-eu");
  await expectModel(page, "icon-eu");
  // An hour whose HARMONIE frame nothing has fetched yet.
  const noon = stripAt(clock).findIndex(
    (c) => c.validTime === "2026-09-14T12:00:00Z",
  );
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(noon));
  await expect(page.locator(".frame-status")).toHaveCount(0);
  // HARMONIE's tiles for that hour fail, so the switch cannot complete.
  const noonTiles = `**/weather/harmonie-*/t/*/*/*/${String(
    harmonie.frames.find(
      (f: { validTime: string }) => f.validTime === "2026-09-14T12:00:00Z",
    ).hour,
  ).padStart(3, "0")}.bin`;
  await page.route(noonTiles, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await chooseModel(page, "harmonie");
  await expect(page.locator(".frame-status")).toContainText(
    "ICON-EU is still shown",
  );
  await expectModel(page, "icon-eu");
  await page.unroute(noonTiles);
  await page.route(noonTiles, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await chooseModel(page, "harmonie");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(1100);
  await expectModel(page, "icon-eu");
  await expect(page.locator(".map-model")).toContainText("ICON-EU");
  await page.unroute(noonTiles);
  await chooseModel(page, "harmonie");
  await expectModel(page, "harmonie");
});

test("a missing frame keeps the map on its last good frame and offers a retry", async ({
  page,
}) => {
  await openChart(page);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  // A HARMONIE hour on the strip that is not the one already painted.
  const target = sampleStrip.findIndex(
    (c, at) =>
      at > 2 &&
      harmonie.frames.some(
        (f: { validTime: string }) => Date.parse(f.validTime) === c.time,
      ),
  );
  const broken = harmonie.frames.find(
    (f: { validTime: string }) =>
      Date.parse(f.validTime) === sampleStrip[target].time,
  );
  // Every tile of that hour: a frame is its tiles.
  const brokenTiles = `**/weather/${harmonie.base}t/*/*/*/${String(broken.hour).padStart(3, "0")}.bin`;
  await page.route(brokenTiles, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await slider.fill(String(target));
  await expect(page.locator(".frame-status.is-error")).toBeVisible();
  // The dock follows the reader to the hour they chose all the same.
  await expect(
    page.locator(`.dock tr.tt-hour td[data-i="${target}"]`),
  ).toHaveClass(/c-sel/);
  await page.unroute(brokenTiles);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(slider).toHaveValue(String(target));
});

test("a missing snapshot is actionable, and an expired one is labelled", async ({
  page,
}) => {
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("npm run weather:refresh");
  await page.unroute("**/weather/harmonie.json");
  await page.goto("/");
  await expect(page.locator(".map-model")).toHaveText(harmonie.modelName);
  await page.clock.install({ time: new Date("2030-01-01T12:00:00Z") });
  await page.goto("/");
  await expect(page.locator(".map-model")).toContainText("archived");
});

test("reduced motion keeps the arrows still, and the time keys still work", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openChart(page);
  await page.waitForTimeout(500);
  const drawn = await page
    .locator(".particle-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
      return count;
    });
  expect(drawn).toBe(0);
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
});

test("an unavailable basemap says so, and the dock still reads the forecast", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/planet", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  // A returning visitor's spot: the dock reads it with no basemap drawn.
  await rememberSpot(page, "brandon");
  await page.goto("/");
  await expect(page.locator(".map-error")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Reload map" })).toBeVisible();
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
  await expect
    .poll(() =>
      page.locator(".dock tr.tt-wind td .kn").count(),
    )
    .toBeGreaterThan(10);
});

test("a link that names a spot opens the chart on it", async ({ page }) => {
  await page.goto("/?spot=keel");
  await expect(page.locator(".dock .dk-name")).toHaveText("Keel Beach", {
    timeout: 30000,
  });
  await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
  await expect(page.locator('[data-spot-id="keel"]')).toHaveClass(/\bsel\b/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  void SAMPLE_CLOCK;
});
