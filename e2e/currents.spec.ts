import { expect, layersRail, openLayers, test, type Page } from "./fixtures";

/**
 * The Currents layer: off on a first visit, and then nothing of it is read,
 * neither its data nor its code; on, it reads the currents pointer and the
 * run's frames (the hour shown first), and says what it cannot draw. A site
 * with no current forecast published still works, and says so.
 */

const CURRENTS = /\/weather\/currents(\.json|-[^/]+\/frames\/\d{3}\.json)$/;
const CODE = /currents(Data|Layer)[^/]*\.(js|ts)$/;

function watch(page: Page) {
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (CURRENTS.test(path) || CODE.test(path)) asked.push(path);
  });
  return asked;
}

async function layers(page: Page) {
  await openLayers(page);
  return layersRail(page);
}

test("the currents layer is off at first and nothing of it is loaded", async ({
  page,
}) => {
  const asked = watch(page);
  await page.goto("/?map");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  const panel = await layers(page);
  await expect(panel.locator('[data-rail-layer="currents"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
});

test("turned on, it reads the run and keeps the rider's choice", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked = watch(page);
  await page.goto("/?map");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  const panel = await layers(page);
  await panel.locator('[data-rail-layer="currents"]').click();
  await expect(panel.locator('[data-rail-layer="currents"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Nothing it cannot draw, so nothing said beside it.
  await expect(panel.locator('[data-layer-note="currents"]')).toHaveCount(0);
  await expect
    .poll(
      () => asked.filter((path) => /frames\/\d{3}\.json$/.test(path)).length,
      {
        timeout: 20000,
      },
    )
    .toBeGreaterThan(1);
  expect(asked.some((path) => path.endsWith("/weather/currents.json"))).toBe(
    true,
  );
  expect(
    JSON.parse(
      (await page.evaluate(() =>
        localStorage.getItem("wingfoil.map.layers.v1"),
      )) ?? "{}",
    ).currents,
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("with no current forecast published the page still works, and says so", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/weather/currents.json", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ currents: true }),
    ),
  );
  await page.goto("/?map");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  const panel = await layers(page);
  await expect(panel.locator('[data-layer-note="currents"]')).toHaveText(
    "No current forecast is published just now.",
    { timeout: 20000 },
  );
  expect(errors).toEqual([]);
});
