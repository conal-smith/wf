import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/weather/latest.json", "utf8"));
const harmonie = JSON.parse(
  readFileSync("public/weather/harmonie.json", "utf8"),
);

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
  await page.goto("/");
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
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
  expect(dock!.height).toBeLessThan(260);
  await expect(page.locator(".sheet-heading, .sheet-current")).toHaveCount(0);
  await expect(page.getByRole("table", { name: /Brandon Bay/ })).toBeVisible();
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    harmonie.frames.length,
  );
  await expect(
    page.locator(".forecast-day-groups th[scope=colgroup]"),
  ).toHaveCount(
    new Set(
      harmonie.frames.map((f: { validTime: string }) =>
        new Date(f.validTime).toLocaleDateString("en-IE", {
          timeZone: "Europe/Dublin",
        }),
      ),
    ).size,
  );
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

async function openIcon(page: Page) {
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
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  const track = page.getByRole("slider", { name: "Forecast time" });
  const colour = () =>
    track.evaluate((el) => getComputedStyle(el).backgroundImage);
  const initial = await colour();
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page.getByRole("searchbox").fill("Dublin");
  await page.locator(".spot-row").click();
  await expect.poll(colour).not.toBe(initial);
  const dublin = await colour();
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  await expect(page.locator(".wind-cell").last()).not.toHaveText("—", {
    timeout: 30000,
  });
  await expect.poll(colour).not.toBe(dublin);
  await expect.poll(colour).not.toContain("rgb(184, 203, 208)");
});

test("double-click zooms without selecting; single click picks a point", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
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
    await page.goto("/");
    await expect(page.locator(".spot-marker")).toHaveCount(8, {
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
    await page
      .getByRole("button", { name: "Play forecast", exact: true })
      .click();
    await expect(slider).not.toHaveValue("4", { timeout: 5000 });
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
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await page.locator(".spot-marker").first().click();
  await page.getByRole("slider", { name: "Forecast time" }).fill("6");
  const old = manifest.spotForecasts.brandon[6];
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
  await expect(page.locator(".model-info")).toContainText("HARMONIE · 2 km");
  const target = Date.parse(old.validTime);
  const index = harmonie.frames.reduce(
    (best: number, f: { validTime: string }, i: number) =>
      Math.abs(Date.parse(f.validTime) - target) <
      Math.abs(Date.parse(harmonie.frames[best].validTime) - target)
        ? i
        : best,
    0,
  );
  await expect(page.getByRole("slider", { name: "Forecast time" })).toHaveValue(
    String(index),
  );
  const expected = harmonie.spotForecasts.brandon[index];
  const value = Math.round(Math.hypot(expected.u, expected.v) * 1.94384449);
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(`${value}`);
  await expect(page.locator(".spot-marker.active")).toHaveText(String(value));
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(21);
  await expect(
    page.locator(".forecast-table tbody tr").nth(1).locator("td"),
  ).toHaveText(Array(21).fill("—"));
  await page.locator(".model-info").click();
  await expect(page.locator("dialog")).toContainText(
    "HARMONIE-AROME DINI control",
  );
  await expect(
    page.getByRole("link", { name: "Met Éireann forecast data" }),
  ).toHaveAttribute("href", "https://opendata.met.ie/nwp/near-realtime");
  await page.getByLabel("Close forecast information").click();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="icon-eu"]').click();
  await expect(picker.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("slider", { name: "Forecast time" }).fill("24");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(picker.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("slider", { name: "Forecast time" })).toHaveValue(
    "20",
  );
  await expect(page.locator(".model-status")).toContainText(
    "nearest HARMONIE forecast",
  );
});

test("failed or mislabelled model download leaves the old model and forecast intact", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  const picker = page.locator(".model-options");
  const before = await page
    .locator(".forecast-table thead button[aria-pressed=true]")
    .textContent();
  await page.route("**/weather/harmonie.json", (route) =>
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
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveText(before!);
  await page.unroute("**/weather/harmonie.json");
  await page.route("**/weather/harmonie.json", (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await picker.locator('[data-model="harmonie"]').click();
  await expect(page.locator(".model-status")).toContainText("does not match");
  await expect(picker.locator('[data-model="icon-eu"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("model frame failure and cancellation cannot relabel the displayed data", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  const picker = page.locator(".model-options");
  await page.getByRole("slider", { name: "Forecast time" }).fill("24");
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await page.route("**/weather/harmonie-*/*.json", (route) =>
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
  await page.unroute("**/weather/harmonie-*/*.json");
  await page.route("**/weather/harmonie.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({ json: harmonie });
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
  await page.unroute("**/weather/harmonie.json");
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
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".model-info")).toContainText("HARMONIE");
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Dublin");
  await page.locator(".spot-row").click();
  await expect(page.getByRole("table", { name: /Dollymount/ })).toBeVisible();
  await expect(page.locator(".sheet-heading")).toHaveCount(0);
  await expect(page.locator(".forecast-table caption")).toContainText(
    "Gust speed unavailable",
  );
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
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await expect(page.locator(".forecast-sheet")).toHaveCount(1);
  const mapBounds = await page.locator(".map-canvas").boundingBox();
  expect(mapBounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 1000 });
  await page.locator(".spot-marker").first().click();
  await page.getByRole("slider", { name: "Forecast time" }).fill("6");
  const expected = manifest.spotForecasts.brandon[6];
  const value = Math.round(Math.hypot(expected.u, expected.v) * 1.94384449);
  await expect(page.locator(".wind-cell.selected-hour")).toHaveText(`${value}`);
  await expect(page.locator(".spot-marker.active")).toHaveText(`${value}`);
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveText(
    new Date(expected.validTime).toLocaleTimeString("en-IE", {
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
  ).not.toHaveValue("6", { timeout: 5000 });
  await page
    .getByRole("button", { name: "Pause forecast", exact: true })
    .click();
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await page.getByRole("button", { name: "m/s", exact: true }).click();
  await expect(
    page.locator(".forecast-table tbody tr").first().locator("th small"),
  ).toHaveText("m/s");
  await page.getByLabel("Wingfoil spots", { exact: true }).uncheck();
  await expect(page.locator(".spot-marker")).toHaveCount(0);
  await page.getByLabel("Wingfoil spots", { exact: true }).check();
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
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await page.getByRole("button", { name: "Open spot search" }).click();
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Dublin");
  await page.locator(".spot-row").click();
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

test("missing frame keeps the previous displayed time and offers a retry", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  const previous = await page
    .locator(".forecast-table thead button[aria-pressed=true]")
    .getAttribute("data-forecast-index");
  await page.route("**/" + manifest.frames[20].url, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.getByRole("slider", { name: "Forecast time" }).fill("20");
  await expect(page.locator(".frame-status.is-error")).toBeVisible();
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveAttribute("data-forecast-index", previous!);
  await page.unroute("**/" + manifest.frames[20].url);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(
    page.locator(".forecast-table thead button[aria-pressed=true]"),
  ).toHaveAttribute("data-forecast-index", "20");
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
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
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
  await expect(page.locator(".wind-cell.selected-hour")).not.toContainText("—");
  await expect(page.getByRole("button", { name: "Reload map" })).toBeVisible();
});

test("arbitrary point gets a complete source-backed forecast table, with keyboard dismissal", async ({
  page,
}) => {
  await openIcon(page);
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("table", { name: /Selected location/ }),
  ).toBeVisible();
  await expect(page.locator(".forecast-table .wind-cell")).toHaveCount(
    manifest.frames.length,
  );
  await expect(
    page.locator(".forecast-table .wind-cell").last(),
  ).not.toHaveText("—", { timeout: 30000 });
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
