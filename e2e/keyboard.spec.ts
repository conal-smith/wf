import { expect, test, type Page } from "./fixtures";

/**
 * The page from the keys alone (#222). The first stop is a skip link, out of
 * sight until it has the focus, to what the page is for: the list, the
 * forecast in the dock, or the search for a spot by name. The chart's lights
 * are one stop (force5/src/lights.ts): Tab comes to one, the arrows walk
 * them, Enter opens one, and Escape leaves them for the chart. With a stop a
 * light, the dock lay a hundred and fifty presses of Tab from the top.
 */

/**
 * Every light made, and with `rated`, rated: over the whole of Ireland. On a
 * spot the chart is flown in to, the lights out of view wait for their
 * ratings until they come into it.
 */
async function lightsUp(page: Page, rated = true) {
  await expect(page.locator(".spot-marker")).toHaveCount(149, {
    timeout: 30000,
  });
  if (rated)
    await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
      timeout: 30000,
    });
}

/** What has the focus: a light, the dock, the skip link, or something else. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      light: el?.classList.contains("spot-marker")
        ? (el.dataset.spotId ?? null)
        : null,
      dock: !!el?.closest(".dock"),
      skip: el?.hasAttribute("data-skip-link") ?? false,
      name: el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "",
    };
  });

/** Presses Tab from the top of the page until `done`, and counts them. */
async function tabsUntil(
  page: Page,
  done: (at: Awaited<ReturnType<typeof focused>>) => boolean,
  most = 60,
) {
  const lights = new Set<string>();
  for (let n = 1; n <= most; n++) {
    await page.keyboard.press("Tab");
    const at = await focused(page);
    if (at.light) lights.add(at.light);
    if (done(at)) return { presses: n, lights: lights.size };
  }
  throw new Error(`not reached in ${most} presses of Tab`);
}

test("the first stop skips to the forecast, and the lights are one stop on the way", async ({
  page,
}) => {
  await page.goto("/?spot=brandon");
  await lightsUp(page, false);
  await expect(page.locator(".dock")).toBeVisible({ timeout: 30000 });

  // Out of sight until the keys come to it, and then the first stop.
  const skip = page.locator("[data-skip-link]");
  await expect(skip).toHaveText("Skip to the forecast");
  expect((await skip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  await page.keyboard.press("Tab");
  expect((await focused(page)).skip).toBe(true);
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator(".dock")).toBeFocused();
  await page.keyboard.press("Tab");
  expect((await focused(page)).dock).toBe(true);

  // Without it, the forecast is a dozen presses from the top, past one light.
  await page.reload();
  await lightsUp(page, false);
  await expect(page.locator(".dock")).toBeVisible({ timeout: 30000 });
  const way = await tabsUntil(page, (at) => at.dock);
  expect(way.lights).toBe(1);
  expect(way.presses).toBeLessThan(16);
  await expect(page.locator('.spot-marker[tabindex="0"]')).toHaveCount(1);
});

test("the arrows walk the lights, Enter opens one, and Escape leaves them", async ({
  page,
}) => {
  await page.goto("/?map");
  await lightsUp(page);
  const first = await tabsUntil(page, (at) => !!at.light);
  expect(first.lights).toBe(1);
  const from = (await focused(page)).light!;
  const box = await page
    .locator(`.spot-marker[data-spot-id="${from}"]`)
    .boundingBox();

  // An arrow goes to another light that way, and the chart does not pan.
  await page.keyboard.press("ArrowRight");
  const to = (await focused(page)).light;
  expect(to).not.toBeNull();
  expect(to).not.toBe(from);
  const there = await page
    .locator(`.spot-marker[data-spot-id="${to}"]`)
    .boundingBox();
  expect(there!.x).toBeGreaterThanOrEqual(box!.x);
  await page.waitForTimeout(300);
  expect(
    await page.locator(`.spot-marker[data-spot-id="${from}"]`).boundingBox(),
  ).toEqual(box);
  // Its name shows on the light the keys are on.
  await expect(
    page.locator(`.spot-marker[data-spot-id="${to}"] .lt-lab`),
  ).toBeVisible();

  // Tab leaves the lights in one press, and Shift+Tab comes back to that one.
  await page.keyboard.press("Tab");
  expect((await focused(page)).light).toBeNull();
  await page.keyboard.press("Shift+Tab");
  expect((await focused(page)).light).toBe(to);

  // Enter opens it: the dock on its place, the focus still on its light.
  const name = (await focused(page)).name.split(",")[0];
  await page.keyboard.press("Enter");
  await expect(page.locator(".dock")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".dock")).toHaveAttribute(
    "aria-label",
    new RegExp(`^Forecast for ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  expect((await focused(page)).light).toBe(to);
  await expect(page.locator(".map-canvas.is-focus")).toHaveCount(1);

  // Escape leaves the lights for the chart, and lets go of nothing yet.
  await page.keyboard.press("Escape");
  await expect(page.locator(".maplibregl-canvas")).toBeFocused();
  await expect(page.locator(".map-canvas.is-focus")).toHaveCount(1);
  await expect(page.locator(".dock")).toBeVisible();
});

test("with no spot open, the first stop skips to the search", async ({
  page,
}) => {
  await page.goto("/?map");
  await lightsUp(page);
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-skip-link]")).toHaveText(
    "Skip to the search",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Find a spot" }),
  ).toBeFocused();
});

test("beside the list, the first stop skips to the spots and the chart's lights are one stop", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("[data-spot-card]").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".map-panel .spot-marker").first()).toBeAttached({
    timeout: 30000,
  });
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-skip-link]")).toHaveText(
    "Skip to the spots",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-finder-list]")).toBeFocused();
  expect(await page.locator(".spot-marker").count()).toBeGreaterThan(1);
  await expect(page.locator('.spot-marker[tabindex="0"]')).toHaveCount(1);
});
