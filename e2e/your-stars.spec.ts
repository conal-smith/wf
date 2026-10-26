import { expect, test } from "./fixtures";

/**
 * A rider's own stars, as the stars' page says them. They are made and
 * changed in Customise, from the site menu (e2e/customise-tour.spec.ts);
 * here they are stored as Customise stores them, and read back.
 *
 * Since 25 October 2026 there is one rating, ours, unless the rider has
 * their own (version 3). A rating stored before then belonged to a level
 * (Learning, Riding, Advanced) and is not read: the rider is rated on ours,
 * and nothing breaks.
 */

/** Stars a rider made their own in Customise: four numbers and the shore. */
const OWN = {
  version: 3,
  wind: { min: 13, sweetLow: 16, sweetHigh: 20, max: 28 },
  direction: { onshore: 1, crossOn: 0, cross: 0, crossOff: 2, offshore: 5 },
};

test("How the stars work sets the rider's own stars beside ours", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (own) =>
      localStorage.setItem(
        "force5.prefs.v1",
        JSON.stringify({
          version: 3,
          rider: { weightKg: 75, wings: [], custom: own },
        }),
      ),
    OWN,
  );
  await page.goto("/stars?spot=brandon");
  await expect(page.locator("[data-stars-whose]")).toHaveText("Your own", {
    timeout: 30000,
  });
  // Ours and theirs, theirs marked as the one they are rated on.
  const band = page.locator("[data-band-table]");
  await expect(band.locator('[data-band="ours"]')).toContainText("15–22");
  await expect(band.locator('[data-band="ours"]')).not.toContainText("you");
  await expect(band.locator('[data-band="own"]')).toContainText("16–20");
  await expect(band.locator('[data-band="own"]')).toContainText("you");
  // Their own shore: two stars off cross-offshore, onshore one; offshore
  // never, for everyone.
  const shore = page.locator("[data-shore-table]");
  await expect(shore.locator("tr", { hasText: "110–150°" })).toContainText(
    "−2 stars",
  );
  await expect(shore.locator("tr", { hasText: "0–30°" })).toContainText(
    "−1 star",
  );
  await expect(shore.locator("tr", { hasText: "150–180°" })).toContainText(
    "never",
  );
  // The agreed hours, worked out on both: 25 gusting 30 is four of ours,
  // but past their own too much less two knots, none of theirs.
  const row = page
    .locator("[data-gust-table] tr", { hasText: "25 kn gusting 30" })
    .first();
  await expect(row.locator('[data-rated="ours"]')).toHaveAttribute(
    "data-example-stars",
    "4",
  );
  await expect(row.locator('[data-rated="own"]')).toHaveAttribute(
    "data-example-stars",
    "0",
  );
  await expect(
    page.locator("[data-ledger] tr", { hasText: "Your own stars" }),
  ).toContainText("13 · 16–20 · 28 kn", { timeout: 30000 });
  expect(errors).toEqual([]);
});

test("a rating stored for a level, before there was one rating, is ours", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({
        version: 2,
        rider: {
          weightKg: 90,
          skill: "beginner",
          gusty: "lots",
          wings: [],
          // Saved by the levels' rating: version 1, started from Learning.
          custom: {
            version: 1,
            base: "beginner",
            wind: { min: 15, sweetLow: 18, sweetHigh: 23, max: 27 },
            gust: { fine: 24, worst: 30, most: 3 },
            direction: {
              onshore: 0.5,
              crossOn: 0,
              cross: 0,
              crossOff: 2.5,
              offshore: 0,
            },
          },
          keptCustom: {
            version: 2,
            base: "advanced",
            wind: { min: 10, sweetLow: 14, sweetHigh: 26, max: 34 },
            direction: {
              onshore: 0,
              crossOn: 0,
              cross: 0,
              crossOff: 1,
              offshore: 3,
            },
          },
        },
      }),
    ),
  );
  await page.goto("/stars?spot=brandon");
  await expect(page.locator("[data-stars-whose]")).toHaveText("Ours", {
    timeout: 30000,
  });
  // The weight comes over; the level and its rating do not.
  await expect(page.locator("[data-rider-summary]")).toHaveText("90 kg");
  await expect(page.locator('[data-band="own"]')).toHaveCount(0);
  await expect(page.locator('[data-band="ours"]')).toContainText("you");
  await expect(
    page.locator("[data-ledger] tr", { hasText: "Ours" }),
  ).toContainText("11 · 15–22 · 35 kn", { timeout: 30000 });
  await expect(page.locator("main")).not.toContainText(
    /Learning|Advanced|Riding level/,
  );
  expect(errors).toEqual([]);
});
