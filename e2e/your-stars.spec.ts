import { expect, test } from "./fixtures";

/**
 * A rider's own star rating, as the stars' page says it. It is made and
 * changed in Customise, from the site menu (e2e/customise-tour.spec.ts): the
 * display options and the dock's head no longer open "Your star rating"
 * (spot/web/YourStarsDialog.tsx), and the map has no other way to it.
 */

test("How the stars work says when the rating is the rider's own", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "force5.prefs.v1",
      JSON.stringify({
        rider: {
          weightKg: null,
          skill: "intermediate",
          wings: [],
          // Saved before v6: version 1, with the gust curve it then had.
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
        },
      }),
    ),
  );
  await page.goto("/stars?spot=brandon");
  await expect(page.locator("[data-ledger]")).toContainText(
    "Your own star rating, started from Learning",
    { timeout: 30000 },
  );
  await expect(
    page.locator("[data-band-table] tr", { hasText: "Your own" }),
  ).toContainText("you");
  await expect(
    page.locator("[data-shore-table] tr", { hasText: "150–180°" }),
  ).toContainText("none");
});
