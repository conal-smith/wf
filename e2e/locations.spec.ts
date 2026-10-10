import { expect, test } from "./fixtures";

test("public riding places are on the chart and the Blast alias finds Kilcrea, with its sources behind the i", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".spot-marker")).toHaveCount(146, {
    timeout: 30000,
  });
  // Riding places only: no schools, clubs or areas among the lights.
  for (const kind of ["operator", "club", "area"])
    await expect(page.locator(`.spot-marker[data-kind="${kind}"]`)).toHaveCount(0);
  const search = page.getByRole("combobox", { name: "Find a spot" });
  for (const alias of ["Blast", "Kilcrea", "Donabate"]) {
    await search.fill(alias);
    // Donabate is also a beach of its own on the far side of the peninsula,
    // so that alias finds both; the estuary is still the one Blast names.
    const rows = page
      .locator(".spot-row")
      .filter({ hasText: "Kilcrea — Malahide Estuary" });
    await expect(rows).toHaveCount(1);
    await expect(page.locator(".spot-row")).toHaveCount(
      alias === "Donabate" ? 2 : 1,
    );
  }
  await search.fill("Kilcrea");
  await page.locator(".spot-row").click();
  const blast = page.locator('[data-spot-id="kilcrea"]');
  await expect(blast).toHaveClass(/\bsel\b/);
  await expect(page.locator(".dock .dk-name")).toHaveText(
    "Kilcrea — Malahide Estuary",
  );
  await expect(page.locator(".dock tr.tt-wind td .kn").first()).toHaveText(
    /^\d+$/,
  );
  // The chart's own sources, the licences with them.
  await page.getByRole("button", { name: "Sources and small print" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sources and small print" }),
  ).toContainText("CC BY 4.0");
  await page.keyboard.press("Escape");
  await search.fill("Newtownards");
  await page.locator(".spot-row").click();
  await expect(page.locator('[data-spot-id="newtownards"]')).toHaveClass(
    /\bsel\b/,
  );
  await expect(page.locator(".dock .dk-name")).toHaveText(/Newtownards/);
});
