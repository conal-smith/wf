import { expect, test } from "@playwright/test";

test("all collected locations are on the map and Blast is searchable with a grid-backed forecast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(52, {
    timeout: 30000,
  });
  await expect(page.locator('.spot-marker[data-kind="operator"]')).toHaveCount(
    23,
  );
  await expect(page.locator('.spot-marker[data-kind="club"]')).toHaveCount(2);
  await expect(page.locator('.spot-marker[data-kind="area"]')).toHaveCount(4);
  const search = page.getByRole("searchbox");
  await page.getByLabel("Open spot search").click();
  for (const alias of ["Blast", "Kilcrea", "Donabate"]) {
    await search.fill(alias);
    await expect(page.locator(".spot-row")).toHaveCount(1);
    await expect(page.locator(".spot-row")).toContainText("Blast");
    await expect(page.locator(".spot-row")).toContainText("School / operator");
  }
  await page.locator(".spot-row").click();
  const blast = page.locator('[data-spot-id="osm-blast-kilcrea"]');
  await expect(blast).toHaveClass(/active/);
  await expect(page.getByRole("table", { name: /Blast/ })).toBeVisible();
  await expect(page.locator(".sheet-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.locator(".wind-cell").first()).toHaveText(/^\d+$/);
  await expect(page.locator(".wind-cell").last()).toHaveText(/^\d+$/);
  const marker = (await blast.boundingBox())!;
  const dock = (await page.locator(".map-footer").boundingBox())!;
  expect(marker.y + marker.height).toBeLessThan(dock.y);
  await page.getByLabel("Forecast data and sources").click();
  await expect(page.locator("dialog")).toContainText("not a verified launch");
  await expect(
    page.locator('.location-sources a[href*="10816824305"]'),
  ).toBeVisible();
  await expect(page.locator(".location-attribution")).toContainText(
    "CC BY 4.0",
  );
  await page.getByLabel("Close forecast information").click();
  await page.getByLabel("Open spot search").click();
  await search.fill("Newtownards");
  await page.locator(".spot-row").click();
  await expect(page.locator('[data-spot-id="osm-newtownards-sc"]')).toHaveClass(
    /active/,
  );
  await expect(page.getByRole("table", { name: /Newtownards/ })).toBeVisible();
  await page.screenshot({ path: "test-results/locations-mobile.png" });
});
