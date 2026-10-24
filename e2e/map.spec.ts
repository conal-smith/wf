import {
  backToIreland,
  chooseSpot,
  closePanel,
  expect,
  openFromMenu,
  setRider,
  steadyFrames,
  test,
  type Page,
} from "./fixtures";
import { SAMPLE_CLOCK, sampleStrip, stripAt } from "./columns";
import { readSample } from "./sample";
import { readFileSync } from "node:fs";

const manifest = readSample("latest");
/**
 * The bathymetry's versioned path on the data host (chartStyle.ts, written by
 * scripts/foildepth/publish.py); the e2e site serves it from public-data/.
 */
const BATHY_PATH = /BATHY_PATH = "([^"]+)"/.exec(
  readFileSync("force5/src/chartStyle.ts", "utf8"),
)![1];
const harmonie = readSample("harmonie");

/**
 * The chart, up: every light placed and rated, then `spot` chosen with a tap
 * on its light and its dock drawn; with null, nothing chosen and no dock.
 * The tap flies the chart to the spot, and these specs read every light on
 * the whole of Ireland, so the chart goes back to it (`backToIreland`).
 */
export async function openChart(
  page: Page,
  width = 1440,
  height = 900,
  spot: string | null = "brandon",
) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  if (!spot) {
    await expect(page.locator(".dock")).toHaveCount(0);
    return;
  }
  await chooseSpot(page, spot);
  await backToIreland(page);
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
  if (!(await page.getByRole("dialog", { name: "Layers" }).isVisible()))
    await openFromMenu(page, "Layers");
}

/** The model the map is drawing, from the layers panel, shut after. */
async function chooseModel(page: Page, id: string) {
  await openLayers(page);
  await page.locator(`[data-model="${id}"]`).click();
  await closePanel(page);
}

