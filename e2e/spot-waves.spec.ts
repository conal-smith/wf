import {
  expect,
  openFromMenu,
  saveSettings,
  test,
  type Page,
} from "./fixtures";
import { MODELS, withWaves } from "./waveFixtures";

/**
 * The spot page's week as two sections on the same hours, Wind and then
 * Waves, against the wave runs of e2e/waveFixtures.ts.
 */

const heading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Brandon Bay", exact: true });

test("the week is a Wind section and a Waves section, each with its own readout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const wind = page.locator('[data-week-section="wind"]');
  const waves = page.locator('[data-week-section="waves"]');
  await expect(wind.getByRole("heading", { name: "Wind" })).toBeVisible();
  await expect(waves.getByRole("heading", { name: "Waves" })).toBeVisible();
  // The wind's readout says no wave but its one line of sea; the waves' says
  // no wind.
  const windOut = page.locator("[data-readout]");
  const waveOut = page.locator("[data-wave-readout]");
  await expect(windOut.locator("[data-readout-sea]")).toContainText(/\d\.\d m/);
  await expect(windOut).not.toContainText("Swell");
  await expect(waveOut).toContainText("Swell 1");
  await expect(waveOut).toContainText("Swell 2");
  await expect(waveOut).toContainText("Wind sea");
  await expect(waveOut).not.toContainText("Gusts");
  // Sea and Waves have left the wind's bands for the waves'.
  await expect(wind.locator("[data-band-name]")).toHaveText([
    "Stars",
    "Wind",
    "Direction",
    "Wind blend",
    "Gusts",
    "Sky",
    "Rain",
    "Tide",
    "Current",
  ]);
  await expect(waves.locator("[data-band-name]")).toHaveText([
    "Waves",
    "Direction",
    "Period",
    "Wave blend",
    "Swell 1",
    "Swell 2",
    "Wind sea",
  ]);
  // A line per wave model, the blend's, and where the short runs end.
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator('[data-band="wave-blend"] path[data-model]')).toHaveCount(4);
  await expect(svg.locator('[data-band="wave-blend"] path[data-blend]')).toHaveCount(1);
  // The Met Office's, SWAN's and GFS-Wave's: ECMWF's goes on to the end.
  await expect(svg.locator("[data-run-end]")).toHaveCount(3);
  await expect(svg.locator('[data-run-end="met-office-wave"]')).toContainText(
    "Met Office ends",
  );
  // The global models are dashed, the fine ones not.
  const dash = (id: string) =>
    svg
      .locator(`path[data-model="${id}"]`)
      .evaluate((path) => path.getAttribute("stroke-dasharray"));
  expect(await dash("gfs-wave")).toBeTruthy();
  expect(await dash("mi-swan")).toBeNull();
  // The headline hands on as the finest model's run ends.
  await expect(svg.locator("[data-wave-handover]").first()).toHaveAttribute(
    "data-wave-handover",
    "mi-swan",
  );
  // The wind blend: each model, dashed where global, and the blend in ink.
  const windSvg = page.locator("[data-graph-svg]");
  await expect(
    windSvg.locator('[data-band="wind-blend"] path[data-blend]'),
  ).toHaveCount(1);
  expect(
    await windSvg
      .locator('path[data-model="ecmwf"]')
      .evaluate((path) => path.getAttribute("stroke-dasharray")),
  ).toBeTruthy();
  const legend = page.locator("[data-wave-models-legend]");
  for (const name of ["Met Office", "MI SWAN", "GFS-Wave", "ECMWF", "Blend"])
    await expect(legend).toContainText(name);
  expect(errors).toEqual([]);
});

