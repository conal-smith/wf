import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const ecmwf = JSON.parse(readFileSync("public/weather/ecmwf.json", "utf8"));
const harmonie = JSON.parse(
  readFileSync("public/weather/harmonie.json", "utf8"),
);

test("ECMWF 15-day mobile outlook follows mixed-cadence scrubbing and returns to HARMONIE", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(
    new Date(Date.parse(ecmwf.runTime) + 12 * 3600000),
  );
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator(".map-loading")).toHaveCount(0);
  const model = page.locator('[data-model="ecmwf"]');
  await expect(model).toBeEnabled({ timeout: 30000 });
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await model.click();
  await expect(model).toHaveAttribute("aria-pressed", "true");
  // The gust semantics this test is about are the table view's cells.
  await page.locator('[data-view="table"]').click();
  await expect(page.locator(".wind-cell")).toHaveCount(85);
  await expect(page.locator(".gust-cell").nth(1)).toHaveAttribute(
    "title",
    /Maximum gust over 1 hour:/,
  );
  await expect(page.locator(".gust-cell").nth(31)).toHaveAttribute(
    "title",
    /Maximum gust over 3 hours:/,
  );
  const slider = page.getByRole("slider", { name: "Forecast time" });
  await expect(slider).toHaveAttribute("max", "360");
  await slider.fill("144");
  await expect(page.locator('[data-forecast-index="48"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("150");
  await expect(page.locator('[data-forecast-index="49"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await slider.press("ArrowLeft");
  await expect(slider).toHaveValue("144");
  await slider.press("End");
  await expect(slider).toHaveValue("360");
  const selected = page.locator('[data-forecast-index="84"]');
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  const rect = await selected.boundingBox();
  expect(rect!.x).toBeGreaterThan(75);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(391);
  const expected = ecmwf.spotForecasts.brandon[84];
  await expect(page.locator(".wind-cell").last()).toHaveText(
    String(Math.round(Math.hypot(expected.u, expected.v) * 1.94384449)),
  );
  await expect(page.locator(".gust-cell").last()).toHaveText(
    String(Math.round(expected.gust * 1.94384449)),
  );
  await expect(page.locator(".gust-cell").last()).toHaveAttribute(
    "title",
    /Maximum gust over 6 hours/,
  );
  await expect(page.locator(".gust-cell").first()).toHaveText("—");
  await expect(
    page.getByRole("button", {
      name: `Brandon Bay, ${Math.round(Math.hypot(expected.u, expected.v) * 1.94384449)} kn`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(slider).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator(".site-footer")).toContainText(
    "Long-range outlook",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "test-results/ecmwf-day15-mobile.png" });
  await page.clock.setFixedTime(
    new Date(Date.parse(ecmwf.runTime) + 19 * 3600000),
  );
  await slider.press("ArrowLeft");
  await slider.press("End");
  await expect(page.locator(".site-footer")).toHaveText(
    "Older run · long-range outlook",
  );
  await page.getByRole("button", { name: "Forecast data and sources" }).click();
  await expect(page.locator("dialog")).toContainText(
    "ECMWF shaped sample bundle",
  );
  await expect(page.locator("dialog")).toContainText("6-hourly through day 15");
  await page.getByLabel("Close forecast information").click();
  await page.getByLabel("Choose forecast model", { exact: true }).click();
  await page.locator('[data-model="harmonie"]').click();
  await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(slider).toHaveValue(String(harmonie.frames.length - 1));
  await expect(page.locator(".wind-cell")).toHaveCount(harmonie.frames.length);
});

test("unavailable or mislabelled ECMWF snapshot preserves the current model", async ({
  page,
}) => {
  // Routed before the load: the dock warms every manifest on open, and a
  // manifest already in the five-minute cache would never be refetched.
  let body: unknown = null;
  await page.route("**/weather/ecmwf.json", (route) =>
    body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  const model = page.locator('[data-model="ecmwf"]');
  await expect(model).toBeEnabled({ timeout: 30000 });
  await page.locator('[data-view="table"]').click();
  for (const next of [null, { ...ecmwf, model: "wrong" }]) {
    body = next;
    await page.route("**/weather/unused-ecmwf.json", (route) =>
      body
        ? route.fulfill({ json: body })
        : route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.getByLabel("Choose forecast model", { exact: true }).click();
    await model.click();
    await expect(page.locator('[data-model="harmonie"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".model-status.is-error")).toBeVisible();
    await expect(page.locator(".wind-cell")).toHaveCount(
      harmonie.frames.length,
    );
    await page.unroute("**/weather/unused-ecmwf.json");
  }
});