/** Which model the layers panel says is on the map. */
async function expectModel(page: Page, id: string) {
  await openLayers(page);
  await expect(page.locator(`[data-model="${id}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await closePanel(page);
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
  await expect(
    page.locator(".force5-logo, .platform-brand, .glass"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Find a spot" }),
  ).toHaveAttribute("placeholder", "Find a spot…");
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
  // A phone opens on the remembered spot's hours: the head, the week's days
  // over the hours, and no row of day blocks or folded state between them.
  expect(dock.height).toBeLessThan(844 / 3);
  await expect(page.locator(".dock tr.tt-day td")).toHaveCount(
    new Set(sampleStrip.map((c) => c.date)).size,
  );
  // Nothing else is on the chart: the rider's spots are in the menu.
  await expect(page.locator(".side")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Site menu" })).toBeVisible();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await expect(slider).toHaveAttribute("max", String(sampleStrip.length - 1));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".map-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the depths are one static file, read by range requests", async ({
  page,
}) => {
  const response = await page.request.get(`/${BATHY_PATH}`, {
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
    if (request.url().includes(`/${BATHY_PATH}`))
      ranged.push(request.headers()["range"] ?? "none");
  });
  await openChart(page);
  await expect.poll(() => ranged.length).toBeGreaterThan(0);
  expect(ranged.every((range) => /^bytes=\d+-\d+$/.test(range))).toBe(true);
});

test("finding a spot flies there and focuses it, with no box over the map; Escape clears it", async ({
  page,
}) => {
  await openChart(page, 1440, 900, null);
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
  // The pen rings it and writes nothing beside it: the dock has the hour.
  await expect(page.locator(".map-pen .map-pen-loop")).toHaveCount(1);
  await expect(page.locator(".map-pen text")).toHaveCount(0);
  // A range ring is drawn round it, by default, under the lights.
  await expect(page.locator(".map-focus")).toHaveAttribute(
    "data-focus",
    "ring",
  );
  await expect(page.locator(".map-focus .map-range-label")).toHaveText(
    /^[\d.]+ NM$/,
  );
  // The wind stays at full strength.
  await expect(page.locator(".particle-canvas")).toHaveCSS("opacity", "1");

  await page.keyboard.press("Escape");
  await expect(map).not.toHaveClass(/is-focus/);
  await expect(page.locator(".map-focus")).toHaveAttribute("data-focus", "off");
  await expect(page.locator(".map-focus > *")).toHaveCount(0);

  // Clearing the focus is not choosing another place: the dock keeps it.
  await expect(page.locator(".dock .dk-name")).toHaveText("Dollymount");
});

test("a tap on the open map reads that point's forecast into the dock, focused on it", async ({
  page,
}) => {
  await openChart(page, 1440, 900, null);
  const map = page.locator(".map-canvas");
  await steadyFrames(page);
  const at = await openWater(page);
  await page.locator(".maplibregl-canvas").click({ position: at });
  // Named by the nearest place or its coordinates, with no star and no page.
  const name = page.locator(".dock .dk-name");
  await expect(name).not.toHaveText("Brandon Bay");
  await expect(page.locator(".dock .dk-tools")).toContainText(
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
  await page
    .locator(".maplibregl-canvas")
    .dblclick({ position: { x: at.x + 40, y: at.y } });
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

test("a click just off a light's ring chooses it, and the nearest light wins", async ({
  page,
}) => {
  await openChart(page, 1440, 900, null);
  // A light with room round it, and a point a little way off its ring.
  const { id, x, y } = await page.evaluate(() => {
    const lights = [...document.querySelectorAll<HTMLElement>(".spot-marker")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.spotId!,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
        };
      })
      .filter((l) => l.y > 300 && l.y < 700);
    const alone = lights.find((l) =>
      lights.every((o) => o === l || Math.hypot(o.x - l.x, o.y - l.y) > 40),
    )!;
    return { id: alone.id, x: alone.x, y: alone.y + 13 };
  });
  expect(
    await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x, y)
          ?.closest(".spot-marker")
          ?.getAttribute("data-spot-id"),
      [x, y],
    ),
  ).toBe(id);
  await page.mouse.click(x, y);
  await expect(page.locator(".spot-marker.sel")).toHaveAttribute(
    "data-spot-id",
    id,
  );
  await expect(page.locator(".pick-mark")).toHaveCount(0);
});

test("a light's wind and its name follow the rider's units", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("force5.prefs.v1", JSON.stringify({ units: "m/s" })),
  );
  await openChart(page, 1440, 900, null);
  const light = page.locator('[data-spot-id="brandon"]');
  const label = await light.getAttribute("aria-label");
  const said = / (\d+) metres per second/.exec(label ?? "");
  expect(said, label ?? "").not.toBeNull();
  expect(label).not.toContain("knots");
  // The figure beside the light is the same speed, in the same units.
  await expect(light.locator(".lt-lab i")).toHaveText(
    new RegExp(`^[NESW]+ ${said![1]}\\b`),
  );
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
  // The rider is learning, as Customise saves one: every cross-offshore
  // hour is struck as well.
  await setRider(page, { skill: "beginner" });
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
  await page.getByRole("slider", { name: "Forecast time" }).fill(String(noon));
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
  await expect(page.getByRole("alert")).toContainText(
    "npm run weather:refresh",
  );
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
  // A spot in the link: the dock reads it with no basemap drawn.
  await page.goto("/?spot=brandon");
  await expect(page.locator(".map-error")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Reload map" })).toBeVisible();
  await expect(page.locator(".dock .dk-name")).toHaveText("Brandon Bay");
  await expect
    .poll(() => page.locator(".dock tr.tt-wind td .kn").count())
    .toBeGreaterThan(10);
});

test("round the chosen spot: a range ring, a loupe at a true distance, or nothing, kept as chosen", async ({
  page,
}) => {
  await openChart(page, 1440, 900, null);
  // The range ring by default; the loupe, from the layers.
  await openFromMenu(page, "Layers");
  const panel = page.getByRole("group", { name: "Layers" });
  const choice = panel.getByRole("group", { name: "Round your spot" });
  await expect(
    choice.getByRole("button", { name: "Range ring" }),
  ).toHaveAttribute("aria-pressed", "true");
  await choice.getByRole("button", { name: "Loupe" }).click();
  await closePanel(page);
  await findSpot(page, "Dollymount");
  const map = page.locator(".map-canvas");
  const focus = page.locator(".map-focus");
  await expect(map).toHaveClass(/is-focus/);
  await expect(focus).toHaveAttribute("data-focus", "loupe");
  // The glass is a distance on the chart, flown in to fill the clear map:
  // zooming out once halves it.
  const rim = () =>
    page
      .locator(".map-loupe-edge.is-inner")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  /** The rim's width once the camera has stopped. */
  const steady = async () => {
    let last = -1;
    await expect
      .poll(
        async () => {
          const now = await rim();
          const same = now === last;
          last = now;
          return same;
        },
        { intervals: [400], timeout: 15000 },
      )
      .toBe(true);
    return last;
  };
  // The flight climbs out before it comes in: wait for it to arrive.
  await expect.poll(rim, { timeout: 15000 }).toBeGreaterThanOrEqual(300);
  const wide = await steady();
  expect(wide).toBeGreaterThanOrEqual(300);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(rim).toBeLessThan(wide * 0.6);
  const further = await steady();
  expect(further / wide).toBeGreaterThan(0.45);
  expect(further / wide).toBeLessThan(0.55);

  // Back to the range ring.
  await openFromMenu(page, "Layers");
  await expect(choice.getByRole("button", { name: "Loupe" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await choice.getByRole("button", { name: "Range ring" }).click();
  await expect(focus).toHaveAttribute("data-focus", "ring");
  await expect(focus.locator(".map-loupe-rim")).toHaveCount(0);
  await expect(focus.locator(".map-range-label")).toHaveText(/^[\d.]+ NM$/);
  // Nothing at all: the pen's ring alone marks the spot.
  await choice.getByRole("button", { name: "Nothing", exact: true }).click();
  await expect(focus).toHaveAttribute("data-focus", "off");
  await expect(focus.locator("*")).toHaveCount(0);
  await expect(page.locator(".map-pen .map-pen-loop")).toHaveCount(1);
  await expect(map).toHaveClass(/is-focus/);
  await closePanel(page);

  // Kept for the next visit, which opens on the chart alone: at `/`, as the
  // reload of a chosen spot's own link (`/?spot=brandon`) opens on it.
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  await expect(page.locator(".dock")).toHaveCount(0);
  await openFromMenu(page, "Layers");
  await expect(
    choice.getByRole("button", { name: "Nothing", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await findSpot(page, "Brandon");
  await expect(map).toHaveClass(/is-focus/);
  await expect(focus).toHaveAttribute("data-focus", "off");
  await expect(focus.locator("*")).toHaveCount(0);
});

/**
 * From now on, at every frame the chart moves in: how far the mark round the
 * spot (`mark`, a circle centred on it) stands from the spot's light, which
 * MapLibre moves in the frame it draws the chart.
 */
async function followMark(page: Page, id: string, mark: string) {
  await page.evaluate(
    ([id, mark]) => {
      const light = document.querySelector(
        `.spot-marker[data-spot-id="${id}"]`,
      )!;
      const centre = (el: Element) => {
        const r = el.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      };
      const gap = () => {
        const [lx, ly] = centre(light);
        const [mx, my] = centre(document.querySelector(mark)!);
        return [mx - lx, my - ly];
      };
      const w = window as unknown as { __gaps: number[][]; __rest: number[] };
      w.__rest = gap();
      w.__gaps = [];
      new MutationObserver(() => w.__gaps.push(gap())).observe(light, {
        attributes: true,
        attributeFilter: ["style"],
      });
    },
    [id, mark],
  );
}

test("the mark round a chosen spot moves with the chart, in the same frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [style, mark] of [
    ["ring", ".map-range-line"],
    ["loupe", ".map-loupe-edge.is-inner"],
  ]) {
    await page.addInitScript(
      (style) => localStorage.setItem("wingfoil.map.focus.v1", style),
      style,
    );
    await page.goto("/?spot=dollymount");
    await expect(page.locator(mark)).toHaveCount(1, { timeout: 30000 });
    // Flown in and at rest.
    await page.waitForTimeout(2500);
    await steadyFrames(page);
    await followMark(page, "dollymount", mark);
    // A drag from open chart, then a zoom out and in.
    const from = await page.evaluate(() => {
      for (let y = 150; y < 600; y += 37)
        for (let x = 200; x < 1200; x += 41)
          if (
            document
              .elementFromPoint(x, y)
              ?.classList.contains("maplibregl-canvas")
          )
            return { x, y };
      return null;
    });
    expect(from).not.toBeNull();
    // Five steps to the drag: each waits for a frame of the chart, on CI's
    // software renderer the whole map drawn and read back, and five frames
    // of a drag are as many readings as twenty.
    await page.mouse.move(from!.x, from!.y);
    await page.mouse.down();
    await page.mouse.move(from!.x - 160, from!.y - 90, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    // Pressed in the page: a click's checks that the button stands still
    // wait on those frames too, for a button that never moves.
    const press = (name: string) =>
      page
        .getByRole("button", { name, exact: true })
        .evaluate((button: HTMLElement) => button.click());
    await press("Zoom out");
    await page.waitForTimeout(1200);
    await press("Zoom in");
    await page.waitForTimeout(1200);
    const { rest, gaps } = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[][]; __rest: number[] };
      return { rest: w.__rest, gaps: w.__gaps };
    });
    expect(gaps.length).toBeGreaterThan(5);
    const worst = Math.max(
      ...gaps.map(([x, y]) => Math.hypot(x - rest[0], y - rest[1])),
    );
    expect(worst, `${style}: px off the spot in a frame`).toBeLessThan(1);
  }
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

test("a light off the chart keeps its stars and wind in its name while a spot is open", async ({
  page,
}) => {
  await openChart(page, 1440, 900, null);
  const far = page.locator('[data-spot-id="dollymount"]');
  const summary =
    /^Dollymount, Dublin: \d\d:\d\d (dark|\d stars?), [NESW]+ \d+ knots/;
  await expect(far).toHaveAttribute("aria-label", summary);
  // Brandon's forecast flies the chart to Kerry, off Dollymount's square.
  await chooseSpot(page, "brandon");
  await expect(page.locator(".map-canvas")).toHaveClass(/is-focus/);
  await page.waitForTimeout(2000);
  await expect(far).toHaveAttribute("aria-label", summary);
  // And at another hour, from the same run.
  await page.getByRole("slider", { name: "Forecast time" }).fill("10");
  await expect(far).toHaveAttribute("aria-label", summary);
});

/*
 * A press on the chart (#109). With a panel or a menu open over it, it shuts
 * that and does nothing else. With nothing open and a spot or a point chosen,
 * it lets go of it, as Escape does, and moves nothing; a light still chooses
 * its spot. Only with nothing chosen does it pick the point under it.
 */
for (const device of [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  {
    name: "phone",
    use: {
      viewport: { width: 393, height: 852 },
      isMobile: true,
      hasTouch: true,
    },
  },
]) {
  test.describe(`a press on the chart, on a ${device.name}`, () => {
    test.use(device.use);
    const touch = "hasTouch" in device.use;
    const press = (page: Page, at: { x: number; y: number }) =>
      touch ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y);
    /** Somewhere on the chart with no light and no box over it. */
    const clear = async (page: Page) => {
      const at = await page.evaluate(() => {
        for (let y = 160; y < innerHeight - 80; y += 20)
          for (let x = 40; x < innerWidth - 40; x += 20)
            if (
              document
                .elementFromPoint(x, y)
                ?.classList.contains("maplibregl-canvas")
            )
              return { x, y };
        return null;
      });
      expect(at).not.toBeNull();
      return at!;
    };
    /** The middle of a light other than `not` with nothing over it, if any. */
    const lightAt = (page: Page, not: string) =>
      page.evaluate((not) => {
        for (const light of document.querySelectorAll<HTMLElement>(
          ".spot-marker",
        )) {
          const r = light.getBoundingClientRect();
          const x = r.x + r.width / 2;
          const y = r.y + r.height / 2;
          const id = light.dataset.spotId!;
          if (
            id !== not &&
            y > 160 &&
            document.elementFromPoint(x, y)?.closest(".spot-marker") === light
          )
            return { id, x, y };
        }
        return null;
      }, not);
    const aLight = async (page: Page, not: string) => {
      const at = await lightAt(page, not);
      expect(at).not.toBeNull();
      return at!;
    };
    /**
     * The dimmed map beside an open panel's dialog, off its box: to its left,
     * or above it where it spans the width, as the Layers sheet does.
     */
    const backdrop = async (page: Page) => {
      const box = await page.locator("dialog.map-panel-dialog").boundingBox();
      expect(box).not.toBeNull();
      if (box!.x >= 8) return { x: box!.x / 2, y: box!.y + box!.height / 2 };
      expect(box!.y).toBeGreaterThanOrEqual(8);
      return { x: box!.x + box!.width / 2, y: box!.y / 2 };
    };
    const dockName = (page: Page) => page.locator(".dock .dk-name");
    const coords = /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/;
    /** A spot from a link, the chart flown to it and at rest. */
    const openOn = async (page: Page, id: string, name: string) => {
      await page.goto(`/?spot=${id}`);
      await expect(dockName(page)).toHaveText(name, { timeout: 30000 });
      await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
        timeout: 30000,
      });
      await steadyFrames(page);
      await page.waitForTimeout(2500);
    };

    if (touch) {
      // A finger on the screen, the suite's only tap on the chart: the
      // sheet, the spot and the point in turn. The desktop's tests below go
      // through every case.
      test("a tap shuts the Layers sheet and picks nothing, then lets go of the spot, then picks the point", async ({
        page,
      }) => {
        await openOn(page, "keel", "Keel Beach");
        const map = page.locator(".map-canvas");
        // The sheet spans the width: the tap lands on the dimmed map above.
        await openFromMenu(page, "Layers");
        await press(page, await backdrop(page));
        await expect(page.getByRole("dialog", { name: "Layers" })).toHaveCount(
          0,
        );
        await page.waitForTimeout(800);
        await expect(dockName(page)).toHaveText("Keel Beach");
        await expect(page).toHaveURL(/\/\?spot=keel$/);
        await expect(map).toHaveClass(/is-focus/);
        await expect(page.locator(".pick-mark")).toHaveCount(0);
        // One tap lets go of Keel, and picks no point where it was.
        const at = await clear(page);
        await press(page, at);
        await expect(map).not.toHaveClass(/is-focus/);
        await page.waitForTimeout(800);
        await expect(dockName(page)).toHaveText("Keel Beach");
        await expect(page.locator(".pick-mark")).toHaveCount(0);
        // With nothing chosen, the next tap picks the point.
        await press(page, at);
        await expect(page.locator(".dock .dk-tools")).toContainText(coords);
        await expect(page.locator(".pick-mark")).toHaveCount(1);
      });
      return;
    }

    test("a press with a panel or a menu open shuts it, and picks and chooses nothing", async ({
      page,
    }) => {
      await openOn(page, "keel", "Keel Beach");
      const map = page.locator(".map-canvas");
      /** A moment past the tap's wait, and Keel as it was. */
      const unmoved = async () => {
        await page.waitForTimeout(800);
        await expect(dockName(page)).toHaveText("Keel Beach");
        await expect(page).toHaveURL(/\/\?spot=keel$/);
        await expect(map).toHaveClass(/is-focus/);
        await expect(page.locator(".pick-mark")).toHaveCount(0);
      };
      // The panels are modal: the press lands on the dimmed map round them.
      // Layers stands for them all here; your spots' and the display
      // options' own tests press round those.
      await openFromMenu(page, "Layers");
      await press(page, await backdrop(page));
      await expect(page.getByRole("dialog", { name: "Layers" })).toHaveCount(0);
      await unmoved();
      const menu = page.getByRole("button", { name: "Site menu" });
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await press(page, await clear(page));
      await expect(menu).toHaveAttribute("aria-expanded", "false");
      await unmoved();
      // The search's list of spots, as the reader types.
      await page.getByRole("combobox", { name: "Find a spot" }).fill("Bran");
      await expect(page.locator(".find .results")).toBeVisible();
      await press(page, await clear(page));
      await expect(page.locator(".find .results")).toHaveCount(0);
      await unmoved();

      // With nothing chosen, the same: the panel shuts and no point is
      // picked, nor a light under the dimmed map round it.
      await page.goto("/");
      await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
        timeout: 30000,
      });
      await steadyFrames(page);
      const none = async () => {
        await page.waitForTimeout(800);
        await expect(page.locator(".dock")).toHaveCount(0);
        await expect(page.locator(".pick-mark")).toHaveCount(0);
        await expect(page.locator(".spot-marker.sel")).toHaveCount(0);
        await expect(page).toHaveURL(/\/$/);
      };
      await openFromMenu(page, "Layers");
      await press(page, await backdrop(page));
      await expect(page.getByRole("dialog", { name: "Layers" })).toHaveCount(0);
      await none();
      // Shut, the chart is the reader's again: a press picks its point.
      await press(page, await clear(page));
      await expect(page.locator(".dock .dk-tools")).toContainText(coords);
      await expect(page.locator(".pick-mark")).toHaveCount(1);
    });

    test("a press with a spot or a point chosen lets go of it rather than move it", async ({
      page,
    }) => {
      // A spot, a point and two lights chosen in turn, each after the frames
      // settle: on a shared CI runner it passed every step and ran out of the
      // default time on the last.
      test.slow();
      await openOn(page, "keel", "Keel Beach");
      const map = page.locator(".map-canvas");
      const keel = page.locator('[data-spot-id="keel"]');
      // A double click zooms, and lets go of nothing.
      const twice = await clear(page);
      await page.mouse.dblclick(twice.x, twice.y);
      await page.waitForTimeout(800);
      await expect(map).toHaveClass(/is-focus/);
      await steadyFrames(page);
      // One press lets go of Keel: the chart's focus goes, the dock keeps
      // it, and no point is picked where the press was.
      const at = await clear(page);
      await press(page, at);
      await expect(map).not.toHaveClass(/is-focus/);
      await page.waitForTimeout(800);
      await expect(dockName(page)).toHaveText("Keel Beach");
      await expect(page).toHaveURL(/\/\?spot=keel$/);
      await expect(page.locator(".pick-mark")).toHaveCount(0);
      await expect(page.locator(".map-pen .map-pen-loop")).toHaveCount(0);

      // With nothing chosen, the next press picks the point.
      await press(page, at);
      await expect(page.locator(".dock .dk-tools")).toContainText(coords);
      await expect(page.locator(".pick-mark")).toHaveCount(1);
      await expect(map).toHaveClass(/is-focus/);
      await expect(keel).not.toHaveClass(/\bsel\b/);
      const point = await dockName(page).textContent();

      // And the point is let go of the same way, not moved to the next press.
      await steadyFrames(page);
      await page.waitForTimeout(1500);
      await press(page, await clear(page));
      await expect(map).not.toHaveClass(/is-focus/);
      await page.waitForTimeout(800);
      await expect(dockName(page)).toHaveText(point!);
      await expect(page.locator(".pick-mark")).toHaveCount(1);

      // A light still chooses its spot, focused, at one press.
      const zoomOut = page.getByRole("button", {
        name: "Zoom out",
        exact: true,
      });
      await zoomOut.click();
      await page.waitForTimeout(1000);
      const light = await aLight(page, "");
      await press(page, light);
      await expect(page).toHaveURL(new RegExp(`/\\?spot=${light.id}$`));
      await expect(map).toHaveClass(/is-focus/);
      await expect(page.locator(".pick-mark")).toHaveCount(0);
      // And another light, over the one chosen, at one press too.
      await steadyFrames(page);
      await page.waitForTimeout(2500);
      for (let i = 0; i < 6 && !(await lightAt(page, light.id)); i++) {
        await zoomOut.click();
        await page.waitForTimeout(800);
      }
      const next = await aLight(page, light.id);
      await press(page, next);
      await expect(page).toHaveURL(new RegExp(`/\\?spot=${next.id}$`));
      await expect(map).toHaveClass(/is-focus/);
      await page.waitForTimeout(800);
      await expect(page).toHaveURL(new RegExp(`/\\?spot=${next.id}$`));
    });
  });
}

test("Escape shuts what is open over the chart first, then lets go of the chosen spot", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?spot=keel");
  const dockName = page.locator(".dock .dk-name");
  await expect(dockName).toHaveText("Keel Beach", { timeout: 30000 });
  const map = page.locator(".map-canvas");
  await expect(map).toHaveClass(/is-focus/, { timeout: 30000 });
  for (const name of ["Layers", "Your spots", "Display options"] as const) {
    await openFromMenu(page, name);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name })).toHaveCount(0);
    await expect(map).toHaveClass(/is-focus/);
    await expect(dockName).toHaveText("Keel Beach");
  }
  const menu = page.getByRole("button", { name: "Site menu" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(map).toHaveClass(/is-focus/);
  // The search's list goes with the words in it, and the field with the next.
  const find = page.getByRole("combobox", { name: "Find a spot" });
  await find.fill("Bran");
  await expect(page.locator(".find .results")).toBeVisible();
  await find.press("Escape");
  await expect(page.locator(".find .results")).toHaveCount(0);
  await find.press("Escape");
  await expect(find).not.toBeFocused();
  await expect(map).toHaveClass(/is-focus/);
  // Nothing open: Escape lets go of Keel, and the dock keeps it.
  await page.keyboard.press("Escape");
  await expect(map).not.toHaveClass(/is-focus/);
  await expect(dockName).toHaveText("Keel Beach");
  await expect(page).toHaveURL(/\/\?spot=keel$/);
});
