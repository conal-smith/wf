import { BUYER, PHONE, SELLER, WIDTHS, expect, test } from "./fixtures";

/**
 * S2, S3. Every marketplace view, at a laptop's width and a phone's, as the
 * conversion to Tailwind will have to find it again: populated, signed in
 * wherever being signed in is the point, and never mid-flight.
 *
 * Nothing here asserts pixels (AVOID): this item records, and a later one
 * compares. What each view does assert is a line of its own text, so that a
 * skeleton, an error or a signed-out page can never be recorded in place of
 * the view it is named after.
 *
 * `npm run market:shots` runs this and nothing else runs it: the files it
 * writes are committed, and `npm run test:e2e` must not rewrite them on its
 * way past (playwright.config.ts).
 *
 * One thing the shots show that production would not: the e2e build has no
 * identity provider (shared/web/auth.tsx), so where a signed-out page would
 * offer a way in, this one says sign-in is not configured.
 */

test("browse: the grid, and the filters open on a phone", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS)
    await shoot("browse", width, { as: BUYER }, async (page) => {
      await page.goto("/market");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Second-hand wingfoil gear, across Ireland",
      );
      // Seven of the eight: the eighth is sold, and browse does not keep those.
      await expect(page.getByText("7 listings")).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(baseline.noPhoto.title) }),
      ).toBeVisible();
    });

  await shoot("browse-filters", PHONE, { as: BUYER }, async (page) => {
    await page.goto("/market?category=wing&maxPriceCents=60000");
    await expect(page.getByText("1 listing")).toBeVisible();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
  });
});

test("a listing, as a buyer: with photos, reviewed, with no photo, and sold", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("listing", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        baseline.featured.title,
      );
      await expect(
        page.getByRole("button", { name: "Show contact details" }),
      ).toBeVisible();
    });

    // The one they enquired on and rated, which is the only place the rating
    // form is drawn.
    await shoot("listing-review", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.reviewed.id}`);
      await expect(
        page.getByRole("heading", { name: "Your review of this seller" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Update review" }),
      ).toBeVisible();
    });

    await shoot("listing-no-photo", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.noPhoto.id}`);
      await expect(
        page.getByText("The seller has not added photos"),
      ).toBeVisible();
    });

    await shoot("listing-sold", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/listing/${baseline.sold.id}`);
      await expect(page.getByText("Sold", { exact: true })).toBeVisible();
      await expect(page.getByText("This item has been sold")).toBeVisible();
    });

    await shoot("listing-signed-out", width, {}, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        baseline.featured.title,
      );
      await expect(
        page.getByRole("button", { name: "Sign in to contact seller" }),
      ).toBeVisible();
    });
  }
});

test("a listing the seller owns, and the dialog that removes it", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("listing-owner", width, { as: SELLER }, async (page) => {
      await page.goto(`/market/listing/${baseline.featured.id}`);
      await expect(
        page.getByRole("link", { name: "Edit listing" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Mark as sold" }),
      ).toBeVisible();
    });

    await shoot(
      "confirm-dialog",
      width,
      { as: SELLER, viewportOnly: true },
      async (page) => {
        await page.goto(`/market/listing/${baseline.featured.id}`);
        await page.getByRole("button", { name: "Remove listing" }).click();
        await expect(
          page.getByRole("heading", { name: "Remove this listing?" }),
        ).toBeVisible();
      },
    );
  }
});

test("selling: the empty form, and the form with errors", async ({ shoot }) => {
  for (const width of WIDTHS) {
    await shoot("sell", width, { as: SELLER }, async (page) => {
      await page.goto("/market/sell");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "What are you selling?",
      );
    });

    // Nothing filled in and published anyway: the form answers before the API
    // is asked, field by field.
    await shoot("sell-errors", width, { as: SELLER }, async (page) => {
      await page.goto("/market/sell");
      await page.getByRole("button", { name: "Publish listing" }).click();
      await expect(
        page.getByText(/title of at least 4 characters/),
      ).toBeVisible();
      await expect(page.getByText(/Enter a price like 450/)).toBeVisible();
    });
  }
});

test("my account: every tab", async ({ shoot }) => {
  for (const width of WIDTHS) {
    // Two people, because a tab is only worth a baseline with something in it:
    // the seller has the listings and the profile, the buyer the rest.
    await shoot("me-listings", width, { as: SELLER }, async (page) => {
      await page.goto("/market/me");
      await expect(
        page.getByRole("heading", { name: "Live (7)" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Sold (1)" }),
      ).toBeVisible();
    });

    await shoot("me-saved", width, { as: BUYER }, async (page) => {
      await page.goto("/market/me/saved");
      await expect(page.getByRole("link", { name: /Saved/ })).toBeVisible();
    });

    await shoot("me-reviews", width, { as: BUYER }, async (page) => {
      await page.goto("/market/me/reviews");
      await expect(page.getByText(/Met me at the slip/)).toBeVisible();
    });

    await shoot("me-profile", width, { as: SELLER }, async (page) => {
      await page.goto("/market/me/profile");
      await expect(
        page.getByRole("textbox", { name: "Display name" }),
      ).toHaveValue("Maeve Doyle");
    });
  }
});

test("the seller's public page, and their reviews", async ({
  shoot,
  baseline,
}) => {
  for (const width of WIDTHS) {
    await shoot("seller", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/seller/${baseline.sellerId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Maeve Doyle",
      );
      await expect(page.getByRole("tab", { name: "Live (7)" })).toBeVisible();
    });

    await shoot("seller-reviews", width, { as: BUYER }, async (page) => {
      await page.goto(`/market/seller/${baseline.sellerId}`);
      await page.getByRole("tab", { name: "Reviews (1)" }).click();
      await expect(page.getByText(/Met me at the slip/)).toBeVisible();
    });
  }
});

test("a URL under /market that is not a page", async ({ shoot }) => {
  for (const width of WIDTHS)
    await shoot("not-found", width, { as: BUYER }, async (page) => {
      await page.goto("/market/no-such-page");
      await expect(page.getByText("That page does not exist")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Browse listings" }),
      ).toBeVisible();
    });
});
