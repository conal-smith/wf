import { expect, layersRail, openFromMenu, test } from "./fixtures";

/**
 * The LiDAR layer is off since 2026-10-24 (scripts/lidar/README.md): it
 * covered four stretches of the coast and looked broken everywhere else. No
 * button on the layers' rail, no part in "About the map", nothing of it served or asked
 * for, even by a rider whose stored layers still say it is on.
 */
test("the LiDAR layer is gone, and a rider who had it on reads none of it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const asked: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/lidar/i.test(path)) asked.push(path);
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "wingfoil.map.layers.v1",
      JSON.stringify({ lidar: true }),
    ),
  );
  await page.goto("/?map");
  await expect(page.locator(".spot-marker").first()).toBeVisible({
    timeout: 30000,
  });
  await openFromMenu(page, "Layers");
  const rail = layersRail(page);
  await expect(rail.locator('[data-rail-layer="currents"]')).toBeVisible();
  await expect(rail.locator('[data-rail-layer="lidar"]')).toHaveCount(0);
  await expect(rail).not.toContainText("LiDAR");
  await openFromMenu(page, "About");
  const info = page.getByRole("dialog", { name: "About the map" });
  await expect(info.getByRole("tab", { name: "Currents" })).toBeVisible();
  await expect(info.getByRole("tab", { name: /LiDAR/ })).toHaveCount(0);
  // The site has no copy of the index to serve: the build ships none.
  const index = await page.request.get("/lidar/index.json");
  expect(index.headers()["content-type"] ?? "").not.toContain("json");
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
});