test("over a section, a card lists that section's models and blend, and only those", async ({
  page,
}) => {
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const windGraph = page.locator("[data-spot-graph]");
  await windGraph.scrollIntoViewIfNeeded();
  const windBox = (await windGraph.boundingBox())!;
  await page.mouse.move(windBox.x + windBox.width * 0.4, windBox.y + 260);
  const windCard = page.locator('[data-card="wind"]');
  await expect(windCard).toBeVisible();
  await expect(windCard).toContainText("Wind blend");
  await expect(windCard).toContainText("HARMONIE");
  await expect(windCard).toContainText("Blend");
  await expect(windCard).not.toContainText("SWAN");
  await expect(page.locator('[data-card="waves"]')).toHaveCount(0);

  const waveGraph = page.locator("[data-wave-graph]");
  await waveGraph.scrollIntoViewIfNeeded();
  const waveBox = (await waveGraph.boundingBox())!;
  await page.mouse.move(waveBox.x + waveBox.width * 0.4, waveBox.y + 200);
  const waveCard = page.locator('[data-card="waves"]');
  await expect(waveCard).toBeVisible();
  await expect(waveCard).toContainText("Wave blend");
  for (const name of ["Met Office", "MI SWAN", "GFS-Wave", "ECMWF", "Blend"])
    await expect(waveCard).toContainText(name);
  await expect(waveCard).toContainText("Models range");
  await expect(waveCard).not.toContainText("HARMONIE");
  await expect(windCard).toHaveCount(0);
  // Both sections read the same hour.
  const hour = await page.locator("[data-wave-readout] [data-readout-hour]").textContent();
  await expect(page.locator("[data-readout] [data-readout-hour]")).toHaveText(
    hour!,
  );

  // A click holds the hour; the arrow keys step it.
  await page.mouse.click(waveBox.x + waveBox.width * 0.4, waveBox.y + 200);
  await page.mouse.move(waveBox.x + waveBox.width + 40, waveBox.y - 40);
  await expect(page.locator("[data-wave-readout] [data-readout-hour]")).toHaveText(
    hour!,
  );
  await waveGraph.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator("[data-wave-readout] [data-readout-hour]"),
  ).not.toHaveText(hour!);
});

test("with no wave blend published, each model's line and the leading model alone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await withWaves(page, { blend: false });
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator('[data-band="wave-blend"] path[data-model]')).toHaveCount(4);
  await expect(svg.locator("path[data-blend]")).toHaveCount(0);
  await expect(svg.locator('[data-band="waves"] path[data-wave-height]')).toHaveAttribute(
    "d",
    /^M/,
  );
  await expect(page.locator("[data-wave-readout] [data-readout-waves]")).toContainText(
    /\d\.\d m/,
  );
  await expect(page.locator("[data-wave-models-legend]")).not.toContainText("Blend");
  const graph = page.locator("[data-wave-graph]");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + 200);
  const card = page.locator('[data-card="waves"]');
  await expect(card).toContainText("MI SWAN");
  await expect(card).not.toContainText("Blend");
  expect(errors).toEqual([]);
});

test("with no wave model at all, the page still reads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const m of MODELS)
    await page.route(`**/weather/${m.id}.json`, (route) =>
      route.fulfill({ status: 404 }),
    );
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-graph-svg]")).toBeVisible();
  await expect(page.locator('[data-week-section="waves"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a rider's own wave model leads the waves, handed on past its run", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({ version: 3, waveModel: "gfs-wave" }),
    ),
  );
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator("[data-wave-handover]")).toHaveCount(1);
  await expect(svg.locator("[data-wave-handover]")).toHaveAttribute(
    "data-wave-handover",
    "ecmwf-wave",
  );
  // GFS-Wave's own swell and wind sea, never a second swell it has not got.
  await expect(page.locator("[data-wave-readout]")).not.toContainText("Swell 2 0");
  await expect(page.locator("[data-wave-legend]")).toContainText(
    "Wave height: GFS-Wave",
  );
});

