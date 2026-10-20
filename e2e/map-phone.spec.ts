import { expect, rememberSpot, test, type Page } from "./fixtures";

/**
 * The chart's first view on a phone (#48): the whole of Ireland and every
 * light, south coast included, clear of the head and the controls, even for a
 * visitor whose last spot was in the north-west. The lights are on the chart
 * at every zoom: zoomed out past the island, they stand closer, never gone.
 */
test.use({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
});

/** How many lights stand on the chart below the head, and how many in all. */
const lightsInView = (page: Page) =>
  page.evaluate(() => {
    const chart = document
      .querySelector(".maplibregl-canvas")!
      .getBoundingClientRect();
    const head = document.querySelector(".map-head")!.getBoundingClientRect();
    const lights = [...document.querySelectorAll<HTMLElement>(".spot-marker")];
    const seen = lights.filter((light) => {
      const r = light.getBoundingClientRect();
      const style = getComputedStyle(light);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        r.width > 0 &&
        r.left >= chart.left &&
        r.right <= chart.right &&
        r.top >= head.bottom &&
        r.bottom <= chart.bottom
      );
    });
    return { seen: seen.length, all: lights.length };
  });

test("a phone opens on the whole island, every light in view, and keeps them through a zoom out", async ({
  page,
}) => {
  // A last visit in the north-west, which once opened the chart there.
  await rememberSpot(page, "keel");
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(148, {
    timeout: 30000,
  });
  await expect(page.locator(".spot-marker.pending")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect.poll(() => lightsInView(page)).toEqual({ seen: 148, all: 148 });
  // The south coast too, not just the north-west.
  for (const id of ["tramore", "kearney", "keel"])
    await expect(page.locator(`[data-spot-id="${id}"]`)).toBeInViewport();

  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.waitForTimeout(800);
  await expect.poll(() => lightsInView(page)).toEqual({ seen: 148, all: 148 });
});
