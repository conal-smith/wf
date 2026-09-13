import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("public/weather/latest.json", "utf8"));

test("production map loads, follows forecast time, and agrees with the source values", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  await expect(page.locator(".forecast-sheet")).toHaveCount(0);
  const mapBounds = await page.locator(".map-canvas").boundingBox();
  expect(mapBounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 1000 });
  await page.locator(".spot-marker").first().click();
  await page.getByRole("slider", { name: "Forecast time" }).fill("6");
  const expected = manifest.spotForecasts.brandon[6];
  const value = Math.round(Math.hypot(expected.u, expected.v) * 1.94384449);
  await expect(page.locator(".wind-number")).toHaveText(`${value}knots`);
  await expect(page.locator(".spot-marker.active")).toHaveText(`${value}`);
  await expect(page.locator(".timeline-date strong")).toHaveText(
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
  await expect(page.locator(".wind-number span")).toHaveText("m/s");
  await page.getByLabel("Wingfoil spots", { exact: true }).uncheck();
  await expect(page.locator(".spot-marker")).toHaveCount(0);
  await page.getByLabel("Wingfoil spots", { exact: true }).check();
  await page.getByLabel("Close layers").click();
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 420, y: 300 } });
  await expect(
    page.getByRole("heading", { name: "Selected location" }),
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
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Dublin");
  await page.locator(".spot-row").click();
  await expect(page.getByRole("heading", { name: "Dollymount" })).toBeVisible();
  await expect(page.locator(".search-results")).toHaveCount(0);
  const sheet = await page.locator(".forecast-sheet").boundingBox();
  expect(sheet!.y).toBeGreaterThan(300);
  expect(sheet!.width).toBe(370);
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
  await expect(page.locator(".map-instruction")).toBeVisible();
});

test("missing frame keeps the previous displayed time and offers a retry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  const previous = await page.locator(".timeline-date").textContent();
  await page.route("**/" + manifest.frames[20].url, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.getByRole("slider", { name: "Forecast time" }).fill("20");
  await expect(page.locator(".frame-status.is-error")).toBeVisible();
  await expect(page.locator(".timeline-date")).toHaveText(previous!);
  await page.unroute("**/" + manifest.frames[20].url);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".frame-status")).toHaveCount(0);
  await expect(page.locator(".timeline-date")).not.toHaveText(previous!);
});

test("missing snapshot is actionable, and expired snapshots are labelled", async ({
  page,
}) => {
  await page.route("**/weather/latest.json", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "npm run weather:refresh",
  );
  await page.unroute("**/weather/latest.json");
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
  await page
    .getByRole("searchbox", { name: "Search Irish spots" })
    .fill("Brandon");
  await page.locator(".spot-row").click();
  await expect(page.locator(".wind-number")).not.toContainText("—");
  await expect(page.getByRole("button", { name: "Reload map" })).toBeVisible();
});

test("arbitrary point gets a complete source-backed forecast table, with keyboard dismissal", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(8, { timeout: 30000 });
  await page
    .locator(".map-canvas canvas")
    .click({ position: { x: 600, y: 300 } });
  await expect(
    page.getByRole("heading", { name: "Selected location" }),
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
  await expect(page.locator(".wind-number")).toHaveText(`${value}knots`);
  await expect(timeButtons.nth(10)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator(".forecast-sheet")).toHaveCount(0);
  await expect(page.locator(".map-canvas canvas")).toBeFocused();
});