test("a rider who picks the blends in Settings reads the wind and the waves from them", async ({
  page,
}) => {
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  await openFromMenu(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("group", { name: "Model", exact: true })
    .getByRole("button", { name: "Blend" })
    .click();
  await expect(settings.locator("[data-model-detail]")).toContainText(
    "the map draws HARMONIE",
  );
  await settings.getByLabel("Wave model").selectOption("blend");
  await saveSettings(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  // An hour every model reaches: the headline wind is the blend's.
  const graph = page.locator("[data-spot-graph]");
  await graph.scrollIntoViewIfNeeded();
  const box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + 260);
  const blendKey = page.locator('[data-models-legend] [data-model-key="blend"] b');
  await expect(blendKey).toHaveText(/\d+/);
  const wind = await page.locator("[data-readout-wind] b").textContent();
  expect(wind).toMatch(new RegExp(`^${await blendKey.textContent()}\\b`));
  // No "from here": the blend hands over to nothing.
  await expect(page.locator("[data-graph-svg]")).not.toContainText("from here");
  // The waves likewise, where the blend is published.
  const waveKey = page.locator(
    '[data-wave-models-legend] [data-model-key="blend"] b',
  );
  await expect(waveKey).toHaveText(/\d\.\d/);
  await expect(
    page.locator("[data-wave-readout] [data-readout-waves]"),
  ).toContainText(`${await waveKey.textContent()} m`);
  await expect(page.locator("[data-wave-legend]")).toContainText(
    "Wave height: the blend",
  );
});

/** How far right a part of the waves' graph reaches, in the graph's own px. */
const reach = (page: Page, selector: string) =>
  page
    .locator("[data-wave-svg]")
    .locator(selector)
    .first()
    .evaluate((path: SVGGraphicsElement) => {
      const box = path.getBBox();
      return box.x + box.width;
    });

test("the headline, its range and the blend reach ECMWF's last step, six-hourly past +144 h", async ({
  page,
}) => {
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator('path[data-model="ecmwf-wave"]')).toBeVisible();
  const end = await reach(page, 'path[data-model="ecmwf-wave"]');
  const gfs = await reach(page, 'path[data-model="gfs-wave"]');
  expect(end).toBeGreaterThan(gfs + 400);
  expect(await reach(page, "path[data-wave-height]")).toBeCloseTo(end, -1);
  expect(await reach(page, "path[data-wave-spread]")).toBeCloseTo(end, -1);
  expect(await reach(page, "path[data-blend]")).toBeCloseTo(end, -1);
  // One word that it has passed to ECMWF, and the figures at its steps alone.
  await expect(svg.locator('[data-wave-handover="ecmwf-wave"]')).toHaveCount(1);
  const lastFigures = await svg
    .locator('[data-band="wave-direction"] text')
    .evaluateAll((texts) =>
      (texts as SVGGraphicsElement[]).map((t) => t.getBBox().x).slice(-3),
    );
  expect(lastFigures[2] - lastFigures[1]).toBeCloseTo(
    lastFigures[1] - lastFigures[0],
    0,
  );
  expect(lastFigures[1] - lastFigures[0]).toBeGreaterThan(100);
});

test("a rider's ECMWF leads to its end: no flipping between its steps, and a value on every hour", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({ version: 3, waveModel: "ecmwf-wave" }),
    ),
  );
  await withWaves(page);
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator('path[data-model="ecmwf-wave"]')).toBeVisible();
  await expect(svg.locator("[data-wave-handover]")).toHaveCount(0);
  const end = await reach(page, 'path[data-model="ecmwf-wave"]');
  expect(await reach(page, "path[data-wave-height]")).toBeCloseTo(end, -1);
  await expect(page.locator("[data-wave-legend]")).toContainText(
    "Wave height: ECMWF Wave",
  );
  // Far along its six-hourly steps: the card reads it at every hour.
  const graph = page.locator("[data-wave-graph]");
  await graph.scrollIntoViewIfNeeded();
  await graph.evaluate((el) => (el.scrollLeft = el.scrollWidth * 0.75));
  const box = (await graph.boundingBox())!;
  const card = page.locator('[data-card="waves"]');
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(box.x + 300 + i * 28, box.y + 200);
    await expect(card).toBeVisible();
    await expect(card.locator("tr, div").filter({ hasText: "ECMWF" }).last()).toContainText(
      /\d\.\d m/,
    );
  }
});

