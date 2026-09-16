import { expect, test } from "@playwright/test";

test("public riding places are on the map and the Blast alias finds Kilcrea with a grid-backed forecast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(25, {
    timeout: 30000,
  });
  await expect(page.locator('.spot-marker[data-kind="operator"]')).toHaveCount(
    0,
  );
  await expect(page.locator('.spot-marker[data-kind="club"]')).toHaveCount(0);
  await expect(page.locator('.spot-marker[data-kind="area"]')).toHaveCount(0);
  const search = page.getByRole("searchbox");
  await page.getByLabel("Open spot search").click();
  for (const alias of ["Blast", "Kilcrea", "Donabate"]) {
    await search.fill(alias);
    await expect(page.locator(".spot-row")).toHaveCount(1);
    await expect(page.locator(".spot-row")).toContainText(
      "Kilcrea — Malahide Estuary",
    );
    await expect(page.locator(".spot-row")).not.toContainText(
      "School / operator",
    );
  }
  await page.locator(".spot-row").click();
  const blast = page.locator('[data-spot-id="kilcrea"]');
  await expect(blast).toHaveClass(/active/);
  await expect(page.getByRole("table", { name: /Kilcrea/ })).toBeVisible();
  await expect(page.locator(".sheet-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  // Kilcrea's series was recomputed from the bundled frames, so the dock now
  // opens on the blend here; the per-hour numbers live in the table view.
  await page.locator('[data-view="table"]').click();
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
  await expect(page.locator('[data-spot-id="newtownards"]')).toHaveClass(
    /active/,
  );
  await expect(page.getByRole("table", { name: /Newtownards/ })).toBeVisible();
  await page.screenshot({ path: "test-results/locations-mobile.png" });
});
