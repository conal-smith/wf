import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAMPLE_CLOCK, sampleColumn, sampleColumns } from "./columns";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/weather/latest.json", "utf8"));
const harmonie = JSON.parse(
  readFileSync("public/weather/harmonie.json", "utf8"),
);
// A bundled HARMONIE run may or may not carry gusts, depending on when it was
// captured. Both states are valid; assert against the snapshot that is present.
const harmonieGusts = harmonie.gustAvailable !== false;
const knots = (value: number) => String(Math.round(value * 1.94384449));

/**
 * The dock's columns now depend on which runs have expired, so every spec that
 * counts them or names one has to stand at a fixed moment. `SAMPLE_CLOCK` is
 * inside HARMONIE's sample run, where the columns are HARMONIE's own times
 * followed by ECMWF's.
 */
const atSampleClock = (page: Page) => page.clock.setFixedTime(SAMPLE_CLOCK);

/** Wait for a camera animation to finish, by the thing it is moving standing still. */
async function settled(locator: Locator) {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const same = !!box && Math.abs(box.x - last) < 0.5;
      last = box?.x ?? Number.NaN;
      return same;
    })
    .toBe(true);
}

test("map-first default has compact branding, collapsed search and a bottom-flush dock", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /coast-|line-blur|layers\./.test(message.text())
    )
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await atSampleClock(page);
  await page.goto("/");
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await expect(
    page.locator(".legend, .site-identity, .model-select"),
  ).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(
    page.locator(".timeline-date, .timeline-top, .time-ticks, .timeline-days"),
  ).toHaveCount(0);
  const track = page.getByRole("slider", { name: "Forecast time" });
  await expect(track).toHaveCSS("background-image", /linear-gradient/);
  expect((await track.boundingBox())!.width).toBeGreaterThan(290);
  await expect(page.locator(".forecast-day-groups th").first()).toHaveText("");
  const dock = await page.locator(".map-footer").boundingBox();
  expect(dock!.x).toBe(0);
  expect(dock!.width).toBe(390);
  expect(dock!.y + dock!.height).toBe(844);
  // The default dock is the blend chart, the spread row, the waves row and the
  // three surface-weather rows that are on by default — weather, air and rain —
  // plus the tide row when tides are published. Measured 373px with them and
  // 349px without, at the compact 22px a row. The old 320px budget predated the
  // weather rows, which added 66px here.
  expect(dock!.height).toBeLessThan(380);
  await expect(page.locator(".sheet-heading, .sheet-current")).toHaveCount(0);
  await expect(page.getByRole("table", { name: /Brandon Bay/ })).toBeVisible();
  await expect(page.locator('[data-view="blend"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".blend-chart")).toBeVisible();
  await page.locator('[data-view="table"]').click();
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    sampleColumns.length,
  );
  // Fifteen days of columns with HARMONIE on the map, not HARMONIE's own two.
  const days = new Set(
    sampleColumns.map((validTime) =>
      new Date(validTime).toLocaleDateString("en-IE", {
        timeZone: "Europe/Dublin",
      }),
    ),
  );
  expect(days.size).toBeGreaterThanOrEqual(15);
  await expect(
    page.locator(".forecast-day-groups th[scope=colgroup]"),
  ).toHaveCount(days.size);
  const logo = await page.locator(".platform-brand .force5-logo").boundingBox();
  expect(logo!.width).toBeLessThanOrEqual(75);

  await page.getByRole("button", { name: "Open spot search" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open spot search" }),
  ).toBeFocused();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "test-results/compact-default-mobile.png" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Wind colours", { exact: true }).uncheck();
  await page.getByLabel("Close layers").click();
  await expect(page.locator(".map-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function openIcon(page: Page, clock: Date = SAMPLE_CLOCK) {
  await page.clock.setFixedTime(clock);
  await page.goto("/");
  await expect(page.locator('[data-model="harmonie"]')).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="icon-eu"]').click();
  await expect(page.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const dismiss = page.getByLabel("Dismiss model message");
  if (await dismiss.count()) await dismiss.click();
}

test("scrubber wind colours follow the selected spot and arbitrary-point series", async ({
  page,
}) => {
  await atSampleClock(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  const track = page.getByRole("slider", { name: "Forecast time" });
  const colour = () =>
    track.evaluate((el) => getComputedStyle(el).backgroundImage);
  const initial = await colour();
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page.getByRole("searchbox").fill("Dublin");
  await page.locator(".spot-row").filter({ hasText: "Dollymount" }).click();
  await expect.poll(colour).not.toBe(initial);
  const dublin = await colour();
  // Choosing a spot flies the camera, and a point click is cancelled by a
  // camera move: wait until the popout it carries has come to rest.
  const popout = page.getByRole("dialog", { name: /Dollymount information/ });
  await expect(popout).toBeVisible();
  await settled(popout);
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  // A bare point is read from the map model, so only the columns that run
  // spans carry a reading.
  const owns = sampleColumn(harmonie.frames[0].validTime);
  await expect(
    page.locator(".wind-cell").nth(owns + harmonie.frames.length - 1),
  ).not.toHaveText("—", { timeout: 30000 });
  await expect.poll(colour).not.toBe(dublin);
  // Those columns have real colours; the grey either side of them is where the
  // map model does not reach and a bare point has nothing to read.
  await expect
    .poll(async () => (await colour()).split(", rgb")[owns + 1])
    .not.toContain("184, 203, 208");
});

test("double-click zooms without selecting; single click picks a point", async ({
  page,
}) => {
  await atSampleClock(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  const canvas = page.locator(".map-canvas canvas");
  const caption = await page.locator(".forecast-table caption").textContent();
  const separation = async () => {
    const a = await page
      .getByRole("button", { name: /^Brandon Bay,/ })
      .boundingBox();
    const b = await page
      .getByRole("button", { name: /^Inchydoney,/ })
      .boundingBox();
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  };
  const before = await separation();
  await canvas.dblclick({ position: { x: 600, y: 250 }, delay: 100 });
  await expect.poll(separation).toBeGreaterThan(before * 1.5);
  await page.waitForTimeout(400);
  await expect(page.locator(".point-marker")).toHaveCount(0);
  await expect(page.locator(".forecast-table caption")).toHaveText(caption!);
  await canvas.click({ position: { x: 600, y: 300 } });
  await expect(page.locator(".point-marker")).toHaveCount(1);
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`hourly grid follows scrubbing, playback and resizing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await atSampleClock(page);
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(25, {
      timeout: 30000,
    });
    const slider = page.getByRole("slider", { name: "Forecast time" });
    const assertSelectedVisible = async (index: number) => {
      const button = page.locator(`[data-forecast-index="${index}"]`);
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(async () =>
          button.evaluate((el) => {
            const scroller = el.closest(".forecast-scroll")!;
            const bounds = scroller.getBoundingClientRect();
            const labels = scroller
              .querySelector("thead th")!
              .getBoundingClientRect();
            const cell = el.getBoundingClientRect();
            return (
              cell.left >= bounds.left + labels.width - 1 &&
              cell.right <= bounds.right + 1
            );
          }),
        )
        .toBe(true);
    };
    for (const index of [20, 0, 12, 4]) {
      await slider.fill(String(index));
      await assertSelectedVisible(index);
    }
    // Playback follows the map model's own frames, so start from an hour it
    // covers; the first columns belong to the run behind it.
    const onMap = sampleColumn(harmonie.frames[4].validTime);
    await slider.fill(String(onMap));
    await page
      .getByRole("button", { name: "Play forecast", exact: true })
      .click();
    await expect(slider).not.toHaveValue(String(onMap), { timeout: 5000 });
    await page
      .getByRole("button", { name: "Pause forecast", exact: true })
      .click();
    await assertSelectedVisible(Number(await slider.inputValue()));
    await slider.fill("17");
    await assertSelectedVisible(17);
    await page.setViewportSize({
      width: width === 390 ? 760 : 390,
      height: 844,
    });
    await assertSelectedVisible(17);
    await page.screenshot({ path: `test-results/grid-follow-${width}.png` });
  });
}

test("switches real models, uses their own times and values, and clamps the shorter horizon", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await page.locator(".spot-marker").first().click();
  await page.locator('[data-view="table"]').click();
  // ICON-EU's own hour 18, by the column that carries that time.
  const old = manifest.spotForecasts.brandon[6];
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(sampleColumn(old.validTime)));
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(
    `${Math.round(Math.hypot(old.u, old.v) * 1.94384449)}`,
  );
  await expect(page.locator(".frame-status")).toHaveCount(0);
  const picker = page.locator(".model-options");
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".model-info")).toContainText(
    "HARMONIE · 0.5° sample grid",
  );
  const target = Date.parse(old.validTime);
  const index = harmonie.frames.reduce(
    (best: number, f: { validTime: string }, i: number) =>
      Math.abs(Date.parse(f.validTime) - target) <
      Math.abs(Date.parse(harmonie.frames[best].validTime) - target)
        ? i
        : best,
    0,
  );
  // The selection keeps its time through the switch, at HARMONIE's nearest
  // frame; the columns underneath it never moved.
  await expect(page.getByRole("slider", { name: "Forecast time" })).toHaveValue(
    String(sampleColumn(harmonie.frames[index].validTime)),
  );
  const expected = harmonie.spotForecasts.brandon[index];
  const value = Math.round(Math.hypot(expected.u, expected.v) * 1.94384449);
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(`${value}`);
  await expect(page.locator(".spot-marker.active")).toHaveText(String(value));
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    sampleColumns.length,
  );
  // HARMONIE answers every column it reaches, and its sample run has no gust.
  const gusts = await page
    .locator(".forecast-table tbody tr")
    .nth(1)
    .locator("td")
    .allTextContents();
  const owns = sampleColumn(harmonie.frames[0].validTime);
  expect(gusts.slice(owns, owns + harmonie.frames.length)).toEqual(
    harmonie.spotForecasts.brandon.map(
      (s: { hour: number; gust: number | null }) =>
        s.hour === 0 || s.gust == null ? "—" : knots(s.gust),
    ),
  );
  await page.locator(".model-info").click();
  // The dialog describes the model behind the map and links its source. The
  // sample bundle names itself in both places rather than crediting anyone.
  await expect(page.locator("dialog")).toContainText(
    "HARMONIE shaped sample bundle",
  );
  await expect(
    page.getByRole("link", { name: "Synthetic sample data forecast data" }),
  ).toHaveAttribute("href", "https://wingfoil.ie/");
  await page.getByLabel("Close forecast information").click();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="icon-eu"]').click();
  await expect(picker.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A column past HARMONIE's reach: switching the map back to it keeps the map
  // at its last frame and says so.
  const beyond = sampleColumn(manifest.frames.at(-1)!.validTime);
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(beyond));
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("slider", { name: "Forecast time" })).toHaveValue(
    String(sampleColumn(harmonie.frames.at(-1)!.validTime)),
  );
  await expect(page.locator(".model-status")).toContainText(
    "nearest HARMONIE forecast",
  );
});

test("failed or mislabelled model download leaves the old model and forecast intact", async ({
  page,
}) => {
  // The dock asks every live model for its manifest on load, and manifests are
  // cached for five minutes, so a route installed after the page has loaded
  // would never be reached. Fail the target model from the start instead; the
  // page still opens on HARMONIE, which is what must survive the failure.
  await page.route("**/weather/latest.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  const picker = page.locator(".model-options");
  const before = await page
    .locator(".forecast-table thead button[aria-pressed=true]")
    .textContent();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="icon-eu"]').click();
  await expect(page.locator(".model-status")).toContainText(
    "HARMONIE is still shown",
  );
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveText(before!);
  await page.unroute("**/weather/latest.json");
  await page.route("**/weather/latest.json", (route) =>
    route.fulfill({ json: harmonie }),
  );
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="icon-eu"]').click();
  await expect(page.locator(".model-status")).toContainText("does not match");
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("model frame failure and cancellation cannot relabel the displayed data", async ({
  page,
}) => {
  // Inside HARMONIE's coverage, so the frame the switch needs is not the one
  // the first paint already put in the frame cache.
  await openIcon(page, new Date(Date.parse(harmonie.runTime) + 3600000));
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  const picker = page.locator(".model-options");
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(sampleColumn("2026-09-14T12:00:00Z")));
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await page.route("**/weather/harmonie-*/*", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(page.locator(".model-status")).toContainText(
    "ICON-EU is still shown",
  );
  await expect(picker.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.unroute("**/weather/harmonie-*/*");
  // Hold the frame, not the manifest: the dock fetches every manifest on load
  // and they are cached for five minutes, so delaying one would not be seen and
  // the switch would finish before the cancel button could be pressed.
  await page.route("**/weather/harmonie-*/*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await page.getByRole("button", { name: "Cancel switch" }).click();
  await page.waitForTimeout(1100);
  await expect(picker.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".model-info")).toContainText("ICON-EU");
  await page.unroute("**/weather/harmonie-*/*");
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("mobile HARMONIE picker and sheet remain within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await atSampleClock(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".model-info")).toContainText("HARMONIE");
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Dublin");
  await page.locator(".spot-row").filter({ hasText: "Dollymount" }).click();
  await page.locator('[data-view="table"]').click();
  await expect(page.getByRole("table", { name: /Dollymount/ })).toBeVisible();
  await expect(page.locator(".sheet-heading")).toHaveCount(0);
  if (harmonieGusts) {
    await expect(page.locator(".forecast-table caption")).not.toContainText(
      "Gust speed unavailable",
    );
    await expect(page.locator(".gust-cell").nth(1)).toHaveAttribute(
      "title",
      /Maximum gust over 1 hour:/,
    );
    await expect(page.locator(".gust-cell").first()).toHaveText("—");
  } else {
    await expect(page.locator(".forecast-table caption")).toContainText(
      "Gust speed unavailable for the HARMONIE hours",
    );
    // A column HARMONIE itself answers: the head of the axis belongs to the
    // run that covers the hours before HARMONIE was initialised.
    await expect(
      page
        .locator(".gust-cell")
        .nth(sampleColumn(harmonie.frames[1].validTime)),
    ).toHaveAttribute("title", /Gusts unavailable for this HARMONIE run/);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/harmonie-mobile.png" });
});

test("production map loads, follows forecast time, and agrees with the source values", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await expect(page.locator(".forecast-sheet")).toHaveCount(1);
  const mapBounds = await page.locator(".map-canvas").boundingBox();
  expect(mapBounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 1000 });
  await page.locator(".spot-marker").first().click();
  await page.locator('[data-view="table"]').click();
  const expected = manifest.spotForecasts.brandon[6];
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(sampleColumn(expected.validTime)));
  const value = Math.round(Math.hypot(expected.u, expected.v) * 1.94384449);
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(`${value}`);
  await expect(page.locator(".spot-marker.active")).toHaveText(`${value}`);
  // The header names the column, which is the dock's own time nearest the hour
  // the reader asked for; the map is at ICON-EU's nearest frame to it.
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveText(
    new Date(
      sampleColumns[sampleColumn(expected.validTime)],
    ).toLocaleTimeString("en-IE", {
      timeZone: "Europe/Dublin",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  );
  await page
    .getByRole("button", { name: "Play forecast", exact: true })
    .click();
  await expect(
    page.getByRole("slider", { name: "Forecast time" }),
  ).not.toHaveValue(String(sampleColumn(expected.validTime)), {
    timeout: 5000,
  });
  await page
    .getByRole("button", { name: "Pause forecast", exact: true })
    .click();
  // Units moved out of Layers and into the dock's display options, which now
  // drive the table, the charts and the map readouts together.
  await page.getByLabel("Display options", { exact: true }).click();
  await page.locator('[data-units="m/s"]').click();
  await page.getByLabel("Close display options").click();
  await expect(
    page.locator(".forecast-table tbody tr").first().locator("th small"),
  ).toHaveText("m/s");
  await page.getByLabel("Display options", { exact: true }).click();
  await page.locator('[data-units="kn"]').click();
  await page.getByLabel("Close display options").click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByLabel("Wind-sport locations", { exact: true }).uncheck();
  await expect(page.locator(".spot-marker")).toHaveCount(0);
  await page.getByLabel("Wind-sport locations", { exact: true }).check();
  await page.getByLabel("Close layers").click();
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 420, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  await expect(page.locator(".point-marker")).toHaveCount(1);
  const particles = await page
    .locator(".particle-canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++;
      return count;
    });
  expect(particles).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/desktop.png" });
});

test("mobile: search and inspect a spot in the bottom sheet without narrowing the map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Dublin");
  await page.locator(".spot-row").filter({ hasText: "Dollymount" }).click();
  await expect(page.getByRole("table", { name: /Dollymount/ })).toBeVisible();
  await expect(page.locator(".search-results")).toHaveCount(0);
  const sheet = await page.locator(".forecast-sheet").boundingBox();
  expect(sheet!.y).toBeGreaterThan(300);
  expect(sheet!.width).toBe(390);
  const dock = await page.locator(".map-footer").boundingBox();
  expect(dock!.y + dock!.height).toBe(844);
  const map = await page.locator(".map-canvas").boundingBox();
  expect(map).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "test-results/mobile.png" });
  await page.getByRole("button", { name: "Close forecast panel" }).click();
  await expect(page.locator(".forecast-sheet")).toHaveCount(0);
  await expect(page.locator(".map-instruction")).toHaveCount(0);
});

test("missing frame keeps the map on its last good frame and offers a retry", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  // What the map is drawing, read off the marker it samples.
  const drawn = await page.locator(".spot-marker.active").textContent();
  const broken = manifest.frames[20];
  const column = sampleColumn(broken.validTime);
  await page.route("**/" + broken.url, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page
    .getByRole("slider", { name: "Forecast time" })
    .fill(String(column));
  await expect(page.locator(".frame-status.is-error")).toBeVisible();
  // The dock follows the reader to the column they chose; the map does not
  // relabel the frame it is still drawing.
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveAttribute("data-forecast-index", String(column));
  await expect(page.locator(".spot-marker.active")).toHaveText(drawn!);
  await page.unroute("**/" + broken.url);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveAttribute("data-forecast-index", String(column));
});

test("missing snapshot is actionable, and expired snapshots are labelled", async ({
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
  await page.clock.install({ time: new Date("2030-01-01T12:00:00Z") });
  await page.goto("/");
  await expect(page.locator(".site-footer")).toContainText("Archived snapshot");
});

test("reduced motion disables particle animation and respects keyboard time controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await atSampleClock(page);
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(page.getByLabel("Moving particles")).toBeDisabled();
  await expect(page.getByLabel("Moving particles")).not.toBeChecked();
  await page.getByLabel("Close layers").click();
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
});

test("unavailable basemap shows an error while spot forecasts remain usable", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/styles/positron", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator(".map-error")).toBeVisible();
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Brandon");
  await page.locator(".spot-row").click();
  await page.locator('[data-view="table"]').click();
  await expect(page.locator(".wind-cell.selected-hour")).not.toContainText("—");
  await expect(page.getByRole("button", { name: "Reload map" })).toBeVisible();
});

test("arbitrary point gets a complete source-backed forecast table, with keyboard dismissal", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    sampleColumns.length,
  );
  // A bare point is read from the map model alone: its own hours fill, and the
  // columns past them stay empty until the reader puts another model on the map.
  const reach = sampleColumn(manifest.frames.at(-1)!.validTime);
  await expect(
    page.locator(".forecast-table .wind-cell").nth(reach),
  ).not.toHaveText("—", { timeout: 30000 });
  await expect(page.locator(".forecast-table .wind-cell").last()).toHaveText(
    "—",
  );
  const timeButtons = page.locator(".forecast-table thead button");
  await timeButtons.nth(10).click();
  await expect(page.getByRole("slider", { name: "Forecast time" })).toHaveValue(
    "10",
  );
  const value = await page
    .locator(".forecast-table .wind-cell")
    .nth(10)
    .textContent();
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(`${value}`);
  await expect(timeButtons.nth(10)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".forecast-sheet")).toHaveCount(0);
  await expect(page.locator(".map-canvas canvas")).toBeFocused();
});