test("with no GFS-Wave at the place, the waves carry on to ECMWF's last step", async ({
  page,
}) => {
  await withWaves(page, { without: ["met-office-wave", "ibi-wave", "gfs-wave"] });
  await page.goto("/spot/brandon");
  await expect(heading(page)).toBeVisible({ timeout: 30000 });
  const svg = page.locator("[data-wave-svg]");
  await expect(svg.locator('path[data-model="ecmwf-wave"]')).toBeVisible();
  await expect(svg.locator("path[data-model]")).toHaveCount(2);
  const end = await reach(page, 'path[data-model="ecmwf-wave"]');
  expect(await reach(page, "path[data-wave-height]")).toBeCloseTo(end, -1);
  await expect(svg.locator("[data-wave-handover]")).toHaveCount(1);
  await expect(svg.locator("[data-wave-handover]")).toHaveAttribute(
    "data-wave-handover",
    "ecmwf-wave",
  );
});

test("sheltered water has no Waves section, as it has no waves through the year", async ({
  page,
}) => {
  await page.goto("/spot/malahide-estuary");
  await expect(page.locator("[data-graph-svg]")).toBeVisible({ timeout: 30000 });
  await page.locator('[data-disclosure="year"] summary').click();
  await expect(page.locator("[data-climate-sheltered]")).toBeAttached();
  await expect(page.locator('[data-week-section="waves"]')).toHaveCount(0);
  await expect(page.locator("[data-readout-sea]")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("one readout, the wind's until the waves come up, with a switch to each", async ({
    page,
  }) => {
    await withWaves(page);
    await page.goto("/spot/brandon");
    await expect(heading(page)).toBeVisible({ timeout: 30000 });
    await expect(page.locator("[data-graph-svg]")).toBeVisible();
    const readout = page.locator("[data-readout]");
    const switcher = readout.getByRole("group", { name: "What the readout shows" });
    const windPane = readout.locator('[data-pane="wind"]');
    const wavePane = readout.locator('[data-pane="waves"]');
    // One readout, held at the top over both sections.
    await expect(page.locator("[data-readout]")).toHaveCount(1);
    await page.locator('[data-week-section="wind"]').evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top - 300),
    );
    await expect(switcher.getByRole("button", { name: "Wind" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(windPane).toBeVisible();
    await expect(wavePane).toBeHidden();
    await expect(windPane.locator("[data-strip-model]")).toHaveCount(5);
    // The waves' section past the middle of the screen: the readout turns.
    await page.locator('[data-week-section="waves"]').evaluate((el) =>
      scrollTo(0, scrollY + el.getBoundingClientRect().top - 320),
    );
    await expect(switcher.getByRole("button", { name: "Waves" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(wavePane).toBeVisible();
    await expect(windPane).toBeHidden();
    await expect(wavePane).toContainText("Wave blend");
    await expect(wavePane.locator("[data-strip-model]")).toHaveCount(5);
    await expect(wavePane).not.toContainText("Gusts");
    // Wind takes the page back to the wind's section, and the readout with it.
    await switcher.getByRole("button", { name: "Wind" }).click();
    await expect(windPane).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator("[data-spot-graph]")
          .evaluate((el) => el.getBoundingClientRect().top < innerHeight),
      )
      .toBe(true);
    // The hours scroll as one: dragging the waves moves the wind.
    await page
      .locator("[data-wave-graph]")
      .evaluate((el) => (el.scrollLeft = 900));
    await expect
      .poll(() => page.locator("[data-spot-graph]").evaluate((el) => el.scrollLeft))
      .toBe(900);
  });

  test("on sheltered water the readout has no switch", async ({ page }) => {
    await page.goto("/spot/malahide-estuary");
    await expect(page.locator("[data-graph-svg]")).toBeVisible({ timeout: 30000 });
    await page.locator('[data-disclosure="year"] summary').click();
    await expect(page.locator("[data-climate-sheltered]")).toBeAttached();
    await expect(
      page.getByRole("group", { name: "What the readout shows" }),
    ).toHaveCount(0);
    await expect(page.locator('[data-week-section="waves"]')).toHaveCount(0);
  });
});
